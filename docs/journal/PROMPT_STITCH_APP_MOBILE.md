# Prompt Google Stitch : maquette de l'application mobile

> Usage : coller d'abord le **bloc 0 (style global)** dans Stitch, puis chaque **lot d'écrans** l'un après l'autre dans le même projet. Stitch produit de meilleurs résultats avec 4 à 8 écrans par demande. Garder le bloc 0 en tête de chaque demande si Stitch perd le style.
> Les écrans viennent du cahier des charges fonctionnel (`CDC_01`) : identifiants entre crochets pour la traçabilité, à retirer si Stitch les affiche.
> Maquette uniquement : aucune donnée réelle, numéros et noms fictifs.

---

## Bloc 0 · Style global (à coller en premier)

```
Design a mobile app (Android first, 360×800, also iOS) for a Cameroonian "planned purchase" platform. Working name: "Molopay" (provisional). All UI text in French (Cameroon), with an English toggle in settings.

What the product does:
- Model A "Épargner puis acheter": the customer saves in installments toward a specific product from a partner shop; the item is handed over when 100% is reached.
- Model B "Achat financé": down payment, immediate handover, credit granted ONLY by a licensed partner lender (never by the app). Always show "Crédit accordé par [Nom du financeur], pas par Molopay".
- Model C "Dépense planifiée": save toward rent, school fees, building materials or land, paid directly to a verified beneficiary.
- 4 universes: Essentiels, Technologie, Logement, Mobilité. 2 cities: Yaoundé, Douala.
- Payments: MTN MoMo, Orange Money, card (hosted page), cash at an authorized partner.

Audience: low and middle income users, often on entry-level Android phones, sometimes slow networks, varied literacy. Trust and clarity matter more than flair.

Visual style:
- Calm, warm, trustworthy. Light theme by default, dark theme variant.
- Colors: primary deep green #0B6B53 (strong #08503F), accent warm gold #E4A11B, background warm off-white #F7F4EE, surface #FFFFFF, muted surface #EFEAE0, text #1F2421, muted text #5A615C, border #D6D0C4, danger #B3261E on #FDECEA. Dark: background #101412, surface #171D1A, primary #5BD0AE, accent #F0B94B, text light.
- Rounded cards (12–16 px), generous spacing, large touch targets (min 48 px), clear hierarchy, simple line icons.
- Amounts always in whole FCFA with a thin space for thousands: "150 000 FCFA". Never decimals.
- Progress shown as a clear bar + "45 000 / 150 000 FCFA (30 %)".
- Bottom navigation with 5 tabs: Accueil, Catalogue, Mes projets, Payer, Compte.
- Accessible: high contrast (WCAG AA), text never only in color, icons with labels, readable at 200% font size.

Strict rules (do not break):
- No lottery, scratch cards, spin wheels, streak pressure, countdown pressure or "only 2 left!" urgency.
- No dark patterns: cancel and refund options are as visible as continue buttons.
- Never show a full ID number, full phone number or PIN; mask as "+237 6•• •• •• 42".
- Every financial action ends with a 6-digit PIN confirmation screen.
- Show the frozen price explicitly: "Prix figé à la signature".
```

---

## Lot 1 · Accueil et ouverture de compte [F-ACC-001/002/004]

```
Using the global style, create these screens:
1. Écran de démarrage avec logo provisoire et slogan "Équipez-vous sans vous endetter".
2. Présentation en 3 pages (A, B, C expliqués simplement avec une illustration chacune), bouton "Commencer", lien "J'ai déjà un compte".
3. Saisie du numéro : indicatif +237 présélectionné, champ numéro, mention "Vous recevrez un code par SMS".
4. Vérification OTP : 6 cases, minuteur de renvoi, lien "Modifier le numéro".
5. Faisons connaissance : nom d'affichage, ville (Yaoundé / Douala), langue (Français / English).
6. Conditions : résumé lisible des CGU et de la politique de confidentialité (version et date), deux cases à cocher séparées, bouton "J'accepte".
7. Création du PIN à 6 chiffres puis confirmation, clavier numérique large, conseil "Ne partagez jamais votre code".
8. Appareil enregistré : confirmation "Ce téléphone est maintenant votre appareil de confiance".
```

## Lot 2 · Tableau de bord et vérification d'identité [F-ACC-003, F-NOT-001]

