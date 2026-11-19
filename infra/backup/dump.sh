#!/bin/sh
# Sauvegarde locale d'une base PostgreSQL de test ou de recette (OPS-BAK-001
# partiel). Refuse tout hôte non local : l'agent n'a jamais accès à la
# production ni à une donnée réelle.
#
# Usage : DATABASE_URL=… BACKUP_DIR=… infra/backup/dump.sh
set -eu

: "${DATABASE_URL:?DATABASE_URL requis}"
: "${BACKUP_DIR:?BACKUP_DIR requis}"

node -e '
  const url = new URL(process.env.DATABASE_URL);
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    console.error("REMOTE_DATABASE_REFUSED: seule une base locale peut être sauvegardée");
    process.exit(3);
  }
'

umask 077
mkdir -p "$BACKUP_DIR"
if [ -n "$(ls -A "$BACKUP_DIR")" ]; then
  echo "BACKUP_DIR_NOT_EMPTY: $BACKUP_DIR" >&2
  exit 2
fi

stamp=$(date -u +%Y%m%dT%H%M%SZ)
dump="$BACKUP_DIR/molopay-$stamp.dump"

psql -v ON_ERROR_STOP=1 -At -c "
  SELECT
    'entries=' || (SELECT count(*) FROM ledger.journal_entry) || E'\n' ||
    'postings=' || (SELECT count(*) FROM ledger.posting) || E'\n' ||
    'max_seq=' || (SELECT coalesce(max(seq), 0) FROM ledger.journal_entry) || E'\n' ||
    'unbalanced=' || (SELECT count(*) FROM (
      SELECT entry_id FROM ledger.posting
      GROUP BY entry_id
      HAVING sum(CASE direction WHEN 'D' THEN amount_xaf ELSE -amount_xaf END) <> 0
    ) AS unbalanced) || E'\n' ||
    'gaps=' || (SELECT count(*) FROM (
      SELECT seq, lag(seq) OVER (ORDER BY seq) AS previous FROM ledger.journal_entry
    ) AS numbered WHERE previous IS NOT NULL AND seq <> previous + 1)
" "$DATABASE_URL" | tr -d '\r' > "$dump.stats"

if [ ! -s "$dump.stats" ]; then
  echo "BACKUP_STATS_FAILED: compteurs illisibles, aucune sauvegarde produite" >&2
  rm -f "$dump.stats"
  exit 1
fi

pg_dump --format=custom --no-owner --no-privileges --file "$dump" "$DATABASE_URL"
(cd "$BACKUP_DIR" && sha256sum "$(basename "$dump")" > "$(basename "$dump").sha256")

echo "BACKUP_OK $dump"
