# Passage des maquettes au MVP 0.0.1

> Version 1.0 · 25 novembre 2026 · Prépare la mise en code de la direction UX et UI. Référence du code : branche `sprint/integration-t01urw` (commit `c58f6ea`, contrat OpenAPI **0.42.0**, 95 routes ; depuis, le commit `23186ed` en **0.44.0** ajoute la déclaration de décès au back-office, l'écran mobile « mise à jour requise » et le règlement au bénéficiaire C sous PIN sur mobile). Les éléments marqués **[Décision]** sont des propositions à valider par le fondateur.

## 1. Ce qu'est le MVP 0.0.1

**[Décision] proposée :** le MVP 0.0.1 est la **première version de test fermé** (interne puis 50 clients, `CDC_07` § 4). Ce n'est **pas** l'ouverture au public : la porte de lancement unique reste la règle (`04_annexes/checklist_porte_lancement.md`). Il s'agit d'une tranche verticale qui tient compte de trois décisions prises par le fondateur le 24 novembre (`docs/journal/DECISIONS_EN_ATTENTE.md` sur la branche d'intégration) :

| Décision | Conséquence pour les interfaces |
|---|---|
| **D92** : aucun versement au lancement, en attendant l'agrégateur | Les écrans « Verser » existent, mais dans un état **« Versements bientôt disponibles »** : pas de bouton qui fait croire qu'on peut payer, et l'anneau reste vide et honnête. |
| **C13** : inscription en agence, sans SMS | Un nouveau parcours « J'ai un code d'agence » s'ajoute à l'inscription, avec la vérification de la pièce en présence de l'agent. C'est cohérent avec le rapport 08 (inscription assistée). |
| **D89 / D90** : le navigateur peut servir d'appareil ; la clé matérielle sur mobile reste ouverte | L'inscription se termine sur le client web (PWA) tant que D90 n'est pas tranchée. L'app mobile affiche un message clair si elle n'a pas de clé. |

### Dans le 0.0.1

1. **Unifier l'identité** sur tous les écrans existants (client web, mobile, portail partenaire, back-office). Ce n'est pas optionnel : deux palettes obsolètes coexistent aujourd'hui (§ 4).
2. **Modèles A et C sans encaissement** : inscription (SMS ou agence), conditions, catalogue et recherche, fiche produit, réservation (création, signature, activation), suivi de l'objectif, annulation et verrouillage, réclamation.
3. **Remise** : écran du code de remise côté client (la route `GET /v1/goals/{goalId}/handover-code` existe mais n'a pas d'écran, cf. D69) et comptoir du partenaire, déjà en place.
4. **Back-office et portail** : les écrans existants, restylés.

### Hors du 0.0.1, et pourquoi

| Élément | Raison | Maquette prête |
|---|---|---|
| Versements réels | D92, pas d'agrégateur (lot 11, H3) | `identite-app-mobile.html` (Verser), `parcours-inclusifs.html` |
| Crédit (modèle B) | Pas de module `lending` ; financeur non choisi (D44) | `parcours-credit.html` |
| Diaspora | Pas de canal de transfert agréé (lot 22) | `parcours-inclusifs.html`, `ecrans-complementaires.html` |
| USSD | Pas d'accès opérateur ni d'agrégateur (lot 18) | `parcours-inclusifs.html` |
| Site public | ADR-0006 au statut Proposé (lot 26) | `site-public.html` |
| Favoris côté serveur | Pas d'API ; **[Décision]** au 0.0.1, favoris stockés sur l'appareil seulement | `marketplace-suite.html` |
| Abonnements partenaires, rapports régulateur | Pas d'API ; prix et formats non fixés | `ecrans-complementaires.html` |

## 2. Fondations à poser en premier (étape 0)

| # | Fondation | Fichier fourni | Où l'intégrer |
|---|---|---|---|
| F1 | **Jetons de design** (couleurs, typographie, rayons, espaces, cibles, mouvement) | `jetons/molopay.tokens.json` (source unique) → `jetons/tokens.css`, `jetons/tokens.ts`, `jetons/molopay_tokens.dart` générés par `jetons/generate.py` | `packages/ui/src/` (remplace `tokens.ts` et les variables `--achat-*` de `styles.css`) ; `apps/mobile/lib/ui/` (remplace `design.dart`) |
| F2 | **Polices** Outfit et Inter | — | Auto-hébergées : `next/font/local` sur le web, assets Flutter sur mobile. **Pas de Google Fonts à l'exécution** (CSP, données mobiles, NF-PUB-001). Licence SIL OFL à joindre au SBOM. |
| F3 | **Anneau de cotisation** (logo, chargement, progression) | Code de référence dans `maquettes/*.html` (fonction `ring`) | Composant partagé `Ring` (web) et `CotisationRing` (Flutter, `CustomPainter`, `RepaintBoundary`) |
| F4 | **Icônes** au trait de 1,5 à 1,8 px, coins arrondis | Dessins SVG en ligne dans les maquettes | Jeu SVG unique dans `packages/ui/icons` ; équivalent Flutter. Pas de police d'icônes externe. |
| F5 | **Mode réduit** du mouvement | `06_animations.md` § 3.4 et § 6 | Variables CSS réduites (déjà dans `tokens.css`) ; `MpMotion` + lecture de `disableAnimations` **et** `reduceMotion` |
| F6 | **Format des montants** | `02_identite_visuelle.md` (règles issues de la recherche) | `packages/money` reste la seule source du calcul ; l'affichage « 25 000 FCFA » passe par un seul formateur par plateforme. Espace ordinaire dans les SMS. |
| F8 | **Matières liquide et verre** (adoptées le 26 novembre) | `jetons/` (`glass.*`, `gradient.*`), `02_identite_visuelle.md` § Matières, `maquettes/exploration-direction-liquide.html` | Composants `GlassSurface` et `LiquidBackground` (web et Flutter) avec repli Sobre intégré ; réglage « Effets visuels : sobres » dans Profil |
| F7 | **Textes FR et EN** | `textes/mvp_0.0.1_fr_en.json` | Fichiers i18n existants (`apps/*/src/i18n`, `apps/mobile/lib/l10n/strings.dart`) |

**Ordre imposé :** F1 → F2 → F5 → F8 → F6 → F3 et F4 → F7. Aucun écran ne se restyle avant F1, F2 et F5.

## 3. Composants à construire ou refaire

Neuf composants existent aujourd'hui dans `packages/ui` : Button, TextField, TextArea, Badge, ProgressBar, GoalCard, AmountXaf, EmptyState, ErrorState. Pour le 0.0.1 :

| Composant | Web | Flutter | États obligatoires | Accessibilité | Mouvement | Statut |
|---|---|---|---|---|---|---|
| Fond liquide (`LiquidBackground`) | à créer | à créer | animé, figé, Sobre | décoratif (`aria-hidden`), jamais sous un montant | M-56 | Créer |
| Surface de verre (`GlassSurface`) | à créer | à créer | clair, sombre, Sobre | contraste mesuré ; au plus 2 par écran | — | Créer |
| Bouton pilule (principal, fantôme, danger) | `Button` à refaire | à créer | repos, pressé, désactivé, chargement | ≥ 48 px, libellé = action | M-01 | Refaire |
| Bouton d'icône rond | à créer | à créer | repos, pressé, actif | `aria-label` obligatoire, 40–44 px | M-01 | Créer |
| Pastille de choix (puce) | à créer | à créer | inactive, active, désactivée | `aria-pressed` | M-04 | Créer |
| Champ texte, champ PIN/OTP | `TextField` à refaire ; PIN à créer | à créer | vide, saisi, erreur, désactivé | libellé visible, erreur reliée, OTP auto (SMS Retriever) | M-36, M-27 | Refaire / Créer |
| Montant (4 représentations) | `AmountXaf` à étendre | à créer | normal, grand, avec voix | lecture audio, chiffres tabulaires | M-21 | Étendre |
| Pastilles de montant | à créer | à créer | — | pas de champ libre dans l'argent | M-04 | Créer |
| Carte de projet par univers | `GoalCard` à refaire | à créer | en cours, 100 %, annulé, verrouillé, gelé | état = icône + mot, jamais couleur seule | M-13, M-22 | Refaire |
| Anneau de cotisation | à créer | à créer | 0 à 8 traits, attente (boucle), fixe | texte équivalent « 4 sur 8 » | M-20, M-24 | Créer |
| Feuille du bas | à créer | à créer | ouverte, fermée, glissée | focus piégé, Échap ferme | M-12 | Créer |
| Fenêtre de confirmation | à créer | à créer | — | rôle `dialog`, focus initial | M-16 | Créer |
| Glisser pour confirmer | à créer | à créer | repos, glissé, verrouillé | alternative clavier et lecteur d'écran | M-23 | Créer |
| Notification temporaire (toast) | à créer | à créer | info, succès, erreur | `role="status"`, ≥ 4 s | M-35 | Créer |
| Squelette de chargement | à créer | à créer | — | affiché après 300 ms seulement | M-30 | Créer |
| Bandeau hors ligne | à créer | à créer | — | date de dernière mise à jour | M-33 | Créer |
| Barre de navigation flottante | à créer | à créer | onglet actif | 4 onglets, libellés lisibles par lecteur d'écran | M-11 | Créer |
| Tableau (portail, back-office) | à créer | — | tri, vide, chargement | en-têtes, chiffres alignés à droite | M-34 | Créer |
| Pastille de statut | `Badge` à refaire | à créer | succès, attention, erreur, info | point + mot | — | Refaire |
| États vides et d'erreur | `EmptyState`, `ErrorState` à refaire | à créer | — | dit quoi faire | — | Refaire |

## 4. Correspondance écran → maquette → code → API

Statuts : **Restyler** = l'écran existe, on applique l'identité. **Compléter** = l'écran existe, il manque une partie. **Créer** = nouvel écran. **État bloqué** = écran prêt, fonction désactivée honnêtement.

### 4.1 Client (PWA `apps/web-client` et mobile `apps/mobile`)

| Écran | Maquette | Web existant | Mobile existant | API (0.42.0) | Statut 0.0.1 |
|---|---|---|---|---|---|
| Accueil, projets empilés | `identite-app-mobile.html` · Accueil | `/objectifs` | `home_screen.dart` | `GET /v1/goals`, `GET /v1/me` | Restyler |
| Inscription par SMS | `parcours-inclusifs.html` · Inscription | `/inscription` | `signup_screen.dart` | `POST /v1/auth/otp-challenges`, `POST /v1/auth/signups` | Restyler (Twilio pas encore configuré) |
| **Inscription avec code d'agence** | `parcours-inclusifs.html` · Pièce d'identité (variante agence) | à ajouter dans `/inscription` | à ajouter | `POST /v1/auth/signups` (code émis par `POST /v1/backoffice/agency-enrollments`) | Créer |
| Connexion (défi signé + PIN) | — | `/connexion` | `login_screen.dart` | `POST /v1/auth/device-challenges`, `POST /v1/auth/sessions` | Restyler |
| Conditions en couches | `parcours-inclusifs.html` · CGU | `/compte` (version en vigueur) | `account_screens.dart` | `POST /v1/me/terms-acceptances` | Compléter (5 points, audio, consentements séparés) |
| Catalogue | `identite-app-mobile.html` · Catalogue | `/` (vue catalogue et filtres) | `catalog_screen.dart` | `GET /v1/offers` | Restyler |
| Recherche | `marketplace-suite.html` · Recherche | à créer | à créer | `GET /v1/offers` (filtres) ; tolérance aux fautes côté client au 0.0.1 | Créer |
| Fiche produit | `identite-app-mobile.html` · Fiche produit | `/offres/[offerId]` | `offer_quote_panel.dart` | `GET /v1/offers/{offerId}`, `POST /v1/offers/{offerId}/quotes` | Restyler (sans l'onglet « Financer ») |
| Favoris | `marketplace-suite.html` · Favoris | à créer | à créer | aucune (stockage local) | Créer |
| Réservation (4 étapes, modèle A) | `marketplace-suite.html` · Réservation | depuis `/offres/[offerId]` (formulaire de démarrage d'objectif) | `offer_quote_panel.dart`, `goals_screen.dart` | `GET /v1/plans`, `POST /v1/goals`, `GET /v1/goals/{id}/signing-payload`, `POST /v1/goals/{id}/activation` | Restyler + compléter (étapes, relecture de l'accord) |
| Dépense planifiée (modèle C) | `parcours-inclusifs.html` · Bailleurs et écoles | `/objectifs/nouveau` | `planned_expense_screen.dart` | `POST /v1/goals/{id}/beneficiary-documents`, `beneficiary-payment`, `beneficiary-receipt` | Restyler |
| Suivi de l'objectif | `identite-app-mobile.html` · Objectif | `/objectifs/[goalId]` | `goals_screen.dart` | `GET /v1/goals/{id}`, `GET /v1/goals/{id}/contributions` | Restyler |
| **Verser** | `identite-app-mobile.html` · Verser | — | — | aucune (D92) | **État bloqué** : « Versements bientôt disponibles » |
| **Code de remise** | `identite-app-mobile.html` · Code de remise | à créer | à créer | `GET /v1/goals/{id}/handover-code` | Créer (D69) |
| Annuler, verrouiller | `animations.html` · M-16 | `/objectifs/[goalId]` | `goals_screen.dart` | `POST /v1/goals/{id}/cancellation`, `POST /v1/goals/{id}/lock` | Restyler (fenêtre de confirmation) |
| Réclamation | `ecrans-web.html` · CRM (vue client) | `/objectifs/[goalId]` | — | `POST /v1/goals/{id}/claims` | Restyler |
| Notifications | — | `/compte/notifications` | `notifications_screen.dart` | `GET /v1/me/notifications` | Restyler |
| Compte, sécurité, données, nom légal | — | `/compte`, `/compte/donnees`, `/compte/identite` | `account_screens.dart`, `profile_screen.dart` | `GET /v1/me/security`, `POST /v1/me/security/block`, `…/revoke-other-sessions`, `GET POST /v1/me/data-rights`, `POST /v1/me/legal-name` | Restyler |
| PWA : installation et hors ligne | `ecrans-web.html` · PWA | manifeste et `offline.css` existants | — | — | Restyler (icône et manifeste à la nouvelle identité) |

### 4.2 Portail partenaire (`apps/partner-portal`)

| Écran | Maquette | Existant | API | Statut |
|---|---|---|---|---|
| Connexion, enrôlement | — | `/` (connexion), `/enrolement` | `POST /v1/partner/login-challenges`, `/sessions`, `/credentials` | Restyler |
| Tableau de bord du gérant | `ecrans-web.html` · Tableau de bord | à créer (aujourd'hui : commandes et règlements séparés) | `GET /v1/partner/orders`, `/payouts`, `/offers` | Créer |
| Comptoir | `ecrans-web.html` · Comptoir | `/comptoir` | `POST /v1/partner/handovers` | Restyler (cases de contrôle et numéro de série) |
| Commandes, export CSV | `ecrans-web.html` · Remises à venir | `/commandes` | `GET /v1/partner/orders`, `/orders/export` | Restyler |
| Offres | — | `/offres` | `GET /v1/partner/offers` | Restyler |
| Règlements | — | `/reglements` | `GET /v1/partner/payouts` | Restyler (commission en FCFA par vente) |
| Vendeurs | — | `/vendeurs` | `GET /v1/partner/users`, `POST /v1/partner/sellers`, `…/disable`, `…/enrollments` | Restyler |
| Abonnement | `ecrans-complementaires.html` · Abonnements | — | aucune | Hors 0.0.1 |

### 4.3 Back-office et CRM (`apps/back-office`)

| Écran | Maquette | Existant | Statut |
|---|---|---|---|
| Vue d'ensemble | `ecrans-web.html` · Vue d'ensemble | `/tableau-de-bord` | Restyler |
| File de travail à double contrôle | `ecrans-web.html` · File de travail | `/file` | Restyler |
| Inscription en agence | `parcours-inclusifs.html` · Pièce d'identité (principes) | `/clients/inscription-agence` | Restyler |
| Blocage, gel | — | `/clients/blocage`, `/incidents/gel` | Restyler |
| Historique d'objectif | `ecrans-web.html` · Fiche client (chronologie) | `/objectifs` | Restyler |
| Réclamations | `ecrans-web.html` · Réclamations | `/reclamations` | Restyler |
| Fiche client 360° | `ecrans-web.html` · Fiche client | branche `agent/qoder/crm` (PR #10) | Restyler à l'intégration |
| Conformité, administration, enrôlement | — | `/conformite`, `/administration`, `/enrolement` | Restyler |
| Validation partenaire, vérification bailleur | `ecrans-complementaires.html` | via la file de travail | Compléter (écran détaillé) |

## 5. Critères d'acceptation d'un écran (définition de « terminé » pour l'interface)

Un écran est terminé quand **tous** ces points sont prouvés dans la PR :

- [ ] Il n'utilise que les jetons (aucune couleur, taille, durée ni courbe en dur) ; l'ancienne palette n'apparaît plus (`0b6b53`, `e4a11b`, `F16B27` introuvables).
- [ ] Captures jointes en **clair**, en **sombre**, en mode **« réduire les animations »** et en mode **Sobre** (verre et fonds liquides remplacés), à 360 px et, pour le web, à 1 280 px.
- [ ] Contrastes WCAG 2.2 AA mesurés ; cibles ≥ 44 px ; parcours complet au clavier et au lecteur d'écran (TalkBack ou VoiceOver, NVDA ou VoiceOver sur le web).
- [ ] Textes en **français et en anglais** complets, sans troncature à 200 % de taille de police.
- [ ] Les animations citent leur `M-xx` ; **aucun montant, aucune jauge, aucun statut ne s'anime avant la réponse du serveur** (test qui le vérifie).
- [ ] Chaque montant passe par le formateur unique ; chiffres tabulaires.
- [ ] États vides, chargement (squelette après 300 ms), erreur (dit quoi faire), hors ligne.
- [ ] Aucune des 15 pratiques interdites (`07_psychologie_de_marque_et_ux.md`) ; coût total visible avant tout engagement.
- [ ] Verre : au plus 2 surfaces visibles, aucun montant ni statut sur du verre, aucun fond animé pendant une saisie.
- [ ] Performance mesurée sur l'appareil de référence (Android d'entrée de gamme, 2 Go, 4G) : aucune image au-delà de 16 ms sur les animations M-13, M-21, M-23.

## 6. Ordre de travail proposé

| Étape | Contenu | Agent proposé | Dépend de |
|---|---|---|---|
| U0 | Fondations F1 à F7 (jetons, polices, mode réduit, montants, anneau, icônes, textes) | Gemini | — |
| U1 | Composants du § 3, web puis Flutter | Gemini | U0 |
| U2 | Client web : restyle des écrans existants, puis recherche, favoris, réservation en 4 étapes, code de remise, inscription par code d'agence, état « Versements bientôt » | Gemini | U1 |
| U3 | App mobile : mêmes écrans | Gemini | U1, D90 pour l'inscription complète |
| U4 | Portail partenaire et back-office : restyle, comptoir complété | Gemini, puis Qoder pour le CRM | U1 |
| U5 | Recette des interfaces : captures, accessibilité, performance, 5 tests utilisateurs avec « réduire les animations » | Vérificateur + fondateur | U2 à U4 |

Une PR par étape et par application, de 400 lignes au plus hors code généré (`AGENTS.md` § 14).

## 7. Conflits et points à trancher

| Sujet | Constat | Proposition |
|---|---|---|
| Prompts d'interface anciens | `docs/journal/PROMPT_STITCH_APP_MOBILE.md` et `PROMPT_CHATGPT_APP_MOBILE.md` (branche d'intégration) imposent encore **vert `#0B6B53` et or `#E4A11B`** | **[Décision]** Les marquer « remplacés par `05_direction_ux_et_ui` » ; ne plus les utiliser |
| Tons du drapeau | Aucun écran n'utilise le trio vert, rouge, jaune | Rien à faire, à surveiller en revue |
| Favoris | Aucune API | **[Décision]** Stockage local au 0.0.1, API plus tard |
| Recherche tolérante | `GET /v1/offers` filtre exactement | Correspondance de synonymes côté client au 0.0.1 ; recherche serveur plus tard |
| Écran « Verser » | D92 : aucun versement | État bloqué, avec un texte qui ne promet aucune date |
| Clé matérielle mobile | D90 ouverte | L'inscription se termine sur le web ; message clair sur mobile |
| Nom commercial | Risque OAPI | Le mot « molopay » reste un paramètre de marque, séparé de l'anneau |

## 8. Fichiers de ce dossier utiles à la mise en code

- `jetons/` : source unique des jetons et fichiers générés.
- `textes/mvp_0.0.1_fr_en.json` : textes clés en français et en anglais.
- `maquettes/` : référence visuelle et comportementale de chaque écran.
- `02_identite_visuelle.md`, `06_animations.md` : règles.
- `04_catalogue_des_ecrans.md` : exigences couvertes par chaque écran.
