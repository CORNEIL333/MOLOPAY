# Identité visuelle validée

> Version 1.0 · 20 novembre 2026 · Identité validée par le fondateur le 20 novembre 2026. Référence visuelle pour les lots 19 (app mobile), 20 (portail partenaire), 21 (back-office), 26 (site public) et pour `packages/ui`.

Les maquettes du dossier `maquettes/` sont des **fichiers HTML autonomes** : ouvrez-les dans un navigateur. Les noms de clients, boutiques, prix, TEG et délais sont **fictifs** ; « MoloPay » est un nom commercial provisoire (voir § Nom ci-dessous).

| Fichier | Contenu | Lots |
|---|---|---|
| `maquettes/identite-app-mobile.html` | Identité (couleurs, typographie, composants, logo, ton) et 10 écrans de l'app mobile, dont la marketplace | 19, `packages/ui` |
| `maquettes/ecrans-web.html` | Portail partenaire, client web (PWA), back-office et CRM | 20, 21, PWA |
| `maquettes/site-public.html` | Site public marketplace d'acquisition (simulateur, catalogue, fiche produit, inscription) | 26 |

## Règles d'identité à respecter

- **Base noir et blanc** : actions principales en pilule noire (blanche sur fond sombre), une seule par écran.
- **Une couleur par univers**, uniquement pour les projets et les catégories, jamais pour une action ni une erreur :

| Univers | Couleur | Hex |
|---|---|---|
| Essentiels | citron | `#d9f26b` |
| Technologie et équipement | ciel | `#8fddf5` |
| Logement et immobilier | lilas | `#c3bdff` |
| Mobilité et activité pro | hibiscus | `#ffa8c5` |

- Encre `#0f1012`, papier `#ffffff`, brume `#f2f2ee`, erreur `#c4262e`. Ni jaune ni orange de marque (pour ne pas évoquer MTN ou Orange Money).
- Statuts (succès, attention, erreur) distincts des couleurs d'univers.
- Typographie : **Outfit** (montants, titres) et **Inter** (texte) ; chiffres tabulaires ; « 25 000 FCFA ».
- Coins très arrondis (20 à 44 px), cibles tactiles ≥ 44 px, contrastes WCAG 2.2 AA au minimum.
- Écrans sombres pour les moments d'argent (verser, confirmer), « glisser pour confirmer » avant le PIN.
- Logo : l'anneau de cotisation (8 traits qui se remplissent) et le mot en minuscules.
- Ton : vouvoiement, chiffres exacts, chaque erreur dit ce qui s'est passé et quoi faire.

## Nom

« MoloPay » est très proche de **MoloMolo Pay**, application **ivoirienne** de paiement différé citée dans `01_projet/03_analyse_concurrentielle.md`. Le Cameroun et la Côte d'Ivoire relèvent tous deux de l'**OAPI** : un dépôt risque l'opposition et les clients pourraient confondre les deux services. Faire vérifier la disponibilité par un conseil en propriété industrielle avant de finaliser le logo (lot H8). Pistes de remplacement, **non vérifiées** : Kotiz, Pas à Pas, Objekti. L'identité fonctionne avec un autre nom : seul le mot à côté de l'anneau change.