```
Using the global style, create:
1. Accueil (onglet Accueil) : salutation, carte "Total épargné" (dérivé de mes projets), liste de projets en cours avec barre de progression et prochaine échéance, raccourcis "Verser", "Nouveau projet", "Catalogue". État vide : "Aucun projet pour l'instant" + bouton.
2. Niveau de vérification (KYC) : niveau actuel (1, 2 ou 3), plafond associé en FCFA, ce qu'il faut pour monter de niveau.
3. Ajout de pièce d'identité : choix du type (CNI, passeport, carte de séjour), photo recto/verso avec cadre de guidage, mention "Chiffrée, visible uniquement par l'équipe conformité".
4. Selfie de vérification avec cadre ovale et consignes de lumière.
5. Vérification en cours / validée / refusée avec motif et action possible.
6. Centre de notifications : versement confirmé, rappel d'échéance, 100 % atteint, code de remise, règlement effectué, mise à jour d'une réclamation. Aucun montant complet ni identifiant sensible dans l'aperçu.
```

## Lot 3 · Catalogue [F-CAT-001/003/004]

```
Using the global style, create:
1. Catalogue : 4 tuiles d'univers (Essentiels, Technologie, Logement, Mobilité) avec icône, barre de recherche.
2. Liste d'offres avec filtres visibles en puces : univers, ville, modèle (A / B / C), prix maximum, partenaire. Carte offre : photo, nom, prix, partenaire avec badge "Partenaire vérifié", modèles disponibles, disponibilité.
3. Feuille de filtres (bottom sheet) avec les 5 filtres et boutons "Effacer" / "Appliquer".
4. Fiche offre : galerie photo, prix, "Prix figé à la signature", garantie, conditions de remise, villes, disponibilité, partenaire, choix du modèle A ou B.
5. Simulateur : choix du rythme (quotidien, hebdomadaire, mensuel, libre) et de la durée, résultat "Coût total", montant par versement, date estimée d'atteinte, échéancier détaillé dépliable. Mention "Aucuns frais" pour A.
6. Aucun résultat : message utile et bouton pour élargir les filtres.
```

## Lot 4 · Modèle A, épargner puis acheter [F-SAV-001…006]

```
Using the global style, create:
1. Créer mon projet : récapitulatif de l'offre, plan choisi (rythme, minimum par versement, durée max), date de fin estimée.
2. Récapitulatif avant signature : prix figé, rythme, durée, barème d'annulation ("Annulation : remboursement à 100 %, sans frais"), case "J'ai lu les conditions", bouton "Signer avec mon PIN".
3. Confirmation PIN (écran réutilisable pour toute action financière) : titre de l'action, montant, 6 cases, clavier.
4. Détail du projet : grande progression, montant restant, prochain versement, historique des versements avec numéro de reçu, boutons "Verser", "Verrouiller", "Annuler le projet".
5. Verrouiller mon projet : explication claire, conditions de déverrouillage affichées AVANT (décès, défaillance du marchand, force majeure), confirmation PIN.
6. Annuler le projet : montant restitué, délai, canal de restitution, bouton d'annulation aussi visible que "Garder mon projet". Projet verrouillé : annulation indisponible avec explication.
7. Objectif atteint (100 %) : félicitations sobres (pas de confettis excessifs), code de remise à usage unique en QR code + code chiffré, date de validité, adresse et horaires de la boutique, consigne "Ne montrez ce code qu'au vendeur".
8. Défaillance du marchand : message clair, deux choix équivalents "Article équivalent sans surcoût" ou "Remboursement intégral", signature PIN.
```

## Lot 5 · Modèle B, achat financé [F-FIN-001…006]

```
Using the global style, create:
1. Achat financé : explication "Le crédit est accordé par un financeur agréé, pas par Molopay", choix du financeur partenaire, acompte demandé.
2. Consentement au partage du dossier : liste exacte des données transmises au financeur (identité vérifiée, offre, acompte, échéancier proposé, historique d'épargne seulement si coché), deux choix clairs.
3. Demande en cours d'étude par le financeur : statut, délai indicatif, aucune promesse d'acceptation.
4. Offre du financeur : montant financé, durée, TEG en grand, coût total du crédit, échéancier complet, droit de remboursement anticipé, bouton "Accepter avec mon PIN" et "Refuser".
5. Demande refusée : message respectueux, motif si fourni par le financeur, alternative "Épargner puis acheter (A)".
6. Suivi des remboursements : prochaine échéance, échéances payées / restantes, bouton "Rembourser par anticipation" avec simulation du montant.
7. Rappel de paiement : ton bienveillant, sans menace ni pression (charte de recouvrement responsable).
```

## Lot 6 · Modèle C, dépense planifiée [F-PLN-001…004]

