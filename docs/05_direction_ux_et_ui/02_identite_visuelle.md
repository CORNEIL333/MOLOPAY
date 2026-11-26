# Identité visuelle validée

> Version 1.1 · 26 novembre 2026 · Identité validée par le fondateur le 20 novembre 2026 ; **matières liquide et verre adoptées le 26 novembre 2026** (§ Matières). Référence visuelle pour les lots 19 (app mobile), 20 (portail partenaire), 21 (back-office), 26 (site public) et pour `packages/ui`.

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

## Matières : liquide et verre (adoptées le 26 novembre 2026)

Référence visuelle : `maquettes/exploration-direction-liquide.html` (modes Liquide, Actuel, Sobre). Jetons : `glass.*`, `gradient.*` et `motion.duration.liquid` dans `jetons/`.

**Principe : le verre décore et sépare, il ne porte jamais l'argent.**

| | Règle |
|---|---|
| **Fonds liquides** | Taches floues mélangeant les teintes de l'univers de l'écran (`gradient.<univers>`), ou des quatre univers sur l'accueil (`gradient.home`), avec un grain très léger (8 %). Mouvement très lent (26 à 38 s). En production : **pré-calculés** (image AVIF/WebP ou dégradés radiaux), animés en `transform` seulement, jamais de flou en direct. |
| **Aurore** | Écrans sombres de l'argent (verser, succès) : `gradient.aurora`, **figée** pendant toute saisie (montant, PIN, signature). |
| **Verre** | Réservé au décor et à la navigation : barre flottante, boutons d'icône, pastilles, en-têtes, variantes de produit, carte du total, jauge. **Au plus 2 surfaces en verre visibles** à la fois ; flou de 20 px au plus. |
| **Lisibilité** | Verre clair ≥ 62 % de blanc et texte noir ; texte secondaire sur verre `#45484e` (le gris `#6a6d73` passe sous 4,5:1). Verre sombre ≥ 72 % d'encre et texte blanc. Tout texte sur une image ou un fond vivant reçoit un voile ou une surface de verre au contraste mesuré. |
| **Surfaces opaques obligatoires** | Montants, reçus, statuts de paiement, coûts, conditions, formulaires : papier, encre ou couleur d'univers **pleine**. |
| **Actions** | Sur un écran coloré ou liquide, l'action principale reste **noire** (blanche sur sombre), jamais de la couleur du fond. |
| **Produit** | Sur la fiche produit, le fond prend l'univers du produit ; l'objet est détouré, avec une ombre portée douce ; la feuille d'achat est blanche et opaque. |
| **Repli Sobre** | Automatique si l'utilisateur demande moins de transparence ou de mouvement (préférence système ou réglage de l'app « Effets visuels : sobres »), ou si l'app détecte plus de 5 % d'images au-delà de 16 ms : flou retiré, verre à 94 % d'opacité, fonds figés. L'allure reste la même. |
| **Où il n'y a pas de verre** | Back-office, portail partenaire, USSD, SMS : outils denses ou texte seul, à plat. |

## Nom

« MoloPay » est très proche de **MoloMolo Pay**, application **ivoirienne** de paiement différé citée dans `01_projet/03_analyse_concurrentielle.md`. Le Cameroun et la Côte d'Ivoire relèvent tous deux de l'**OAPI** : un dépôt risque l'opposition et les clients pourraient confondre les deux services. Faire vérifier la disponibilité par un conseil en propriété industrielle avant de finaliser le logo (lot H8). Pistes de remplacement, **non vérifiées** : Kotiz, Pas à Pas, Objekti. L'identité fonctionne avec un autre nom : seul le mot à côté de l'anneau change.

## Règles issues de la recherche (rapports 07 et 08)

| Règle | Pourquoi |
|---|---|
| Les couleurs d'univers ne servent **que d'aplats sous du texte et des icônes noirs**, jamais comme couleur de texte sur blanc (contraste 1,25 à 1,80:1) | Contraste WCAG ; rapport 07 |
| Un état n'est **jamais** signalé par la couleur seule : icône + mot + son | Publics peu alphabétisés ; rapport 08 |
| Le citron reste nettement **vert**, jamais jaune ; aucun trio vert-rouge-jaune du drapeau | Confusion avec MTN ; signal politique ; rapport 07 |
| Le rose hibiscus n'est jamais une couleur d'erreur ; l'erreur reste rouge `#c4262e` avec icône et texte | Distinction rose/rouge ; rapport 07 |
| La chaleur des formes arrondies est compensée par des **preuves de solidité** : montants alignés, frais en un chiffre, banque partenaire nommée, reçus numérotés | Chaleur vs compétence ; rapport 07 |
| Chaque montant d'argent s'affiche **de quatre façons** dans les parcours de paiement : chiffres, formule orale (« 25 mille »), billets CEMAC à liseré, voix | 30 % d'erreurs d'ordre de grandeur (CGAP) ; rapport 08 |
| Bouton **« Écouter »** fixe sur chaque écran d'argent ; relecture à voix haute avant le PIN | Medhi ; J-PAL Ghana ; rapport 08 |
| Séparateur de milliers : espace fine U+202F dans l'app (à tester sur Android d'entrée de gamme), **espace ordinaire** dans les SMS et l'USSD (U+202F hors GSM-7) | Rapport 08 |
| USSD et SMS : 160 caractères au plus, alphabet GSM-7 (garder é, è, à ; retirer ê, â, î, ô, û, ç) ; anneau en texte `[####----] 4/8` | Rapport 08 |
| Le badge « vérifié » (partenaire, bailleur, école) est noir et blanc **avec un mot**, jamais une simple couleur | Rapport 08 |

Démonstration de ces règles : `maquettes/parcours-inclusifs.html`.
