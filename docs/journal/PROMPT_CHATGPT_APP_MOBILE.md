# Ultra-prompt ChatGPT : application mobile Flutter (couche interface complète)

> **Usage :** coller tout le bloc ci-dessous dans ChatGPT (mode agent / Codex), dans un dépôt vide.
> **Répartition du travail :** ChatGPT construit toute l'application côté interface : écrans, navigation, états, validation, formatage, accessibilité, langues, sécurité locale. **Il ne connecte rien.** Les données passent par des contrats (« gateways ») qu'il déclare mais **n'implémente pas**. L'intégration réelle à l'API du projet sera faite ensuite par l'agent du projet (Claude Code), qui fournira les implémentations.
> **Zéro simulation :** aucune donnée d'exemple, aucun faux serveur, aucun bouchon, aucune heuristique de remplacement. Une donnée absente s'affiche comme un état explicite « Service non branché ».

---

```text
RÔLE
Tu es un ingénieur Flutter senior. Tu construis la COUCHE INTERFACE COMPLÈTE d'une application mobile
de paiement planifié pour le Cameroun. Tu travailles seul, de bout en bout, sans me poser de questions
sauf blocage réel. Tu livres un projet qui compile, s'analyse sans avertissement et dont les tests passent.

═══════════════════════════════════════════════════════════════════════════════
1. RÈGLES ABSOLUES (toute violation = livraison refusée)
═══════════════════════════════════════════════════════════════════════════════
R1. AUCUNE SIMULATION. Interdits : données d'exemple, listes codées en dur d'offres/projets/reçus,
    faux serveur, mock, fake, stub, bouchon, « demo mode », Future.delayed pour imiter un réseau,
    générateur de données, valeurs par défaut inventées pour combler un manque, heuristique qui
    devine une valeur métier (solde, statut, plafond, frais, date d'échéance).
R2. AUCUNE CONNEXION. Tu n'écris AUCUN client HTTP, AUCUNE URL, AUCUNE clé, AUCUN SDK de paiement,
    AUCUN Firebase. Toutes les données passent par les interfaces de la section 6, que tu DÉCLARES
    (abstract interface class) mais n'IMPLÉMENTES PAS.
R3. ÉTAT « NON BRANCHÉ ». Chaque gateway est fourni par un provider Riverpod qui lève
    `GatewayNotConnected` tant qu'il n'est pas surchargé. Chaque écran qui en dépend affiche alors
    un état explicite : titre « Service non branché », texte « Cette fonction sera disponible quand
    l'application sera reliée au serveur. », sans bouton qui prétend agir. Ce n'est PAS une erreur
    à masquer : c'est l'état normal de ta livraison.
R4. TU N'INVENTES AUCUNE RÈGLE MÉTIER. Le serveur décide de tout : prix, plafonds, statuts,
    échéanciers, frais, TEG, éligibilité. L'app affiche ce qu'elle reçoit et envoie ce que
    l'utilisateur saisit. Les seules règles locales autorisées sont listées en section 5
    (format de saisie, longueur du PIN, format du numéro).
R5. ARGENT. Montants = entiers XAF, jamais de double/float. Le serveur envoie les montants en
    CHAÎNE décimale ("150000"). Type `Xaf` fondé sur BigInt (section 5). Interdit : double,
    num, int pour un montant (Flutter web perd la précision au-delà de 2^53).
R6. AUCUN SECRET, AUCUNE DONNÉE RÉELLE. Ni dans le code, ni dans les tests, ni dans les journaux.
R7. AUCUNE TÉLÉMÉTRIE, publicité, analytics, crash reporting tiers, accès aux contacts, aux SMS,
    au journal d'appels, à la localisation en arrière-plan. Aucune mécanique de loterie, de jeu,
    de série (streak), de compte à rebours commercial ou d'urgence artificielle.
R8. PIN ET OTP. Jamais journalisés, jamais stockés, jamais copiés dans le presse-papiers, jamais
    dans un état persistant ; effacés de la mémoire du widget après envoi. Écrans PIN/OTP protégés
    contre la capture (Android FLAG_SECURE via un MethodChannel minimal que tu écris ; iOS : masquage
    à la mise en arrière-plan).
R9. DÉPENDANCES. Seulement celles de la section 3, versions EXACTES épinglées (pas de ^), avec une
    ligne de justification chacune dans README. Aucune autre sans justification écrite.
R10. Si une information te manque, tu NE la remplaces PAS par une supposition : tu ajoutes l'élément
    au fichier `QUESTIONS_OUVERTES.md` et tu affiches l'état « non branché » ou un libellé neutre.

═══════════════════════════════════════════════════════════════════════════════
2. LE PRODUIT
═══════════════════════════════════════════════════════════════════════════════
Nom provisoire : Molopay (nom commercial non déposé : le centraliser dans une seule constante).
Plateforme camerounaise d'achat planifié, sans endettement :
- Modèle A « Épargner puis acheter » (SAVE_THEN_BUY) : versements vers un article d'un marchand
  partenaire ; remise à 100 % grâce à un code de remise à usage unique.
- Modèle B « Achat financé » (FINANCED_PURCHASE) : acompte, crédit accordé UNIQUEMENT par un
  financeur agréé, jamais par Molopay. Toujours afficher « Crédit accordé par <financeur>, pas par
  Molopay ». (Le serveur peut renvoyer « non disponible » : l'afficher tel quel.)
- Modèle C « Dépense planifiée » (PLANNED_EXPENSE) : épargne vers loyer/caution, scolarité,
  matériaux, terrain ; règlement à un bénéficiaire vérifié.
- 4 univers : ESSENTIALS, TECHNOLOGY, HOUSING, MOBILITY. 2 villes : yaounde, douala.
- Paiements : MTN_MOMO, ORANGE_MONEY, CARD (page hébergée), CASH (peut être indisponible).
- Fonds détenus par un établissement agréé ; Molopay tient le registre.
Public : revenus modestes, téléphones Android d'entrée de gamme (360×800), réseau lent,
littératie variable. Clarté et confiance avant tout.

═══════════════════════════════════════════════════════════════════════════════
3. PILE TECHNIQUE
═══════════════════════════════════════════════════════════════════════════════
- Flutter stable le plus récent publié depuis au moins un mois ; Dart 3, null-safety.
- analysis_options.yaml : `flutter_lints` + règles strictes (strict-casts, strict-inference,
  strict-raw-types, prefer_final_locals, always_declare_return_types, avoid_dynamic_calls,
  unawaited_futures). `flutter analyze` = 0 problème.
- État : flutter_riverpod (providers, AsyncValue). Navigation : go_router (routes nommées, garde
  d'authentification fondée sur un SessionState fourni par AuthGateway).
- i18n : flutter_localizations + intl + fichiers ARB `app_fr.arb` (référence) et `app_en.arb`
  complets ; AUCUNE chaîne visible codée en dur dans un widget.
- QR du code de remise : qr_flutter. Rien d'autre pour le QR.
- Pas de génération de code obligatoire ; si tu utilises freezed/json_serializable, justifie-le.
- Cibles : Android (minSdk 23), iOS 13+, web léger.

═══════════════════════════════════════════════════════════════════════════════
4. ARCHITECTURE (imposée)
═══════════════════════════════════════════════════════════════════════════════
lib/
  app/            → MaterialApp.router, thème, routes, garde, localisations
  core/
    money/        → Xaf, formatage (section 5)
    phone/        → numéro E.164 Cameroun, masquage
    errors/       → GatewayNotConnected, ProblemError (RFC 9457), table code→message (section 7)
    security/     → protection capture écran, effacement PIN
    ui/           → composants : AmountText, ProgressCard, StatusChip, PinPad, OtpField,
                    EmptyState, NotConnectedState, ProblemState, ConfirmSheet, SectionHeader
  gateways/       → interfaces SEULEMENT (section 6) + providers qui lèvent GatewayNotConnected
  features/<f>/   → onboarding, home, kyc, catalog, goals (A et C), financing (B), payments,
                    receipts, diaspora, history, support, account, notifications
    <f>_screen.dart, <f>_controller.dart (Notifier/AsyncNotifier), widgets/
- Les écrans n'importent JAMAIS un autre feature ; ils dépendent de core/ et gateways/.
- Chaque contrôleur expose AsyncValue : loading / data / error(GatewayNotConnected | ProblemError).
- Toute écriture (paiement, signature, annulation, réclamation…) transmet une clé
  d'idempotence UUID v4 générée À L'OUVERTURE de l'écran de confirmation et réutilisée en cas de
  nouvelle tentative (jamais régénérée sur un double tap). Bouton désactivé pendant l'envoi.

═══════════════════════════════════════════════════════════════════════════════
5. RÈGLES LOCALES AUTORISÉES (les seules)
═══════════════════════════════════════════════════════════════════════════════
- Xaf : `final class Xaf { final BigInt value; }`, parse strict de "^(0|[1-9][0-9]*)$" (sinon
  exception), formatage « 150 000 FCFA » avec ESPACE FINE INSÉCABLE U+202F entre milliers,
  jamais de décimales. Saisie de montant : chiffres seulement, aucun séparateur saisi.
- Pourcentage de progression : calculé UNIQUEMENT pour l'affichage à partir de deux Xaf reçus
  (versé/cible), arrondi vers le bas à l'entier ; jamais renvoyé au serveur.
- Téléphone : +237 présélectionné, 9 chiffres nationaux ; masquage d'affichage « +237 6•• •• •• 42 ».
- PIN : exactement 6 chiffres ; confirmation identique à la création. OTP : 6 chiffres.
- Dates : reçues en ISO 8601 UTC, affichées en heure de Douala (Africa/Douala, UTC+1) au format
  local de la langue choisie.
Toute autre règle vient du serveur.

═══════════════════════════════════════════════════════════════════════════════
6. CONTRATS (gateways) — À DÉCLARER, NE PAS IMPLÉMENTER
═══════════════════════════════════════════════════════════════════════════════
Écris ces interfaces et leurs types (classes immuables, `==`/hashCode, fromJson/toJson NON requis :
c'est l'intégrateur qui les écrira). Montants en Xaf, dates en DateTime UTC, identifiants en String.

enum AgreementModel { saveThenBuy, financedPurchase, plannedExpense }
enum AgreementStatus { draft, active, funded, handedOver, paidToBeneficiary, cancelledByCustomer,
  disputed, frozen, refunded, closed }          // « verrouillé » = booléen `locked`, pas un statut
enum PaymentChannel { mtnMomo, orangeMoney, card, cash }
enum PaymentStatus { created, pending, confirmed, failed, expired, refundPending, refunded }
enum KycLevel { none, basic, strong, enhanced }
enum Rhythm { daily, weekly, monthly, free }
enum Universe { essentials, technology, housing, mobility }
enum City { yaounde, douala }
enum BeneficiaryKind { landlord, agency, school, materialsSeller, landSeller }
enum ComplaintChannel { app, ussdCallback, phone }
enum ComplaintCategory { payment, handover, refund, account, other }
enum DataRightKind { access, rectification, objection, erasure }
enum LenderDecisionStatus { submitted, approved, declined }

abstract interface class AuthGateway {
  Stream<SessionState> session();                       // signedOut | signedIn(accountId)
  Future<OtpChallenge> requestOtp(String phoneE164);     // challengeId, expiresAt, resendAt
  Future<OtpProof> verifyOtp(String challengeId, String code);
  Future<LegalTexts> legalTexts();                      // versions + textes CGU/confidentialité
  Future<void> createAccount(OtpProof proof, {required String displayName, required City city,
      required String language, required String termsVersion, required String privacyVersion});
  Future<void> setPin(String pin);                      // jamais conservé côté app
  Future<void> registerThisDevice();                    // la clé d'appareil est gérée par l'intégrateur
  Future<void> signIn(OtpProof proof, String pin);
  Future<void> signOut(String idempotencyKey);
}
abstract interface class KycGateway {
  Future<KycStatus> status();                           // level, limits (Xaf détenus/mois), pending
  Future<void> submitIdentityDocument(IdentityDocumentType type, Uint8List front, Uint8List? back);
  Future<void> submitSelfie(Uint8List image);
}
abstract interface class CatalogGateway {
  Future<Page<OfferSummary>> offers(OfferFilter filter, {String? cursor});
  Future<OfferDetail> offer(String offerId);            // prix figé, garantie, partenaire vérifié…
  Future<List<PartnerRef>> partners();                  // pour le filtre
  Future<List<PaymentPlan>> plans(AgreementModel model, {String? offerId});
  Future<Quote> quote({required String planId, String? offerId, Xaf? targetXaf,
      required int durationMonths});                    // coût total, échéancier : CALCULÉS PAR LE SERVEUR
}
abstract interface class GoalsGateway {                 // modèles A et C
  Future<List<GoalSummary>> myGoals();
  Future<GoalDetail> goal(String goalId);               // statut, locked, versé, cible, prochaine échéance
  Future<GoalDetail> createDraft(GoalDraftRequest r, String idempotencyKey);
  Future<GoalDetail> activate(String goalId, {required String pin, required String idempotencyKey});
  Future<UnlockConditions> lockConditions(String goalId);
  Future<GoalDetail> lock(String goalId, {required String pin, required String idempotencyKey});
  Future<CancellationTerms> cancellationTerms(String goalId);   // montant restitué, délai, canal
  Future<GoalDetail> cancel(String goalId, {required String pin, required String idempotencyKey});
  Future<HandoverCode> handoverCode(String goalId);     // code, QR payload, validité, boutique
  Future<MerchantDefaultOptions> merchantDefaultOptions(String goalId);
  Future<GoalDetail> chooseMerchantDefaultRemedy(String goalId, MerchantDefaultRemedy remedy,
      {required String pin, required String idempotencyKey});
  Future<List<BeneficiaryRef>> beneficiaries(BeneficiaryKind kind, {String? query});
  Future<void> uploadSupportingDocument(String goalId, SupportingDocumentType type, Uint8List file);
  Future<GoalDetail> payBeneficiary(String goalId, {required String pin, required String idempotencyKey});
}
abstract interface class FinancingGateway {            // modèle B
  Future<List<LenderRef>> lenders(String offerId);
  Future<DataSharingConsent> consentScope(String offerId, String lenderId);
  Future<FinancingApplication> apply(FinancingApplicationRequest r, String idempotencyKey);
  Future<FinancingApplication> application(String applicationId);  // status, offre du financeur
  Future<FinancingApplication> acceptOffer(String applicationId, {required String pin, required String idempotencyKey});
  Future<FinancingApplication> declineOffer(String applicationId, String idempotencyKey);
  Future<RepaymentSchedule> schedule(String loanId);
  Future<EarlyRepaymentQuote> earlyRepaymentQuote(String loanId);
}
abstract interface class PaymentsGateway {
  Future<PaymentOptions> options(String goalId);        // canaux disponibles, minimum, reste dû
  Future<PaymentAttempt> start({required String goalId, required PaymentChannel channel,
      required Xaf amount, String? payerPhoneE164, required String idempotencyKey});
  Stream<PaymentAttempt> watch(String attemptId);       // le statut vient UNIQUEMENT du serveur
  Future<Uri> hostedCardPage(String attemptId);         // ouverte dans le navigateur système
  Future<List<CashPoint>> cashPoints(City city);
}
abstract interface class ReceiptsGateway {
  Future<List<Receipt>> receipts({String? goalId});     // receiptNo (par client), montant, date, entryHashPrefix
}
abstract interface class DiasporaGateway {
  Future<Invitation> invite(String goalId, String idempotencyKey);
  Future<List<ContributionRequest>> pendingRequests();
  Future<void> answer(String requestId, bool accept, String idempotencyKey);
  Future<List<Contribution>> received(String goalId);
}
abstract interface class HistoryGateway {
  Future<List<HistoryItem>> goalHistory(String goalId); // types: AGREEMENT_STATUS, PAYMENT_*, COMPLAINT, DISPUTE_*
}
abstract interface class SupportGateway {
  Future<ComplaintReceipt> openComplaint({String? goalId, required ComplaintCategory category,
      required String text, required bool callback, required String idempotencyKey});  // text ≤ 1000
  Future<List<ComplaintSummary>> complaints();          // référence R-XXXXXXXXXX, statut, délai annoncé
  Future<SupportInfo> supportInfo();                    // contacts, code USSD, médiation : FOURNIS PAR LE SERVEUR
}
abstract interface class AccountGateway {
  Future<AccountProfile> profile();
  Future<SecurityOverview> security();                  // appareils, sessions
  Future<void> closeOtherSessions(String idempotencyKey);
  Future<void> blockAccount(String idempotencyKey);
  Future<void> changePin({required String currentPin, required String newPin, required String idempotencyKey});
  Future<List<DataRightRequest>> dataRights();
  Future<DataRightRequest> submitDataRight(DataRightKind kind, String idempotencyKey);
  Future<void> setLanguage(String language);
}
abstract interface class NotificationsGateway {
  Future<List<AppNotification>> inbox();
}
abstract interface class ConnectivityGateway {
  Stream<bool> online();
}

Erreurs : chaque méthode peut lever `ProblemError(code, title, detail, retryAfter?)` (RFC 9457) ou
`GatewayNotConnected`. Aucune autre exception ne doit atteindre l'interface.

═══════════════════════════════════════════════════════════════════════════════
7. MESSAGES D'ERREUR (table code → message FR/EN dans les ARB)
═══════════════════════════════════════════════════════════════════════════════
Affiche un message clair et une action utile pour au moins :
PAYMENT_ALREADY_CONFIRMED, PAYMENT_AGREEMENT_NOT_ACTIVE, PAYMENT_EXCEEDS_REMAINING,
PAYMENT_KYC_LIMIT_EXCEEDED (inclure le niveau requis fourni dans `detail` et un lien vers la
vérification d'identité), PAYMENT_KYC_LIMITS_NOT_CONFIGURED, PAYMENT_CONFIRMATION_UNVERIFIED,
AGREEMENT_LOCKED, AGREEMENT_PLAN_MISMATCH, AGREEMENT_OFFER_NOT_AVAILABLE,
AGREEMENT_BENEFICIARY_NOT_VERIFIED, UNAUTHORIZED_TRANSITION, DISPUTE_ALREADY_OPEN,
IDEMPOTENCY_KEY_REUSED, RATE_LIMITED (afficher retryAfter), MAKER_CANNOT_APPROVE (générique),
et un message générique pour tout code inconnu (afficher le code, jamais une trace technique).

═══════════════════════════════════════════════════════════════════════════════
8. DESIGN
═══════════════════════════════════════════════════════════════════════════════
Thème clair par défaut + sombre. Jetons :
clair : primary #0B6B53, primaryStrong #08503F, accent #E4A11B, background #F7F4EE,
surface #FFFFFF, surfaceMuted #EFEAE0, ink #1F2421, inkMuted #5A615C, border #D6D0C4,
danger #B3261E sur #FDECEA, focus #0B6B53.
sombre : background #101412, surface #171D1A, surfaceMuted #222B26, primary #5BD0AE,
primaryStrong #8BE4C8, accent #F0B94B, ink clair, inkMuted #B6C0B9, border #33413A,
danger #FFB4AB sur #3B1B18.
Cartes arrondies 12–16, cibles tactiles ≥ 48 dp, contraste WCAG AA, lisible à 200 % de taille de
police, aucune information portée par la seule couleur, Semantics sur chaque contrôle, ordre de
focus logique. Barre de navigation : Accueil, Catalogue, Mes projets, Payer, Compte.
Les boutons d'annulation/remboursement sont aussi visibles que « Continuer » (pas de dark pattern).

═══════════════════════════════════════════════════════════════════════════════
9. ÉCRANS À LIVRER (tous routés, tous reliés à leurs gateways)
═══════════════════════════════════════════════════════════════════════════════
Pour CHAQUE écran : états chargement / données / vide / non branché / erreur ; libellés FR et EN.

Lot 1 Ouverture de compte : démarrage ; présentation A/B/C (3 pages) ; saisie du numéro ;
  OTP (renvoi selon resendAt reçu) ; profil (nom, ville, langue) ; CGU et confidentialité
  (textes et versions VENANT du serveur, deux cases distinctes) ; création PIN + confirmation ;
  appareil enregistré ; connexion (numéro → OTP → PIN).
Lot 2 Accueil et KYC : accueil (total détenu et projets REÇUS du serveur, état vide) ; niveau KYC
  et plafonds reçus ; pièce d'identité (type, recto/verso via appareil photo) ; selfie ; statut
  de vérification ; centre de notifications.
Lot 3 Catalogue : univers ; liste filtrée (univers, ville, modèle, prix max, partenaire) avec
  pagination par curseur ; feuille de filtres ; fiche offre (« Prix figé à la signature ») ;
  simulateur = appel quote() : le coût total et l'échéancier affichés sont ceux du serveur ;
  aucun résultat.
Lot 4 Modèle A : création du brouillon (plan, durée en MOIS) ; récapitulatif + conditions
  d'annulation reçues ; confirmation PIN (composant réutilisable pour toute action financière) ;
  détail du projet ; verrouillage (conditions affichées AVANT) ; annulation (montant restitué
  reçu ; indisponible si verrouillé, avec explication) ; objectif atteint : code de remise + QR +
  validité + boutique, consigne « ne montrez ce code qu'au vendeur » ; défaillance du marchand :
  deux remèdes équivalents.
Lot 5 Modèle B : choix du financeur ; consentement au partage (liste reçue, case facultative pour
  l'historique d'épargne) ; demande en cours ; offre du financeur (TEG en grand, coût total,
  échéancier, droit au remboursement anticipé) ; refus respectueux + alternative A ; suivi des
  remboursements ; remboursement anticipé (montant reçu) ; « Non disponible » si le serveur le dit.
Lot 6 Modèle C : type de dépense ; choix d'un bénéficiaire vérifié ; pièce requise (bail / titre)
  avec statut ; objectif ; détail ; payer le bénéficiaire (actif seulement si le serveur l'autorise)
  et suivi de l'instruction.
Lot 7 Paiements : choix du projet, montant (minimum et reste dû reçus), canal (canaux reçus ;
  icônes génériques, aucun logo d'opérateur) ; confirmation mobile money (« validez sur votre
  téléphone ») ; attente pilotée par watch() (aucun minuteur qui invente un résultat) ;
  confirmé (reçu n° par client + début d'empreinte) ; échoué / expiré ; carte : ouverture de
  hostedCardPage dans le navigateur système ; points d'espèces (ou indisponible) ; mes reçus.
Lot 8 Diaspora : inviter un proche ; demandes reçues (accepter/refuser) ; contributions reçues.
Lot 9 Historique et support : chronologie d'un projet (HistoryGateway) ; ouvrir une réclamation
  (catégorie, texte ≤ 1000 avec avertissement « ne saisissez jamais votre PIN, un code ou un
  numéro de pièce », rappel) ; réclamation enregistrée (référence, délai annoncé reçu) ;
  mes réclamations (badge « Règlement suspendu » si le serveur l'indique) ; aide (contacts, code
  USSD et médiation REÇUS du serveur).
Lot 10 Compte : profil ; sécurité (appareils, sessions, fermer les autres, bloquer le compte avec
  double confirmation) ; téléphone perdu (étapes) ; mes données (4 demandes + historique) ;
  changer le PIN ; langue ; bannière hors ligne (ConnectivityGateway) : consultation seulement,
  aucune action financière possible hors ligne.

═══════════════════════════════════════════════════════════════════════════════
10. TESTS (sans aucune donnée fictive de métier)
═══════════════════════════════════════════════════════════════════════════════
- Tests unitaires des fonctions pures : Xaf (parse, refus de "01", "1.5", "-1", très grands
  nombres au-delà de 2^53, formatage U+202F), masquage du téléphone, validation PIN/OTP/numéro,
  pourcentage d'affichage, table d'erreurs (chaque code a un message FR et EN), conversion
  d'heure vers Africa/Douala.
- Tests de widgets UNIQUEMENT sur les états sans données métier : NotConnectedState affiché pour
  chaque écran quand le provider lève GatewayNotConnected ; PinPad (saisie, effacement, pas de
  persistance) ; accessibilité (Semantics, cibles ≥ 48 dp) ; bascule FR/EN.
- Test « zéro simulation » : un test qui parcourt lib/ et échoue si apparaissent les mots
  mock, fake, stub, dummy, sample, demo, lorem, Future.delayed, http:, https:, ou un package
  http/dio.
- Aucun test ne fabrique d'offre, de projet, de reçu ou de paiement.

═══════════════════════════════════════════════════════════════════════════════
11. LIVRABLES ET CRITÈRES D'ACCEPTATION
═══════════════════════════════════════════════════════════════════════════════
1. Le projet Flutter complet ; `flutter analyze` = 0 ; `flutter test` = vert ; build Android
   debug réussi.
2. README.md : lancer l'app, dépendances justifiées, architecture.
3. ECRANS.md : tableau écran → route go_router → contrôleur → méthodes de gateway appelées →
   états gérés. Chacun des ~65 écrans y figure.
4. INTEGRATION.md : pour l'intégrateur, liste de chaque provider à surcharger et de chaque
   type à désérialiser (montants en chaîne, dates ISO 8601 UTC, clé d'idempotence en en-tête
   Idempotency-Key).
5. QUESTIONS_OUVERTES.md : tout ce que tu n'as pas pu décider sans inventer.
6. Captures : aucune capture avec des données inventées ; seulement les états « non branché »,
   vides, et les écrans sans données (onboarding, PIN, formulaires vides).
Commits petits et clairs, en français. Tu ne publies rien, tu ne déploies rien.
```

---

## Après la livraison de ChatGPT (fait par l'agent du projet)
1. Relecture : contrôle des règles R1 à R10 (recherche de mots interdits, dépendances, PIN).
2. Implémentation des gateways contre l'API réelle (`/v1/...`, RFC 9457, Idempotency-Key, sessions, signature d'appareil Ed25519 + PIN pour activation et annulation, D28).
3. Ajout au dépôt dans `apps/mobile/`, tests d'intégration contre une API de test réelle.
