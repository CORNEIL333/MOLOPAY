#!/bin/sh
# Restauration vérifiée dans une base LOCALE, VIDE et distincte (OPS-BAK-003
# partiel). La vérification complète du grand livre par le vérificateur
# indépendant exige un export de la base restaurée : étape encore non outillée,
# consignée dans docs/04_annexes/exploitation/SAUVEGARDE_ET_RESTAURATION.md.
#
# Usage : RESTORE_DATABASE_URL=… DUMP_FILE=… infra/backup/restore.sh
set -eu

: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL requis}"
: "${DUMP_FILE:?DUMP_FILE requis}"

node -e '
  const url = new URL(process.env.RESTORE_DATABASE_URL);
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    console.error("REMOTE_DATABASE_REFUSED: seule une base locale peut être restaurée");
    process.exit(3);
  }
'

if [ ! -f "$DUMP_FILE" ]; then
  echo "DUMP_NOT_FOUND: $DUMP_FILE" >&2
  exit 2
fi

if [ -f "$DUMP_FILE.sha256" ]; then
  directory=$(dirname "$DUMP_FILE")
  name=$(basename "$DUMP_FILE")
  (cd "$directory" && sha256sum -c "$name.sha256")
fi

existing=$(psql -v ON_ERROR_STOP=1 -At -c "
  SELECT count(*) FROM information_schema.tables
  WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
" "$RESTORE_DATABASE_URL" | tr -d '\r')
if [ "$existing" != "0" ]; then
  echo "TARGET_NOT_EMPTY: la restauration exige une base vide" >&2
  exit 2
fi

pg_restore --exit-on-error --no-owner --no-privileges --dbname "$RESTORE_DATABASE_URL" "$DUMP_FILE"

restored=$(psql -v ON_ERROR_STOP=1 -At -c "
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
" "$RESTORE_DATABASE_URL" | tr -d '\r')

if [ -z "$restored" ]; then
  echo "RESTORE_STATS_FAILED: compteurs illisibles après restauration" >&2
  exit 1
fi

if [ -f "$DUMP_FILE.stats" ] && [ "$restored" != "$(cat "$DUMP_FILE.stats")" ]; then
  echo "RESTORE_MISMATCH: les compteurs restaurés diffèrent de la sauvegarde" >&2
  printf '%s\n' "$restored" >&2
  exit 1
fi

value_of() {
  printf '%s\n' "$restored" | sed -n "s/^$1=//p"
}
unbalanced=$(value_of unbalanced)
gaps=$(value_of gaps)
if [ "$unbalanced" != "0" ] || [ "$gaps" != "0" ]; then
  echo "RESTORE_INVALID: unbalanced=$unbalanced gaps=$gaps" >&2
  exit 1
fi

echo "RESTORE_OK entries=$(value_of entries) postings=$(value_of postings) max_seq=$(value_of max_seq)"
