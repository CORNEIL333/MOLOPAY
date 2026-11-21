# Direction UX et UI

> Version 1.0 · 20 novembre 2026 · Dossier de référence pour tout ce qui touche à l'expérience et à l'interface : produit, agents des lots 19 (app mobile), 20 (portail partenaire), 21 (back-office), 26 (site public) et `packages/ui`.
> Identité **validée par le fondateur** le 20 novembre 2026. Nom commercial **provisoire** (« MoloPay ») : voir `02_identite_visuelle.md` § Nom.

## Contenu

| Fichier | Contenu |
|---|---|
| `01_inventaire_et_analyse.md` | Inventaire des composants et des écrans existants dans le code (branches d'agents), analyse de leur suffisance face au cahier des charges, manques prioritaires |
| `02_identite_visuelle.md` | Règles d'identité : couleurs, typographie, formes, composants, logo, ton, alerte sur le nom |
| `03_inspirations.md` | Références visuelles fournies par le fondateur et ce qui en a été retenu |
| `04_catalogue_des_ecrans.md` | Liste de tous les écrans maquettés, par application, avec les exigences qu'ils couvrent |
| `05_historique_des_decisions.md` | Chronologie des choix de direction et de leurs raisons |
| `06_animations.md` | **Charte d'animation** : principes, jetons de durées, courbes et ressorts, catalogue des animations `M-xx`, haptique, réduction du mouvement, performance, sources |
| `07_psychologie_de_marque_et_ux.md` | **Recherche approfondie** : sciences comportementales de l'épargne, confiance au Cameroun, psychologie des couleurs et des formes, adoption par les partenaires, dark patterns et droit (loi 2011/012, CEMAC), fintechs de référence ; recommandations et liste de ce que MoloPay s'interdit |
| `08_ux_inclusive_et_publics_cibles.md` | **Recherche approfondie n° 2** : usagers peu lettrés et téléphones d'entrée de gamme, USSD, inscription/KYC/activation (règlement CEMAC 02/24), diaspora, bailleurs et écoles ; recommandations priorisées et questions ouvertes |
| `recherche/notes_01_psychologie/` | Les six notes sourcées du rapport 07 |
| `recherche/notes_02_ux_inclusive/` | Les cinq notes sourcées du rapport 08 |
| `maquettes/identite-app-mobile.html` | Identité + 10 écrans de l'app mobile (dont 5 de marketplace) |
| `maquettes/ecrans-web.html` | Portail partenaire, client web (PWA), back-office, CRM (8 écrans) |
| `maquettes/site-public.html` | Site public marketplace d'acquisition (lot 26, ADR-0006) |
| `maquettes/parcours-inclusifs.html` | Parcours issus de la recherche : montants en 4 façons avec voix, simulateur USSD, inscription et KYC, diaspora, bailleurs et écoles |
| `maquettes/parcours-credit.html` | Prototype navigable du parcours crédit (modèle B), du choix au dernier remboursement, avec refus et retard |
| `maquettes/animations.html` | Démo rejouable de chaque animation `M-xx`, avec le mode « Réduire les animations » |

Les maquettes sont des pages HTML autonomes : ouvrez-les dans un navigateur. Plusieurs sont interactives (versement, comptoir de remise, filtres, simulateur). Noms, prix, TEG, boutiques et délais y sont **fictifs**.

## Versions publiées (privées, à partager depuis le menu Partager)

| Maquette | Lien |
|---|---|
| Identité et app mobile | https://claude.ai/artifact/4mPusaL3SqFjWiUkiej7or |
| Écrans web | https://claude.ai/artifact/31Cd8bm8GJ4vSCURaoj27a |
| Site public | https://claude.ai/artifact/JvviqmNBqMWe4FJWHq5TAc |
| Animations | https://claude.ai/artifact/6eFyZNuZKuqVQK8UBY6Gxj |
| Parcours inclusifs | https://claude.ai/artifact/Pp4XakjyfxyuPaWEm4yFfg |
| Parcours crédit | https://claude.ai/artifact/NF38SQG884Mjir97pHkbew |

Les fichiers de ce dossier font foi ; en cas d'écart avec une version publiée, mettre à jour la version publiée.

## Liens avec le reste du dossier

- Exigences d'expérience : `CDC_02` NF-UX-001…007 (WCAG 2.2 AA, FR/EN, hors ligne, animations), `CDC_01` § 15 et `CDC_02` § 11 (site public).
- Décision d'architecture du site public : `04_annexes/adr/ADR-0006-site-public-marketplace.md`.
- Lots concernés : `03_agents_ia/PLAN_DE_LOTS.md` (19, 20, 21, 26, H8).

## Prochaines étapes

1. Traduire l'identité en **design system codé** : jetons clair et sombre dans `packages/ui` (web) et thème Flutter partagé (mobile), puis remplacer les deux palettes divergentes actuelles (voir `01_inventaire_et_analyse.md`).
2. Ajouter à `packages/ui` les composants manquants listés en § 3 de l'analyse.
3. Faire vérifier la disponibilité du nom à l'OAPI avant de finaliser le logo (lot H8).
