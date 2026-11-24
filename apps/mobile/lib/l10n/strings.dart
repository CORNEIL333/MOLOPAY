import '../core/models.dart';

/// Libellés FR (référence) et EN conformes au glossaire MoloPay.
final class AppStrings {
  const AppStrings._(this.locale);

  final String locale;

  bool get isEn => locale == 'en';

  static const AppStrings fr = AppStrings._('fr');
  static const AppStrings en = AppStrings._('en');

  static AppStrings of(String locale) => locale == 'en' ? en : fr;

  String get appTitle => 'MoloPay';
  String get navHome => isEn ? 'Home' : 'Accueil';
  String get navExplore => isEn ? 'Explore' : 'Explorer';
  String get navProjects => isEn ? 'Goals' : 'Projets';
  String get navProfile => isEn ? 'Profile' : 'Profil';

  String get homeEyebrow => isEn ? 'A NEW HORIZON' : 'UN NOUVEL HORIZON';
  String get homeHeadline =>
      isEn ? 'Your goals.\nYour pace.' : 'Vos envies.\nVotre rythme.';
  String get homeSubtitle => isEn
      ? 'Plan ahead, one step at a time.'
      : 'L’avenir se prépare, un pas à la fois.';
  String get homeHeroTitle => isEn
      ? 'Big goals\nstart small.'
      : 'Les grands projets\ncommencent petit.';
  String get homeHeroCaption => isEn
      ? 'Browse published offers at a frozen price.'
      : 'Découvrez les offres publiées à prix figé.';
  String get custodyNotice => isEn
      ? 'Customer funds are held by a licensed financial institution.'
      : 'Vos fonds sont détenus par un établissement agréé.';
  String get allCities => isEn ? 'All cities' : 'Toutes les villes';
  String get allUniverses => isEn ? 'All universes' : 'Tous les univers';
  String get retry => isEn ? 'Retry' : 'Réessayer';
  String get refresh => isEn ? 'Refresh' : 'Actualiser';
  String get loading => isEn ? 'Loading…' : 'Chargement…';
  String get back => isEn ? 'Back' : 'Retour';

  String get exploreTitle => isEn ? 'Catalog' : 'Catalogue';
  String get exploreCaption => isEn
      ? 'Published partner offers in Yaoundé and Douala.'
      : 'Offres partenaires publiées à Yaoundé et Douala.';
  String get searchHint => isEn
      ? 'Filter loaded offers by title or partner'
      : 'Filtrer les offres chargées par titre ou partenaire';
  String get noOffersTitle =>
      isEn ? 'No published offers' : 'Aucune offre disponible';
  String get noOffersDetail => isEn
      ? 'No offers match the selected filters right now.'
      : 'Aucune offre ne correspond aux filtres choisis pour le moment.';
  String get frozenPriceLabel => isEn ? 'Frozen price' : 'Prix figé';
  String get warrantyLabel => isEn ? 'Warranty' : 'Garantie';
  String get termsLabel => isEn ? 'Terms' : 'Conditions';
  String get partnerLabel => isEn ? 'Partner' : 'Partenaire';
  String get availabilityLabel => isEn ? 'Availability' : 'Disponibilité';
  String get plansLabel => isEn ? 'Approved payment plans' : 'Plans approuvés';
  String get inStockEmpty => isEn ? 'Out of stock' : 'Rupture de stock';
  String inStockUnits(int units) =>
      isEn ? '$units unit(s) available' : '$units unité(s) disponible(s)';
  String preorderDays(int days) => isEn
      ? 'Pre-order · $days day(s) lead time'
      : 'Précommande · délai $days j';

  String get loginTitle => isEn ? 'Sign in' : 'Connexion';
  String get loginCaption => isEn
      ? 'Access your goals and confirmed contributions.'
      : 'Accédez à vos objectifs et à vos versements confirmés.';
  String get signInButton => isEn ? 'Sign in' : 'Se connecter';
  String get signOutButton => isEn ? 'Sign out' : 'Se déconnecter';
  String get phoneLabel => isEn ? 'Phone number' : 'Numéro de téléphone';
  String get phoneHint => '+2376XXXXXXXX';
  String get pinLabel => isEn ? '6-digit PIN' : 'Code PIN à 6 chiffres';
  String get invalidPhone => isEn
      ? 'Enter a valid international number (e.g. +237670000001).'
      : 'Saisissez un numéro international valide (ex. +237670000001).';
  String get invalidPin => isEn
      ? 'PIN must contain exactly 6 digits.'
      : 'Le code PIN doit contenir exactement 6 chiffres.';
  String get loginRequiredTitle =>
      isEn ? 'Sign in required' : 'Connexion requise';
  String get loginRequiredDetail => isEn
      ? 'Sign in to view your real goals and ledger-derived balances.'
      : 'Connectez-vous pour consulter vos objectifs réels et vos soldes dérivés du grand livre.';

