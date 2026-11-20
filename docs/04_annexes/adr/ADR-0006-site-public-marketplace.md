# ADR-0006 · Site public marketplace d'acquisition

- **Statut :** Proposé (20 novembre 2026), à valider par le fondateur
- **Date :** 20 novembre 2026
- **Décideur :** Fondateur

## Contexte

Le fondateur a décidé d'ajouter un **site public** pour attirer les visiteurs non inscrits : catalogue consultable sans compte, simulateur, pages par univers, ville et offre, puis inscription. Le client web existant (PWA, `apps/web-client`) sert les clients **connectés** ; il n'est pas conçu pour l'indexation, le partage social ni des temps de chargement minimaux pour un visiteur inconnu. Exigences : `CDC_01` § 15 (F-PUB-*) et `CDC_02` § 11 (NF-PUB-*). Maquette : `05_direction_ux_et_ui/maquettes/site-public.html`.

## Décision proposée

1. **Nouvelle application `apps/site`** dans le monorepo, en **Next.js (TypeScript)**, comme le portail et le back-office (ADR-0001), avec rendu **statique ou incrémental (SSG/ISR)** et diffusion par **CDN**.
2. Le site ne lit que le **modèle de lecture public** du module `catalog` (`/v1/public/offers`, `/v1/public/partners`, `/v1/public/simulations`), sans authentification, en lecture seule, avec limitation de débit. Aucune route d'écriture, aucune donnée personnelle.
3. Le **simulateur** appelle la même fonction de calcul que l'application (paquet partagé `packages/money` et règles de plans), pour garantir l'égalité des résultats (F-PUB-003).
4. « Réserver » mène à l'inscription OTP (module `identity`) puis à l'application ou à la PWA par **lien profond** portant un jeton de reprise opaque à usage unique (offre, rythme, montant), sans donnée personnelle dans l'URL.
5. Le site utilise la bibliothèque de design partagée (`packages/ui`) et l'identité validée (noir et blanc, une couleur par univers).
6. Déploiement **séparé** de l'API et des applications connectées : une panne de l'API ne fait pas tomber le site (dernier catalogue publié, daté).

## Conséquences

- (+) Acquisition et partage (WhatsApp, Facebook, moteurs de recherche) sans alourdir la PWA ni l'app mobile.
- (+) Surface d'attaque réduite : lecture seule, aucun secret côté site, aucune donnée personnelle.
- (+) Une seule source de vérité pour les prix et les simulations.
- (−) Une application de plus à maintenir et à tester (lot 26).
- (−) Délai de propagation entre la dépublication d'une offre et sa disparition du site (borné à 15 min, F-PUB-002).

## Alternatives écartées

| Alternative | Raison |
|---|---|
| Ajouter des pages publiques dans la PWA client | Mélange public et connecté ; indexation et performance plus difficiles ; risque d'exposer des routes authentifiées |
| Constructeur de site externe (CMS hébergé) | Catalogue et simulateur dupliqués hors du monorepo ; écart de calcul possible ; dépendance à un tiers |
| Site purement statique sans catalogue | Ne remplit pas l'objectif d'acquisition (montrer de vraies offres) |
