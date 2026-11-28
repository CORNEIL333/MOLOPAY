#!/bin/sh
# Enveloppe mince de `pnpm db:restore-backup` (N4, tools/backup.ts) pour une
# base LOCALE, VIDE et distincte. Le déchiffrement complet et vérifié précède
# la restauration ; le contenu, les déclencheurs, les droits et le grand livre
# sont ensuite contrôlés (équilibre, chaîne sans trou). Aucun fichier en clair
# ne subsiste.
#
# Usage : RESTORE_DATABASE_URL=… DUMP_FILE=…molopay-<instant>.dump.enc \
#         [BACKUP_LOCAL_MASTER_KEY=<64 hex>] sh infra/backup/restore.sh
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

RESTORE_TARGET_URL="$RESTORE_DATABASE_URL" exec pnpm -s db:restore-backup "$DUMP_FILE"