  String get goalsTitle => isEn ? 'Your goals' : 'Vos objectifs';
  String get goalsCaption => isEn
      ? 'Balances derived from confirmed ledger entries.'
      : 'Soldes dérivés des écritures confirmées du grand livre.';
  String get noGoalsTitle => isEn ? 'No goals yet' : 'Aucun objectif ouvert';
  String get noGoalsDetail => isEn
      ? 'Your active and completed goals will appear here.'
      : 'Vos objectifs actifs et terminés apparaîtront ici.';
  String get savedLabel => isEn ? 'Confirmed saved' : 'Versé confirmé';
  String get targetLabel => isEn ? 'Target' : 'Objectif';
  String get lockedLabel => isEn ? 'Locked' : 'Verrouillé';
  String get contributionsTitle =>
      isEn ? 'Confirmed contributions' : 'Versements confirmés';
  String get noContributions =>
      isEn ? 'No confirmed contributions yet.' : 'Aucun versement confirmé.';
  String get receiptPrefix => isEn ? 'Receipt' : 'Reçu';

  String get profileTitle => isEn ? 'Profile' : 'Profil';
  String get profileCaption => isEn
      ? 'Session, language, accessibility and API connection.'
      : 'Session, langue, accessibilité et connexion à l’API.';
  String get notSignedIn => isEn ? 'Not signed in' : 'Non connecté';
  String get signedInAs => isEn ? 'Signed in as' : 'Connecté en tant que';
  String get signedIn => isEn ? 'Signed in' : 'Connecté';
  String get noDeviceKey => isEn
      ? 'No device key is enrolled on this device. Create an account here, or sign in from the device used to create it.'
      : 'Aucune clé d’appareil n’est enrôlée sur cet appareil. Créez un compte ici, ou connectez-vous depuis l’appareil utilisé à l’inscription.';
  String get languageLabel => isEn ? 'Language' : 'Langue';
  String get reduceMotionLabel =>
      isEn ? 'Reduce animations' : 'Réduire les animations';
  String get apiStatusLabel => isEn ? 'API status' : 'État de l’API';
  String get apiOnline => isEn ? 'Reachable' : 'Accessible';
  String get apiOffline => isEn ? 'Unavailable' : 'Indisponible';
  String get checkApi => isEn ? 'Check connection' : 'Vérifier la connexion';

  String get offlineTitle => isEn
      ? 'Offline or server unreachable'
      : 'Hors connexion ou serveur inaccessible';
  String get offlineDetail => isEn
      ? 'Check your network connection and retry. No data is simulated.'
      : 'Vérifiez votre connexion réseau et réessayez. Aucune donnée n’est simulée.';
  String get unavailableRouteHint => isEn
      ? 'This service is currently unavailable on the server.'
      : 'Ce service est actuellement indisponible sur le serveur.';

  String dataAsOf(DateTime dt) {
    final utc = dt.toUtc();
    final hh = utc.hour.toString().padLeft(2, '0');
    final mm = utc.minute.toString().padLeft(2, '0');
    final day = utc.day.toString().padLeft(2, '0');
    final month = utc.month.toString().padLeft(2, '0');
    return isEn
        ? 'As of $day/$month/${utc.year} $hh:$mm UTC'
        : 'Données au $day/$month/${utc.year} à $hh:$mm UTC';
  }

  String universeName(Universe u) {
    return switch (u) {
      Universe.essentials => isEn ? 'Essentials' : 'Essentiels',
      Universe.technology => isEn ? 'Technology' : 'Technologie',
      Universe.housing => isEn ? 'Housing' : 'Logement',
      Universe.mobility => isEn ? 'Mobility' : 'Mobilité',
    };
  }

  String cityName(City c) {
    return switch (c) {
      City.yaounde => 'Yaoundé',
      City.douala => 'Douala',
    };
  }

  String modelName(OfferModel m) {
    return switch (m) {
      OfferModel.saveThenBuy =>
        isEn ? 'Save then buy (A)' : 'Épargne puis achat (A)',
      OfferModel.financedPurchase =>
        isEn ? 'Financed purchase (B)' : 'Achat financé (B)',
      OfferModel.plannedExpense =>
        isEn ? 'Planned expense (C)' : 'Dépense planifiée (C)',
    };
  }

  String rhythmName(Rhythm r) {
    return switch (r) {
      Rhythm.daily => isEn ? 'Daily' : 'Quotidien',
      Rhythm.weekly => isEn ? 'Weekly' : 'Hebdomadaire',
      Rhythm.monthly => isEn ? 'Monthly' : 'Mensuel',
      Rhythm.free => isEn ? 'Flexible' : 'Libre',
    };
  }