```
Using the global style, create:
1. Nouvelle dépense planifiée : 4 types (Loyer ou caution, Frais de scolarité, Matériaux de construction, Terrain).
2. Choisir le bénéficiaire : liste de bénéficiaires vérifiés (bailleur, agence, école, vendeur) avec badge "Vérifié", recherche, mention "Seuls les bénéficiaires vérifiés peuvent être payés".
3. Pièce requise : pour un loyer, déposer le bail ; pour un terrain, le titre foncier ou la preuve de propriété ; statut "En vérification par la conformité".
4. Mon objectif : montant cible, rythme, échéance, récapitulatif et signature PIN.
5. Détail de la dépense : progression, versements, statut du document, bouton "Payer le bénéficiaire" actif seulement à 100 % et document vérifié.
6. Payer le bénéficiaire : récapitulatif (bénéficiaire, montant, compte de règlement masqué), confirmation PIN, puis suivi "Instruction envoyée → Exécutée par l'établissement".
```

## Lot 7 · Paiements et reçus [F-PAY-001…006, F-SAV-002]

```
Using the global style, create:
1. Payer (onglet) : choisir le projet, saisir le montant (minimum affiché), choisir le moyen : MTN MoMo, Orange Money, Carte bancaire, Espèces chez un partenaire. Use generic colored icons, no real operator logos.
2. Confirmation mobile money : numéro masqué, montant, consigne "Validez la demande sur votre téléphone avec votre code mobile money".
3. Paiement en attente : animation sobre, texte "Nous attendons la confirmation de l'opérateur. Votre versement n'est crédité qu'après confirmation.", aucun double bouton de paiement.
4. Paiement confirmé : reçu numéroté (ex. "Reçu n° 000 128"), date, montant, projet, nouvelle progression, bouton "Partager le reçu".
5. Paiement échoué ou expiré : explication, "Aucun montant n'a été débité" seulement si c'est le cas, bouton "Réessayer".
6. Dépôt en espèces : carte des points partenaires habilités à Yaoundé/Douala, horaires, puis reçu signé reçu par SMS.
7. Mes reçus : liste continue des reçus numérotés avec filtre par projet.
```

## Lot 8 · Diaspora et proches [F-DIA-001/002]

```
Using the global style, create:
1. Inviter un proche à contribuer : choisir le projet, lien ou numéro, message, ce que le proche verra (nom du projet et progression, jamais le solde détaillé ni l'identité complète).
2. Demande de contribution reçue (côté bénéficiaire du projet) : accepter ou refuser un contributeur.
3. Contribuer au projet d'un proche (depuis l'étranger) : montant, canal de transfert agréé, mention des contrôles réglementaires.
4. Historique des contributions reçues.
```

## Lot 9 · Historique, support et litiges [F-SUP-001…003]

```
Using the global style, create:
1. Historique d'un projet : chronologie complète (signature, versements, verrouillage, remise, échanges avec le support).
2. Ouvrir une réclamation : choisir le projet, catégorie, description, pièce jointe facultative, choix "Être rappelé".
3. Réclamation enregistrée : numéro, délai de réponse annoncé, statut.
4. Mes réclamations : liste avec statuts (Reçue, En cours, Résolue), et badge "Règlement suspendu" quand un litige bloque le projet.
5. Aide : questions fréquentes, contact téléphone, rappel du code USSD (ex. "*000#", fictif) pour les fonctions sans internet.
```

## Lot 10 · Compte, sécurité et données personnelles [F-ACC-005/006]

```
Using the global style, create:
1. Compte (onglet) : profil, niveau de vérification, langue, sécurité, mes données, aide, déconnexion.
2. Sécurité : appareils enregistrés et sessions actives, bouton "Fermer les autres sessions", bouton rouge "Bloquer mon compte" avec confirmation explicite.
3. Téléphone perdu ou volé : étapes claires (bloquer via USSD ou support, puis ré-enrôlement avec vérification renforcée).
4. Mes données : demander l'accès, la rectification, l'opposition ou l'effacement ; historique des demandes avec reçu horodaté ; mention des obligations légales de conservation.
5. Changer mon PIN.
6. Mode hors connexion : bannière "Hors ligne : consultation seulement, aucun paiement possible", données affichées avec l'heure de dernière mise à jour.
```

---

## Conseils d'utilisation
- Si Stitch invente des fonctions (prêt accordé par l'app, jeux, bonus), redemander en rappelant les « Strict rules » du bloc 0.
- Exporter vers Figma pour la revue ; la maquette ne vaut pas spécification : le comportement de référence reste `CDC_01` et les machines à états de `CDC_05`.
- Le nom « Molopay » est provisoire (nom commercial non déposé, `01_dossier_projet.md`).
