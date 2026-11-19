# Image de l'API cœur (apps/api) — NF-PORT-001.
#
# La référence de l'image de base est épinglée par version majeure (Node 24,
# moteur déclaré du dépôt). La production exige en plus une empreinte
# (@sha256:…) fournie à la construction : voir D105 et la procédure
# docs/04_annexes/exploitation/CONFIGURATION.md.
FROM node:24-bookworm-slim

# Le code est exécuté en TypeScript par tsx (tsconfig racine en noEmit) : les
# dépendances de développement font donc partie de l'image d'exécution. Limite
# assumée du MVP, consignée en D106 ; aucune dépendance ajoutée pour cela.
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable && corepack prepare pnpm@12.6.0 --activate

WORKDIR /app

# Contexte de construction = racine du dépôt (.dockerignore à la racine).
COPY --chown=node:node . .

# Installation figée : aucune résolution de version au moment de la construction.
RUN pnpm install --frozen-lockfile --prod=false && pnpm store prune

# Aucun privilège : l'API lit ses secrets dans l'environnement fourni par
# l'orchestrateur, jamais dans une image ou un fichier versionné.
USER node

EXPOSE 3000

# Vivacité seulement : une base indisponible ne doit pas provoquer de
# redémarrage en boucle (la disponibilité se sonde sur /health/ready).
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||'3000')+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--import", "tsx", "apps/api/src/main.ts"]
