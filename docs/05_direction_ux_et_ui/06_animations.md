# Charte d'animation (motion design)

> Version 1.0 · 20 novembre 2026 · S'applique à l'app mobile (Flutter), au client web (PWA), au portail partenaire, au back-office et au CRM, et au site public. Démo interactive de chaque animation : `maquettes/animations.html`.
> Les valeurs de durée, de courbe et de ressort reprennent les jetons de Material 3 publiés par Google (voir § 9). Les choix propres à MoloPay sont marqués **[Décision]**.

## 1. Principes

1. **Le mouvement explique un changement.** Chaque animation répond à une question : d'où vient cet élément, où va-t-il, qu'est-ce qui vient de changer ? Sinon, pas d'animation.
2. **L'argent avance sûrement, il ne rebondit pas.** [Décision] Aucun rebond ni dépassement sur un montant, un solde, un statut de paiement ou un reçu : ce sont des faits. Le ressort est réservé aux gestes (cartes, feuilles, glisser) et à la célébration des 100 %.
3. **Jamais de faux succès.** Un montant, une jauge ou une coche ne s'animent qu'**après** la confirmation du serveur (F-SAV-002). Avant, on montre l'attente, honnêtement.
4. **Une seule chorégraphie par écran.** Un moment fort à la fois (la coche, puis le compteur), jamais tout en même temps.
5. **Rapide d'abord.** Un appui répond en moins de 0,1 s, sinon l'interface paraît lente ; une transition dure entre 150 et 500 ms (§ 3).
6. **Le mouvement ne porte jamais seul l'information.** Toute animation d'état est doublée d'un texte, d'une couleur ou d'une icône, et d'un retour haptique sur mobile.
7. **Tout fonctionne sans animation.** Préférence « réduire les animations » respectée partout (§ 6), téléphones d'entrée de gamme en priorité (§ 7).

## 2. Personnalité du mouvement par interface

| Interface | Caractère | Règle |
|---|---|---|
| App mobile et PWA | Chaleureux et précis | Courbes « accentuées », gestes au doigt, haptique, célébration à 100 % |
| Site public | Le plus expressif | Ambiance (halos, défilé, inclinaison) autorisée, toujours avec pause et réduction |
| Portail partenaire | Efficace | Retours clairs au comptoir (code valide ou refusé), pas de transitions de page |
| Back-office et CRM | Sobre et instantané | Fondus courts seulement ; aucune transition de page ; surlignage des nouveautés |
| USSD et SMS | Aucun | Texte seul |

## 3. Jetons

### 3.1 Durées

| Jeton MoloPay | Valeur | Jeton M3 | Usage |
|---|---|---|---|
| `motion.instant` | 0 ms | — | Focus clavier, mode réduit |
| `motion.micro` | 100 ms | short2 | Appui, case, interrupteur, puce de pavé numérique |
| `motion.short` | 150 ms | short3 | Survol, apparition d'un message d'erreur, sorties de petits éléments |
| `motion.base` | 250 ms | medium1 | Onglets, puces, fondus, notifications, fenêtres de confirmation |
| `motion.medium` | 350 ms | medium3 | Feuille du bas, écran qui entre, coche de succès |
| `motion.long` | 500 ms | long2 | Carte qui devient un écran, jauge, anneau |
| `motion.xlong` | 800 ms | extra-long2 | Compteur de montant |
| `motion.celebration` | 1 200 ms | — | Célébration des 100 % (une fois par objectif) |

Règles : la durée augmente avec la surface ou la distance parcourue (règle M3) ; [Décision] une sortie dure environ deux tiers de l'entrée (on regarde ce qui arrive, pas ce qui part) ; rien au-delà de 500 ms sur un chemin que l'utilisateur emprunte souvent, sauf le compteur et la célébration.

### 3.2 Courbes

