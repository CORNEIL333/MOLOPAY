# Prompt — Kimi · Recherche approfondie : back-office, CRM, organisation, KYC, LBC/FT, contrôle d'accès, journaux et traçabilité

> À coller dans Kimi. Le texte entre les deux lignes `=====` est le prompt : il est **autonome** (Kimi n'a pas accès au dépôt). Rédigé le 28 novembre 2026 à partir de la branche d'intégration `sprint/integration-t01urw` (commit `f83710e`, API 0.44.0) et de la branche de documentation `claude/kind-gauss-3npnkd`. Aucune donnée personnelle ni aucun secret n'y figure ; « MoloPay » est un nom commercial provisoire.

=====

Tu es mon partenaire de recherche. Je suis le fondateur d'une fintech camerounaise en construction. Je veux approfondir avec toi, par une recherche sourcée et rigoureuse, tout ce qui touche à **l'organisation interne et au contrôle** de la plateforme : back-office, CRM et support, organisation de l'équipe (tous les métiers de la structure), KYC, lutte contre le blanchiment et le financement du terrorisme (LBC/FT), contrôle d'accès interne, journaux et traçabilité. Lis d'abord tout le contexte ci-dessous, puis suis la méthode du § 6.

## 1. Le projet en une page

**Nom de travail :** MoloPay (provisoire ; le nom définitif dépend d'une vérification de marque à l'OAPI). Holding : aVIRA. Villes de lancement : **Douala et Yaoundé**, simultanément.

**Le problème :** au Cameroun, s'équiper (téléphone, moto, frigo) ou payer un loyer, une caution ou des frais de scolarité est difficile pour les ménages modestes. Le crédit formel est quasi inaccessible (environ 10 % des adultes empruntent formellement), le crédit mobile illégal se répand, et 38 % des adultes épargnent en tontine (njangi), contre 31 % sur un compte (Findex 2025).

**La solution : l'achat planifié, sans dette.** Trois modèles :
- **A · Épargne-achat** : le client réserve un produit chez un partenaire vérifié, à **prix garanti**, épargne à son rythme par mobile money (MTN MoMo, Orange Money), en espèces chez un partenaire ou par carte, puis le reçoit à 100 % en boutique contre un **code à usage unique**.
- **B · Achat financé** : acompte, puis crédit accordé **par un financeur agréé**, jamais par la plateforme.
- **C · Dépense planifiée** : épargne vers un bénéficiaire vérifié (bailleur, école, vendeur de matériaux ou de terrain), payé à la confirmation du client.

**Quatre univers :** essentiels, technologie et équipement, logement et immobilier, mobilité et activité professionnelle.

**Les promesses :**
1. Les fonds des clients sont **cantonnés** chez un établissement agréé, nommé dans l'application.
2. Le coût total est affiché avant tout engagement.
3. Le prix est garanti à la réservation.
4. Les conditions de sortie sont claires (annulation sans frais par défaut).

**Les publics :** clients (dont la diaspora qui finance le projet d'un proche), partenaires (commerçants, concessionnaires de motos, bailleurs, écoles) et équipe interne.

**Les interfaces :**
- côté client : application Flutter, client web léger (PWA) et menu USSD ;
- côté partenaire : portail Next.js ;
- côté interne : back-office et CRM ;
- un site public marketplace pour attirer les visiteurs non inscrits.

## 2. La vision

Devenir la manière de confiance de « s'offrir son prochain projet, petit à petit » au Cameroun, puis dans la zone CEMAC. MoloPay est une **tontine numérique transparente, sans administrateur qui peut faire disparaître l'argent**. L'argent est toujours visible et gardé par une banque partenaire. Le prix est tenu. La sortie est possible.

La confiance est le produit. Elle repose sur une intégrité financière vérifiable et sur une conformité sérieuse dès le premier jour : **tout ouvre au lancement, rien n'ouvre avant qu'une porte de lancement unique soit franchie** (juridique, partenaires financiers, sécurité, test fermé avec 50 clients).

## 3. Où en est la construction (au 28 novembre 2026)

Le code est écrit principalement par des agents IA (Claude Code, Qoder, Gemini), sous un cahier des charges détaillé et des règles strictes : tests d'attaque, double revue, aucune simulation de prestataire.

**Pile :** API Node.js / TypeScript / NestJS en monolithe modulaire, PostgreSQL 16, outbox transactionnelle, Flutter, Next.js, vérificateur indépendant en Rust. **Hébergement MVP :** base Neon et serveurs AWS à Francfort, clés AWS KMS, chiffrement applicatif par enveloppe des données personnelles (le téléphone est chiffré, la base ne garde qu'une empreinte).

**Fait :**
- **Grand livre en partie double**, en ajout seul : aucune modification ni suppression possible, même par un administrateur ; les corrections se font par contre-passation approuvée à deux. Chaînage par hachage, lots de Merkle signés et horodatés, et un vérificateur indépendant qui recalcule tout chaque nuit.
- **Identité** : inscription par OTP (prestataire SMS Twilio prévu), clé d'appareil Ed25519 et PIN, **inscription en agence** (l'agent vérifie la pièce et le téléphone en personne puis émet un code), blocage du compte, déclaration de décès (déclarée par une personne, décidée par une autre, avec gel).
- **KYC niveau 1** : nom déclaré et filtré contre la **liste consolidée des sanctions de l'ONU**. Plafonds par niveau imposés par la base de données (valeurs de départ, à valider par l'établissement de cantonnement) :

| Niveau | Plafond détenu | Plafond mensuel |
|---|---|---|
| N1 | 200 000 FCFA | 500 000 FCFA |
| N2 | 2 000 000 FCFA | 2 000 000 FCFA |
| N3 | 10 000 000 FCFA | 10 000 000 FCFA |

  Au-delà du N3, la demande va en examen à la Conformité.
- **Filtrage des partenaires** depuis le back-office ; écarter un faux positif demande deux personnes ; aucune information n'est donnée au client sur un soupçon (testé).
- **Règles de fraude explicables** : versements trop rapprochés, annulations répétées, pic de remises chez un partenaire ; décision tracée, sans sanction automatique.
- **Contrôle d'accès interne** : 9 rôles et 37 actions, testés de façon exhaustive (333 cas). Les rôles sont Support N1, Support N2, Opérations, Finance, Conformité, Risque, Réseau partenaires, Audit (lecture seule) et Administrateur technique (deux personnes au plus). En plus des rôles :
  - un motif est obligatoire pour les consultations sensibles ;
  - les actions sont limitées par ville et par partenaire ;
  - chaque personne a un plafond d'approbation ;
  - le **double contrôle** (une personne prépare, une autre approuve) est garanti par la base pour les règlements, remboursements, contre-passations, paramètres financiers, validations de partenaires et attributions de rôles ;
  - l'accès d'urgence est limité à 2 heures et approuvé par un second administrateur ;
  - le personnel se connecte par **clé matérielle WebAuthn**, avec des sessions de 15 minutes.
- **Journal d'audit chaîné** en ajout seul, conservé 10 ans, lisible par l'Audit et la Conformité ; journaux techniques structurés, sans donnée personnelle en clair.
- **Back-office** : tableau de bord, file de travail à double contrôle, conformité et sanctions, réclamations, blocage, gel, inscription en agence, historique d'objectif, administration. **Un CRM** (fiche client 360°) est en cours de revue.
- **Portail partenaire** : gérant et vendeurs (le vendeur ne voit pas les règlements), comptoir de remise, commandes, export CSV, règlements.

**Pas encore fait ou bloqué :**
- **Versements** : aucun au lancement, en attendant l'agrégateur de paiement.
- **Niveaux 2 et 3 de KYC** : pièce d'identité et selfie, puis adresse et origine des fonds.
- **Personnes politiquement exposées** : aucune source officielle camerounaise identifiée.
- **Listes nationales** de gel des avoirs (CEMAC, ANIF).
- **Scénarios de surveillance LBC** : fractionnement, origine étrangère, remboursements atypiques.
- **Déclaration de soupçon à l'ANIF** : le circuit n'existe pas ; il faut d'abord savoir qui est l'assujetti.
- **Mise en service du back-office** : la décision d'architecture sur l'authentification du personnel attend d'être validée.
- **Enregistrement des sessions d'urgence**, revue périodique des accès, limitation des tentatives de connexion (pare-feu applicatif).

## 4. Le cadre réglementaire tel que je le comprends (à vérifier et compléter)

- **LBC/FT** : règlement **n° 02/24/CEMAC/UMAC/CM du 20 décembre 2024**, qui abroge le règlement 01/CEMAC/UMAC/CM de 2016. Articles que j'ai repérés :
  - art. 22 : vigilance renforcée si le client n'est pas physiquement présent ;
  - art. 30 : identification sur pièce officielle avec photo ;
  - art. 55 : vérification possible « au plus tard avant la première transaction » si le risque est faible ;
  - art. 57 et 58 : régimes simplifiés pour la monnaie électronique et certains paiements ;
  - conservation pendant 10 ans.
- **Services de paiement** : règlement **04/18/CEMAC/UMAC/COBAC** :
  - contrat écrit et lisible (art. 38) ;
  - reçu immédiat avec référence (art. 42) ;
  - opposition en cas de perte ou de vol (art. 43) ;
  - réclamations (art. 44) ;
  - distributeurs qui collectent les pièces (art. 63).
- **Consommateur** : loi-cadre **2011/012** : contrats en français **et** en anglais, information précontractuelle, publicité non trompeuse.
- **Données personnelles** : loi **2024/017**, en vigueur depuis le 23 juin 2026. La biométrie et les données bancaires sont sensibles ; il faut une autorisation préalable, une analyse d'impact et une autorisation pour tout transfert à l'étranger.
- **Autorités** : BEAC et COBAC (supervision bancaire et des établissements de paiement), **ANIF** (cellule de renseignement financier), GABAC (organisme régional anti-blanchiment). Recommandations du GAFI.
- **Statut de MoloPay : non tranché.** Établissement de paiement agréé, distributeur d'un établissement agréé, ou simple intermédiaire technique ? Ce statut détermine qui est **assujetti** aux obligations LBC/FT et qui déclare à l'ANIF.

## 5. Les questions de recherche

Pour chaque thème : état de l'art, obligations applicables au Cameroun et en CEMAC, pratiques de référence (fintechs africaines comme Wave, M-Pesa, Djamo, Moniepoint, PiggyVest, et internationales), puis recommandations concrètes pour MoloPay.

**A. Organisation et équipe**
1. Quelle organisation pour une fintech de paiement et d'épargne au lancement en CEMAC, avec 2 villes et 4 univers ? Organigramme, effectifs par fonction, ce qui est interne ou externalisé.
2. Quels postes la réglementation impose-t-elle, et avec quelles qualifications ?
   - responsable conformité LBC/FT ;
   - délégué à la protection des données ;
   - contrôle interne et audit ;
   - responsable de la sécurité des systèmes d'information ;
   - gestion des risques.
3. Les trois lignes de défense adaptées à une petite structure ; la séparation des tâches quand l'équipe compte moins de 15 personnes.
4. Équipes terrain : agents de recrutement des partenaires, agents d'inscription en agence. Statut, rémunération (commission ou salaire), risques de fraude, formation et supervision.
5. Support client multicanal (application, USSD, téléphone, WhatsApp) : dimensionnement, niveaux N1 et N2, horaires, indicateurs, langues (français, anglais, pidgin).
6. Formation obligatoire LBC/FT, sécurité et données, pour l'équipe et pour les partenaires.

**B. Back-office et CRM**
1. Les modules indispensables d'un back-office de fintech régulée : files de travail, double contrôle, gestion des cas, fiche client 360°, réclamations, litiges, remboursements, rapprochement, alertes, rapports réglementaires.
2. CRM pour une clientèle modeste : segmentation sans profilage abusif, campagnes de rappel conformes, consentements, historique. Construire ou acheter ? Comparer les outils du marché (Zendesk, Freshdesk, HubSpot, solutions africaines) en coût, hébergement des données et conformité à la loi 2024/017.
3. Gestion des réclamations conforme au règlement 04/18 : délais, accusés, escalade, archivage, indicateurs pour le régulateur.
4. Rapports au régulateur et aux partenaires financiers : lesquels, à quelle fréquence, dans quel format (ISO 20022 ?).

**C. KYC**
1. Quelle voie KYC choisir sous le règlement 02/24 pour une inscription à distance ? Comparer les articles 55, 57(c) et 58 et l'inscription assistée en agence. Quelles pièces accepter au Cameroun (CNI, récépissé, passeport, carte de séjour) ?
2. Les prestataires de vérification d'identité opérant au Cameroun (Smile ID, Youverify, Onfido, Sumsub, autres) : couverture de la CNI camerounaise, accès à une base officielle, détection du vivant sur téléphone d'entrée de gamme, hébergement des données, coût par vérification.
3. KYC des partenaires (KYB) : RCCM, NIU, bénéficiaires effectifs, vérification des bailleurs et des titres fonciers.
4. Mise à jour périodique du KYC, et que faire d'un client dont la pièce expire.

**D. LBC/FT**
1. Qui est assujetti dans notre montage (établissement de cantonnement, financeur, MoloPay), et qui déclare à l'ANIF ? Quelles sont les procédures de déclaration de soupçon et de gel des avoirs au Cameroun ?
2. Sources de listes : ONU, listes CEMAC et nationales de gel, personnes politiquement exposées (existe-t-il une liste officielle ou faut-il un fournisseur ?), mise à jour, règles de rapprochement des noms (translittérations, homonymes fréquents).
3. Scénarios de surveillance adaptés à l'épargne-achat : fractionnement, vélocité, contributions de l'étranger, remboursements après annulation, partenaires complices, mules. Seuils typiques. Approche par règles ou par score ?
4. Approche par les risques : cartographie des risques LBC/FT d'un service d'épargne affectée à des achats, et classification des clients.
5. Ce que les autorités ont sanctionné chez des fintechs africaines, pour apprendre des erreurs des autres.

**E. Contrôle d'accès interne**
1. Bonnes pratiques de contrôle d'accès en fintech : rôles et attributs, privilège minimal, séparation des tâches, double contrôle, accès d'urgence, revue périodique des accès, départ d'un employé.
2. Authentification du personnel : clés matérielles (FIDO2) ; choix des clés et logistique au Cameroun ; perte de clé ; travail à distance.
3. Normes de référence à appliquer : ISO/IEC 27001:2022 et 27002, PCI DSS si les cartes passent par nous, OWASP ASVS. Lesquelles exige la COBAC ?

**F. Journaux et traçabilité**
1. Que journaliser, combien de temps conserver, et comment protéger les journaux ? Distinguer journal d'audit métier, journaux techniques et traces de sécurité. Concilier la conservation de 10 ans avec la minimisation et le droit à l'effacement (loi 2024/017).
2. Preuve et opposabilité : la valeur juridique au Cameroun d'un journal chaîné par hachage et horodaté (RFC 3161) en cas de litige ou de contrôle.
3. Supervision et détection : quel centre de supervision de la sécurité (SOC) pour une petite structure, interne ou externalisé ? Quelles alertes ? Comment préparer une réponse aux incidents et la notification des violations de données ?
4. Exports pour l'audit externe et le régulateur : formats, signature, vérification indépendante.

## 6. Méthode attendue

- **Sources d'abord.** Priorise les textes officiels (BEAC, COBAC, GABAC, ANIF, Journal officiel du Cameroun, GAFI), puis la Banque mondiale, le CGAP, la GSMA et les normes ISO, puis les publications sérieuses. Donne pour chaque affirmation sa source avec un lien, la date et, si possible, l'article exact.
- **Niveaux de preuve.** Marque chaque point : [Texte] (disposition réglementaire lue), [Solide] (étude ou donnée vérifiée), [Pratique] (pratique observée chez des acteurs), [Allégation] (dit par une entreprise ou un fournisseur), [Inférence] (ta déduction).
- **Honnêteté.** Si tu ne trouves pas, dis-le. N'invente ni article, ni chiffre, ni nom d'autorité. Signale les contradictions entre sources.
- **Cameroun et CEMAC d'abord**, puis l'Afrique de l'Ouest (UEMOA), le Kenya et le Nigeria comme comparaisons.
- **Éthique.** Pas de surveillance des employés au-delà du nécessaire et du légal ; pas de profilage discriminant des clients ; pas de pratiques trompeuses.
- **Format de chaque réponse :**
  1. résumé en 5 lignes ;
  2. constats sourcés ;
  3. recommandations pour MoloPay, classées en « au lancement », « dans les 6 mois » et « ensuite » ;
  4. questions à poser à un juriste, à l'établissement de cantonnement ou au régulateur ;
  5. sources.
- **Langue :** français, phrases simples, tableaux quand c'est utile.

## 7. Comment on commence

1. Reformule en 10 lignes ce que tu as compris du projet et de son état.
2. Propose un plan de recherche par thème (A à F), avec ce que tu traites en premier et pourquoi.
3. Commence par le thème D (LBC/FT), question 1 : qui est assujetti et qui déclare à l'ANIF. C'est la décision qui conditionne le reste.

=====

## Notes pour le fondateur

- **Ce que le prompt ne contient pas, volontairement** : aucun secret, aucun identifiant, aucune adresse, aucun nom de personne de l'équipe, aucun lien vers le dépôt privé. Ne colle pas dans Kimi de fichiers contenant des clés, des journaux réels ou des données clients.
- **Ce que vous pouvez lui fournir en plus si vous le souhaitez** : des extraits de `docs/02_cahier_des_charges/CDC_03_securite.md`, `CDC_06_conformite_reglementaire.md`, des rapports `docs/05_direction_ux_et_ui/07` et `08`, ou la matrice des rôles. Ce sont des documents de conception, sans secret.
- **Écart de numérotation à corriger à la fusion** : sur la branche d'intégration, l'ADR du site public est **ADR-0008** (l'ADR-0006 y désigne le client web léger) ; sur la branche de documentation, il porte encore le numéro 0006.
- Les résultats de Kimi sont à traiter comme des pistes à vérifier, au même titre que nos propres recherches : un texte réglementaire cité doit être relu à la source avant toute décision.
