#!/bin/sh
# Enveloppe mince de `pnpm db:backup` (N4, tools/backup.ts) pour une base
# LOCALE et JETABLE de test ou de recette. La copie est chiffrée à la volée
# (AES-256-GCM, clé de données emballée par KMS ou clé locale hors production),
# droits et déclencheurs conservés. Aucun clair n'est écrit sur disque.
#
# Refuse tout hôte non local : l'agent n'a jamais accès à la production ni à
# une donnée réelle.
#
# Usage : DATABASE_URL=… BACKUP_DIR=… [BACKUP_LOCAL_MASTER_KEY=<64 hex>] \
#         sh infra/backup/dump.sh
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

BACKUP_SOURCE_URL="$DATABASE_URL" BACKUP_OUT_DIR="$BACKUP_DIR" exec pnpm -s db:backup