| Jeton MoloPay | `cubic-bezier` | Équivalent M3 | Usage |
|---|---|---|---|
| `ease.standard` | `0.2, 0, 0, 1` | standard | Ce qui commence et finit à l'écran (onglets, puces, jauge) |
| `ease.enter` | `0.05, 0.7, 0.1, 1` | emphasized decelerate | Ce qui entre (feuilles, écrans, cartes, toasts) |
| `ease.exit` | `0.3, 0, 0.8, 0.15` | emphasized accelerate | Ce qui sort |
| `ease.utility.enter` | `0, 0, 0, 1` | standard decelerate | Entrées utilitaires (back-office, messages d'erreur, compteur) |
| `ease.utility.exit` | `0.3, 0, 1, 1` | standard accelerate | Sorties utilitaires |
| `ease.linear` | `0, 0, 1, 1` | linear | Boucles uniquement (chargement, défilé) |

### 3.3 Ressorts (gestes, Flutter et web)

| Jeton | Amortissement | Raideur | Usage |
|---|---|---|---|
| `spring.fast` | 0,9 | 1 400 | Petits éléments : interrupteur, pouce du glisser qui revient |
| `spring.default` | 0,9 | 700 | Éléments partiels : feuille du bas, carte de projet |
| `spring.slow` | 0,9 | 300 | Plein écran |
| `spring.effects` | 1 (sans dépassement) | 1 600 | Couleur, opacité |

[Décision] Les montants et les statuts n'utilisent **jamais** de ressort (principe 2).

### 3.4 Implémentation

```css
/* packages/ui — styles.css */
:root {
  --motion-micro: 100ms; --motion-short: 150ms; --motion-base: 250ms;
  --motion-medium: 350ms; --motion-long: 500ms; --motion-xlong: 800ms;
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-enter: cubic-bezier(0.05, 0.7, 0.1, 1);
  --ease-exit: cubic-bezier(0.3, 0, 0.8, 0.15);
  --ease-utility-enter: cubic-bezier(0, 0, 0, 1);
  --ease-utility-exit: cubic-bezier(0.3, 0, 1, 1);
}
@media (prefers-reduced-motion: reduce) {
  :root { --motion-micro: 0ms; --motion-short: 0ms; --motion-base: 120ms;
          --motion-medium: 120ms; --motion-long: 120ms; --motion-xlong: 0ms; }
}
```

```dart
// apps/mobile — lib/ui/motion.dart
abstract final class Motion {
  static const micro = Duration(milliseconds: 100);
  static const short = Duration(milliseconds: 150);
  static const base = Duration(milliseconds: 250);
  static const medium = Duration(milliseconds: 350);
  static const long = Duration(milliseconds: 500);
  static const xlong = Duration(milliseconds: 800);
  static const standard = Cubic(0.2, 0, 0, 1);
  static const enter = Cubic(0.05, 0.7, 0.1, 1);
  static const exit = Cubic(0.3, 0, 0.8, 0.15);

  /// Vrai si l'utilisateur a demandé moins de mouvement (Android ou iOS) ou dans les réglages de l'app.
  static bool reduced(BuildContext c) =>
      MediaQuery.disableAnimationsOf(c) || MediaQuery.of(c).reduceMotion || AppSettings.of(c).reduceMotion;
}
```

En mode réduit, les durées tombent à 0 ou à un fondu de 120 ms (§ 6). Aucun composant ne code une durée ou une courbe en dur : il passe par ces jetons.

## 4. Catalogue des animations

Chaque animation porte un identifiant `M-xx` à citer dans le code et les PR. Colonne « Réduit » : ce qui la remplace quand l'utilisateur demande moins de mouvement.

### 4.1 Retours immédiats

| ID | Animation | Déclencheur | Durée · courbe | Réduit | Haptique | Où |
|---|---|---|---|---|---|---|
| M-01 | Bouton pressé : échelle 0,97 | Appui | micro · standard | Assombrissement seul | — | Partout |
| M-02 | Anneau de focus | Tabulation | instant | identique | — | Web |
| M-03 | Carte soulevée (−4 px, ombre) et illustration inclinée de 3° | Survol | short · standard | Ombre seule | — | Site, catalogue web |
| M-04 | Pastille de sélection qui glisse vers la puce choisie | Choix d'onglet, de rythme, de filtre | base · standard | Changement instantané | Sélection | Partout |
| M-05 | Interrupteur | Appui | spring.fast | instant | Sélection | Mobile, web |
| M-06 | Touche du pavé numérique | Appui | micro | identique | Sélection | Verser |

### 4.2 Navigation et espace

| ID | Animation | Durée · courbe | Réduit | Où |
|---|---|---|---|---|
| M-10 | Écran suivant : glissement horizontal partagé (l'ancien sort à gauche, le nouveau entre à droite, 30 px + fondu) | medium · enter / exit | Fondu 120 ms | Mobile, PWA |
| M-11 | Onglets de la barre flottante : fondu croisé, pas de glissement | base · standard | Fondu 120 ms | Mobile, PWA |
| M-12 | Feuille du bas : monte depuis le bas, voile de 0 à 45 % ; suit le doigt, relâchée en ressort | entrée medium · enter ; sortie base · exit ; geste spring.default | Fondu 120 ms | Filtres, fiche produit, installation PWA |
| M-13 | **Carte → écran** : la carte de projet grandit jusqu'à devenir l'écran de l'objectif, la couleur de l'univers remplit tout | long · enter | Fondu 120 ms | Accueil → Objectif |
| M-14 | Transition de page web (fondu et titre partagé) via l'API View Transition, en amélioration progressive | base · standard | Aucune | PWA, site public |
| M-15 | Back-office et portail : aucune transition de page ; seul le contenu apparaît en fondu | short · utility.enter | Aucun | Back-office, CRM, portail |
| M-16 | Fenêtre de confirmation : voile en fondu, fenêtre de 0,96 à 1 | base · enter ; sortie short · exit | Fondu 120 ms | Partout (double contrôle, annulation) |

### 4.3 Argent et progression (signature MoloPay)

| ID | Animation | Règle | Durée · courbe | Réduit | Haptique |
|---|---|---|---|---|---|
| M-20 | **Anneau de cotisation qui se remplit** : les traits s'allument un par un (décalage 40 ms) | Après confirmation d'un versement | long au total · standard | Traits allumés d'un coup | — |
| M-21 | **Compteur de montant** : les chiffres défilent de l'ancien au nouveau solde | Seulement après confirmation serveur ; chiffres tabulaires | xlong · utility.enter | Valeur finale directe | — |
| M-22 | Jauge et barre de progression : de l'ancienne à la nouvelle valeur | Même règle | long · standard | Changement direct | — |
| M-23 | **Glisser pour verser** : le pouce suit le doigt au pixel ; seuil à 85 % ; relâché avant, il revient en ressort ; au seuil, il se verrouille et ouvre la saisie du PIN | Toute sortie d'argent | geste ; retour spring.fast | **Conservé** (geste essentiel) + alternative : bouton « Confirmer » activable au clavier et au lecteur d'écran | Impact léger au seuil |
| M-24 | **Attente du prestataire** : les traits de l'anneau s'allument en boucle ; après 10 s, texte « Validez la demande sur votre téléphone » et bouton Annuler | Paiement en attente | boucle 1,2 s · linear | Anneau fixe et texte qui change | — |
| M-25 | **Succès** : cercle citron qui apparaît, coche dessinée trait par trait, puis compteur M-21 | Versement confirmé | medium · enter, puis M-21 | Fondu 120 ms | Succès |
| M-26 | **Célébration des 100 %** : l'anneau complet fait un tour, confettis aux 4 couleurs d'univers, puis le ticket du code de remise monte | Une seule fois par objectif | celebration · enter | Pas de confettis, ticket en fondu | Succès |
| M-27 | **Échec** : léger tremblement du champ (2 oscillations, 6 px) et message « Rien n'a été débité » | Paiement refusé, PIN faux | 300 ms · standard | Bordure rouge seule | Erreur |
| M-28 | Code de remise révélé chiffre par chiffre (décalage 60 ms) ; validité mise à jour à la minute, sans compte à rebours qui bouge | Ouverture du ticket | base par chiffre · enter | Code affiché d'un coup | — |
| M-29 | Comptoir partenaire : résultat « Code valide » glissant avec bord citron, « Code refusé » en fondu rouge | Vérification d'un code | base · enter | Fondu 120 ms | — (web) |

### 4.4 Chargement, données et temps réel

| ID | Animation | Règle | Réduit |
|---|---|---|---|
| M-30 | Squelettes avec reflet qui passe (1,5 s, linear) | N'apparaissent qu'après 300 ms d'attente, pour éviter un flash | Blocs fixes |
| M-31 | Tirer pour actualiser : l'anneau se remplit selon la traction | Mobile | Indicateur fixe |
| M-32 | Attentes longues : au-delà de 1 s, indicateur ; au-delà de 10 s, étapes ou pourcentage et bouton Annuler | Partout | Texte d'étape |
| M-33 | Bandeau « Hors ligne » qui descend du haut | base · enter | Apparition directe |
| M-34 | Nouvelle ligne en temps réel : fond citron qui s'estompe en 1,5 s ; les lignes ne bougent jamais sous le pointeur | Back-office, CRM, comptoir ; bouton « Suspendre les mises à jour » (WCAG 2.2.2) | Fond citron fixe 3 s |
| M-35 | Notification temporaire : entre par le bas, reste au moins 4 s ; si elle contient une action, elle reste jusqu'à fermeture | base · enter ; sortie short · exit | Fondu |
| M-36 | Message d'erreur de champ : fondu et ouverture en hauteur | short · utility.enter | Apparition directe |
| M-37 | « Copié » : l'icône devient une coche | short | identique |

### 4.5 Site public (le plus expressif)

| ID | Animation | Règle | Réduit |
|---|---|---|---|
| M-50 | Halos de couleur qui dérivent lentement (18 s, aller-retour) | Bouton pause visible ; arrêtés hors écran | Halos fixes |
| M-51 | Défilé des univers (40 s, linéaire) | **Bouton pause obligatoire** (WCAG 2.2.2, niveau A) ; pause au survol et au focus | Liste fixe, défilable à la main |
| M-52 | Simulateur : changement de produit → la couleur du halo change, l'illustration entre en fondu et en échelle, la date se met à jour | base à long · standard | Changement direct |
| M-53 | Anneau géant qui tourne lentement (60 s) et se remplit selon le premier versement | Arrêt en mode réduit | Anneau fixe |
| M-54 | Inclinaison du visuel héros sous le pointeur (≤ 18 px, ≤ 6°) | Ordinateur uniquement, jamais au toucher | Désactivée |
| M-56 | **Fond liquide** : taches aux teintes de l'univers qui dérivent lentement (`motion.duration.liquid`, 26 à 38 s, aller-retour) | App (accueil, fiche produit, objectif), PWA, site public ; **figé** sur tout écran de saisie (paiement, PIN, signature, formulaire), arrêté hors écran | Fond figé (repli Sobre) |
| M-55 | Apparition des sections au défilement : légère montée de 16 px, une seule fois | Le contenu reste **visible au repos** : jamais caché en attendant l'animation | Aucune |

## 5. Retours haptiques (mobile)

[Décision, à valider en test utilisateur] Haptique sobre, toujours en complément d'un retour visuel, et jamais si le système l'a désactivée.

| Moment | Flutter (`HapticFeedback`) |
|---|---|
| Choix d'une puce, touche du pavé, interrupteur | `selectionClick()` |
| Seuil du « glisser pour verser » atteint | `lightImpact()` |
| PIN validé | `mediumImpact()` |
| Versement confirmé, 100 % atteint | `mediumImpact()` puis `lightImpact()` 120 ms après |
| Échec de paiement, PIN faux | `heavyImpact()` une fois |

Interdit : vibration à chaque défilement, vibration longue, haptique sans action de l'utilisateur.

## 6. Accessibilité et réduction du mouvement

| Règle | Référence | Niveau |
|---|---|---|
| Aucun mouvement automatique de plus de 5 s affiché à côté d'autre contenu sans moyen de le mettre en pause, l'arrêter ou le masquer ; idem pour les mises à jour automatiques | WCAG 2.2 SC 2.2.2 | A (obligatoire) |
| Rien ne clignote plus de 3 fois par seconde | WCAG 2.2 SC 2.3.1 | A (obligatoire) |
| Tout mouvement déclenché par une interaction peut être désactivé, sauf s'il est essentiel | WCAG 2.2 SC 2.3.3 | AAA — [Décision] **visé par MoloPay** |
| Respect de `prefers-reduced-motion` en CSS et en JavaScript (`matchMedia`) | Techniques W3C C39 et SCR40 | — |
| Flutter : lire **les deux** réglages, `disableAnimations` (Android « Supprimer les animations ») et `reduceMotion` (iOS « Réduire les animations »), qui ne se recoupent pas | API Flutter | — |
| Réglage « Réduire les animations » dans Profil, qui reprend la préférence du système et peut aller plus loin | Critères Apple « Reduced Motion » | — |

**Comment réduire.** On ne supprime pas tout : une animation qui explique un changement d'état est remplacée par un **fondu, une mise en évidence ou un changement de couleur** (recommandation Apple) ; une animation décorative est supprimée. À éviter en priorité, ou à couper en mode réduit : parallaxe, rotations, changements d'échelle plein écran, mouvement continu, mouvements sur plusieurs axes à des vitesses différentes.

Ne jamais appliquer une règle globale du type « toutes les animations à 0 » : elle casse les indicateurs de chargement et de progression, qui doivent rester lisibles.

## 7. Performance

| Règle | Web | Flutter |
|---|---|---|
| Budget par image | 60 images/s : n'animer que `transform` et `opacity` (composées par le GPU), jamais `width`, `height`, `top`, `margin` | 16 ms par image à 60 Hz (8 ms de construction + 8 ms de rendu), moins de 8 ms au total à 120 Hz |
| Coûts cachés | `will-change` seulement en cas de problème mesuré, retiré après l'animation | Pas de widget `Opacity` animé (utiliser `AnimatedOpacity` ou une couleur semi-transparente) ; limiter `saveLayer` et les découpes ; passer le sous-arbre fixe en `child` d'`AnimatedBuilder` ; `RepaintBoundary` autour de l'anneau et du compteur |
| Appareil de référence | Téléphone Android d'entrée de gamme, 2 Go de RAM, en 4G (NF-PERF-003, NF-PUB-001) | Idem, en mode *profile* |
| Bibliothèques | CSS et Web Animations API ; pas de bibliothèque d'animation lourde sur le site public | [Décision] Animations natives (`AnimatedContainer`, `CustomPainter`) ; **pas de Lottie ni de Rive au lancement** (taille de l'APK ≤ 30 Mo, NF-PERF-003) ; à réévaluer pour la célébration |
| Ambiance | Halos et défilé arrêtés hors écran (`IntersectionObserver`) et onglet masqué | — |

### 7.1 Flou et verre (ajout du 26 novembre 2026)

| Règle | Web | Flutter |
|---|---|---|
| Au plus 2 surfaces en verre visibles par écran, flou ≤ 20 px | `backdrop-filter: blur(var(--mp-glass-blur)) saturate(var(--mp-glass-saturate))` | Un `BackdropFilter` par zone, sous `ClipRRect`, dans un `RepaintBoundary` |
| Fonds liquides sans flou en direct | Image pré-calculée ou dégradés radiaux, animés en `transform` | Image ou `CustomPainter` à dégradés radiaux ; pas d'`ImageFiltered` animé |
| Repli Sobre | `prefers-reduced-transparency`, `prefers-reduced-motion`, classe `.mp-sober` | Réglage « Effets visuels : sobres », `disableAnimations`, `reduceMotion` ; bascule si > 5 % d'images au-delà de 16 ms |
| Mesure | Chrome Performance sur l'appareil de référence | Flutter DevTools, mode profile, sur l'appareil de référence |

## 8. Vérification

- **Revue de PR** : toute animation cite son `M-xx`, utilise les jetons, et décrit son comportement réduit.
- **Tests automatisés** : tests de widgets Flutter avec `disableAnimations: true` ; tests web avec `prefers-reduced-motion: reduce` émulé ; vérification qu'aucun montant ne change avant la réponse serveur simulée.
- **Mesure** : Flutter DevTools (images > 16 ms) et Chrome Performance sur l'appareil de référence ; aucune image perdue sur M-13, M-21, M-23.
- **Tests humains** : 5 utilisateurs avec « Réduire les animations » activé ; lecteur d'écran (TalkBack, VoiceOver) sur le parcours Verser.

## 9. Sources

| Référence | Utilisée pour |
|---|---|
| Material Components Android, *Motion* (jetons de courbes, durées et ressorts M3) — github.com/material-components/material-components-android/blob/master/docs/theming/Motion.md | § 3 |
| W3C, *Understanding SC 2.2.2 Pause, Stop, Hide* — w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html | § 6, M-34, M-50, M-51 |
| W3C, *Understanding SC 2.3.1 Three Flashes* — w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html | § 6 |
| W3C, *Understanding SC 2.3.3 Animation from Interactions*, techniques C39 et SCR40 — w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html | § 6 |
| Apple, *Reduced Motion evaluation criteria* (App Store Connect) — developer.apple.com/help/app-store-connect/manage-app-accessibility/reduced-motion-evaluation-criteria | § 6 |
| Flutter API, `MediaQueryData.disableAnimations` et `reduceMotion` — api.flutter.dev | § 3.4, § 6 |
| Flutter, *Performance best practices* — docs.flutter.dev/perf/best-practices | § 7 |
| web.dev, *How to create high-performance CSS animations* — web.dev/articles/animations-guide | § 7 |
| MDN, *View Transition API* — developer.mozilla.org/docs/Web/API/View_Transition_API | M-14 |
| Nielsen Norman Group, *Response Times: The 3 Important Limits* — nngroup.com/articles/response-times-3-important-limits | Principe 5, M-32 |
| Références visuelles du fondateur (`03_inspirations.md`) : cartes empilées, glisser pour envoyer, écran de succès | M-13, M-23, M-25 |