  String get newPlannedExpense =>
      isEn ? 'Plan an expense (Model C)' : 'Planifier une dépense (Modèle C)';
  String get beneficiaryIdLabel =>
      isEn ? 'Verified beneficiary ID' : 'Identifiant du bénéficiaire vérifié';
  String get targetAmountLabel =>
      isEn ? 'Target amount (XAF)' : 'Montant cible (FCFA)';
  String get targetAmountInvalid => isEn
      ? 'Enter a positive integer XAF amount (no decimals).'
      : 'Saisissez un montant entier positif en FCFA, sans décimale.';
  String get durationLabel => isEn ? 'Duration (months)' : 'Durée (mois)';
  String get termsAcceptLabel => isEn
      ? 'I accept the terms and settlement conditions.'
      : 'J’accepte les conditions du plan et du règlement.';
  String get termsRequired => isEn
      ? 'You must accept the terms to continue.'
      : 'Vous devez accepter les conditions pour continuer.';
  String get createGoalButton =>
      isEn ? 'Create draft goal' : 'Créer le brouillon';
  String get simulatePlanButton =>
      isEn ? 'Compute schedule on server' : 'Calculer l’échéancier (serveur)';
  String get modelBNotice => isEn
      ? 'Model B credit is granted solely by a licensed lender, never by MoloPay.'
      : 'Le crédit Modèle B est octroyé par un financeur agréé, jamais par MoloPay.';
  String get lockGoalButton => isEn ? 'Lock goal' : 'Verrouiller l’objectif';
  String get lockGoalDone =>
      isEn ? 'Goal is now locked.' : 'L’objectif est désormais verrouillé.';
  String get signedActionUnavailable => isEn
      ? 'Signed activation/cancellation requires an enrolled device key.'
      : 'L’activation ou l’annulation signée exige une clé d’appareil enrôlée.';
  String get handoverPendingNotice => isEn
      ? 'Single-use handover code emission awaits server route D69.'
      : 'L’émission du code de remise à usage unique attend la route serveur D69.';
  String get beneficiarySectionTitle => isEn
      ? 'Beneficiary settlement (Model C)'
      : 'Règlement bénéficiaire (Modèle C)';
  String get docShaLabel => isEn
      ? 'Document SHA-256 hash (64 hex chars)'
      : 'Empreinte SHA-256 de la pièce (64 hex)';
  String get submitDocButton =>
      isEn ? 'Submit document hash' : 'Déposer l’empreinte';
  String get payBeneficiaryButton => isEn
      ? 'Request beneficiary payout'
      : 'Demander le règlement bénéficiaire';
  String get claimSectionTitle =>
      isEn ? 'Open a support claim' : 'Ouvrir une réclamation';
  String get claimDetailsLabel => isEn
      ? 'Describe your issue (10-1000 chars)'
      : 'Décrivez votre demande (10 à 1000 car.)';
  String get submitClaimButton =>
      isEn ? 'Submit claim' : 'Envoyer la réclamation';
  String get securityTitle => isEn ? 'Account security' : 'Sécurité du compte';
  String get dataRightsTitle =>
      isEn ? 'My data rights' : 'Mes droits sur mes données';
  String get legalNameTitle =>
      isEn ? 'Legal name (KYC level 1)' : 'Nom légal (KYC niveau 1)';
  String get legalNameReceived => isEn
      ? 'Your declaration has been recorded.'
      : 'Votre déclaration a bien été enregistrée.';

  String claimReasonName(ClaimReason r) {
    return switch (r) {
      ClaimReason.paymentNotReceived =>
        isEn ? 'Payment not received' : 'Paiement non reçu',
      ClaimReason.handoverRefused =>
        isEn ? 'Handover refused' : 'Remise refusée',
      ClaimReason.offerMismatch =>
        isEn ? 'Offer mismatch' : 'Article non conforme',
      ClaimReason.other => isEn ? 'Other' : 'Autre',
    };
  }

  String dataRightName(DataRightKind k) {
    return switch (k) {
      DataRightKind.access => isEn ? 'Access' : 'Accès',
      DataRightKind.rectification => isEn ? 'Rectification' : 'Rectification',
      DataRightKind.objection => isEn ? 'Objection' : 'Opposition',
      DataRightKind.erasure => isEn ? 'Erasure' : 'Effacement',
    };
  }

  String goalStatusName(GoalStatus s) {
    return switch (s) {
      GoalStatus.draft => isEn ? 'Draft' : 'Brouillon',
      GoalStatus.active => isEn ? 'Active' : 'Actif',
      GoalStatus.funded => isEn ? 'Funded (100%)' : 'Financé (100 %)',
      GoalStatus.handedOver => isEn ? 'Handed over' : 'Remis',
      GoalStatus.paidToBeneficiary =>
        isEn ? 'Paid to beneficiary' : 'Réglé au bénéficiaire',
      GoalStatus.cancelledByCustomer => isEn ? 'Cancelled' : 'Annulé',
      GoalStatus.disputed => isEn ? 'Disputed' : 'En litige',
      GoalStatus.frozen => isEn ? 'Frozen' : 'Gelé',
      GoalStatus.refunded => isEn ? 'Refunded' : 'Remboursé',
      GoalStatus.closed => isEn ? 'Closed' : 'Clôturé',
    };
  }
}
