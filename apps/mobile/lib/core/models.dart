import 'money.dart';

/// Univers métier MoloPay (liste blanche conforme au contrat OpenAPI).
enum Universe {
  essentials('ESSENTIALS'),
  technology('TECHNOLOGY'),
  housing('HOUSING'),
  mobility('MOBILITY');

  const Universe(this.apiValue);
  final String apiValue;

  static Universe parse(String raw) {
    for (final value in values) {
      if (value.apiValue == raw) return value;
    }
    throw FormatException('Univers inconnu : $raw');
  }
}

/// Villes ouvertes au lancement (liste blanche conforme au contrat OpenAPI).
enum City {
  yaounde('yaounde'),
  douala('douala');

  const City(this.apiValue);
  final String apiValue;

  static City parse(String raw) {
    for (final value in values) {
      if (value.apiValue == raw) return value;
    }
    throw FormatException('Ville inconnue : $raw');
  }
}

/// Modèles d'achat planifié (A, B, C).
enum OfferModel {
  saveThenBuy('SAVE_THEN_BUY'),
  financedPurchase('FINANCED_PURCHASE'),
  plannedExpense('PLANNED_EXPENSE');

  const OfferModel(this.apiValue);
  final String apiValue;

  static OfferModel parse(String raw) {
    for (final value in values) {
      if (value.apiValue == raw) return value;
    }
    throw FormatException('Modèle inconnu : $raw');
  }
}

enum OfferStatus {
  draft('DRAFT'),
  published('PUBLISHED'),
  suspended('SUSPENDED');

  const OfferStatus(this.apiValue);
  final String apiValue;

  static OfferStatus parse(String raw) {
    for (final value in values) {
      if (value.apiValue == raw) return value;
    }
    throw FormatException('Statut d’offre inconnu : $raw');
  }
}

enum Rhythm {
  daily('DAILY'),
  weekly('WEEKLY'),
  monthly('MONTHLY'),
  free('FREE');

  const Rhythm(this.apiValue);
  final String apiValue;

  static Rhythm parse(String raw) {
    for (final value in values) {
      if (value.apiValue == raw) return value;
    }
    throw FormatException('Rythme inconnu : $raw');
  }
}

sealed class StockAvailability {
  const StockAvailability();

  factory StockAvailability.fromJson(Map<String, Object?> json) {
    final kind = _reqString(json, 'kind');
    if (kind == 'IN_STOCK') {
      return InStockAvailability(_reqInt(json, 'units'));
    }
    if (kind == 'PREORDER') {
      return PreorderAvailability(_reqInt(json, 'leadDays'));
    }
    throw FormatException('Disponibilité inconnue : $kind');
  }
}

final class InStockAvailability extends StockAvailability {
  const InStockAvailability(this.units);
  final int units;
}

final class PreorderAvailability extends StockAvailability {
  const PreorderAvailability(this.leadDays);
  final int leadDays;
}

final class Offer {
  const Offer({
    required this.offerId,
    required this.title,
    required this.partnerId,
    required this.partnerName,
    required this.universe,
    required this.models,
    required this.cities,
    required this.priceXaf,
    required this.availability,
    required this.warranty,
    required this.discountTerms,
    required this.status,
  });

  final String offerId;
  final String title;
  final String partnerId;
  final String partnerName;
  final Universe universe;
  final List<OfferModel> models;
  final List<City> cities;
  final MoneyXaf priceXaf;
  final StockAvailability availability;
  final String warranty;
  final String discountTerms;
  final OfferStatus status;

  factory Offer.fromJson(Map<String, Object?> json) {
    return Offer(
      offerId: _reqString(json, 'offerId'),
      title: _reqString(json, 'title'),
      partnerId: _reqString(json, 'partnerId'),
      partnerName: _reqString(json, 'partnerName'),
      universe: Universe.parse(_reqString(json, 'universe')),
      models: _reqStringList(json, 'models').map(OfferModel.parse).toList(),
      cities: _reqStringList(json, 'cities').map(City.parse).toList(),
      priceXaf: MoneyXaf.parse(_reqString(json, 'priceXaf')),
      availability: StockAvailability.fromJson(_reqMap(json, 'availability')),
      warranty: _reqString(json, 'warranty'),
      discountTerms: _reqString(json, 'discountTerms'),
      status: OfferStatus.parse(_reqString(json, 'status')),
    );
  }
}

final class OfferList {
  const OfferList({required this.offers, required this.asOf});

  final List<Offer> offers;
  final DateTime asOf;

  factory OfferList.fromJson(Map<String, Object?> json) {
    final rawList = json['offers'];
    if (rawList is! List<Object?>) {
      throw const FormatException('Champ offers attendu.');
    }
    return OfferList(
      offers: rawList
          .map((item) => Offer.fromJson(_asMap(item, 'offer')))
          .toList(),
      asOf: DateTime.parse(_reqString(json, 'asOf')),
    );
  }
}

final class PaymentPlan {
  const PaymentPlan({
    required this.planId,
    required this.model,
    required this.rhythm,
    required this.minAmountXaf,
    required this.maxDurationMonths,
  });

  final String planId;
  final OfferModel model;
  final Rhythm rhythm;
  final MoneyXaf minAmountXaf;
  final int maxDurationMonths;

  factory PaymentPlan.fromJson(Map<String, Object?> json) {
    return PaymentPlan(
      planId: _reqString(json, 'planId'),
      model: OfferModel.parse(_reqString(json, 'model')),
      rhythm: Rhythm.parse(_reqString(json, 'rhythm')),
      minAmountXaf: MoneyXaf.parse(_reqString(json, 'minAmountXaf')),
      maxDurationMonths: _reqInt(json, 'maxDurationMonths'),
    );
  }
}

final class SessionSummary {
  const SessionSummary({
    required this.accountId,
    required this.locale,
    required this.expiresAt,
    this.displayName,
  });

  final String accountId;
  final String locale;
  final DateTime expiresAt;

  /// Le contrat n'expose aucun nom (D77) ; réservé à un libellé local éventuel.
  final String? displayName;

  /// Session ouverte par `POST /v1/auth/sessions` (appareil + PIN, D71).
  factory SessionSummary.fromLogin(
    ClientLoginResult result, {
    required String locale,
  }) {
    return SessionSummary(
      accountId: result.accountId,
      locale: locale,
      expiresAt: result.accessExpiresAt,
    );
  }
}

enum GoalStatus {
  draft('DRAFT'),
  active('ACTIVE'),
  funded('FUNDED'),
  handedOver('HANDED_OVER'),
  paidToBeneficiary('PAID_TO_BENEFICIARY'),
  cancelledByCustomer('CANCELLED_BY_CUSTOMER'),
  disputed('DISPUTED'),
  frozen('FROZEN'),
  refunded('REFUNDED'),
  closed('CLOSED');

  const GoalStatus(this.apiValue);
  final String apiValue;

  static GoalStatus parse(String raw) {
    for (final value in values) {
      if (value.apiValue == raw) return value;
    }
    throw FormatException('Statut d’objectif inconnu : $raw');
  }
}

final class Goal {
  const Goal({
    required this.goalId,
    required this.model,
    required this.status,
    required this.locked,
    required this.offerId,
    required this.offerTitle,
    required this.partnerName,
    required this.beneficiaryId,
    required this.planId,
    required this.rhythm,
    required this.minAmountXaf,
    required this.durationMonths,
    required this.targetXaf,
    required this.savedXaf,
    required this.progressBasisPoints,
    required this.createdAt,
    required this.updatedAt,
    this.installmentAmountXaf,
    this.nextDueDate,
    this.handoverCodeAvailable = false,
  });

  final String goalId;
  final OfferModel model;
  final GoalStatus status;
  final bool locked;
  final String? offerId;
  final String? offerTitle;
  final String? partnerName;
  final String? beneficiaryId;
  final String planId;
  final Rhythm rhythm;
  final MoneyXaf minAmountXaf;
  final int durationMonths;
  final MoneyXaf targetXaf;
  final MoneyXaf savedXaf;
  final int progressBasisPoints;
  final MoneyXaf? installmentAmountXaf;
  final String? nextDueDate;
  final bool handoverCodeAvailable;
  final DateTime createdAt;
  final DateTime updatedAt;

  /// Pourcentage entier 0..100 dérivé de [progressBasisPoints] (sans calcul flottant sur l'argent).
  int get progressPercent => (progressBasisPoints ~/ 100).clamp(0, 100);

  factory Goal.fromJson(Map<String, Object?> json) {
    final installmentRaw = json['installmentAmountXaf'];
    return Goal(
      goalId: _reqString(json, 'goalId'),
      model: OfferModel.parse(_reqString(json, 'model')),
      status: GoalStatus.parse(_reqString(json, 'status')),
      locked: _reqBool(json, 'locked'),
      offerId: _optString(json, 'offerId'),
      offerTitle: _optString(json, 'offerTitle'),
      partnerName: _optString(json, 'partnerName'),
      beneficiaryId: _optString(json, 'beneficiaryId'),
      planId: _reqString(json, 'planId'),
      rhythm: Rhythm.parse(_reqString(json, 'rhythm')),
      minAmountXaf: MoneyXaf.parse(_reqString(json, 'minAmountXaf')),
      durationMonths: _reqInt(json, 'durationMonths'),
      targetXaf: MoneyXaf.parse(_reqString(json, 'targetXaf')),
      savedXaf: MoneyXaf.parse(_reqString(json, 'savedXaf')),
      progressBasisPoints: _reqInt(json, 'progressBasisPoints'),
      installmentAmountXaf: installmentRaw is String
          ? MoneyXaf.parse(installmentRaw)
          : null,
      nextDueDate: _optString(json, 'nextDueDate'),
      handoverCodeAvailable: json['handoverCodeAvailable'] == true,
      createdAt: DateTime.parse(_reqString(json, 'createdAt')),
      updatedAt: DateTime.parse(_reqString(json, 'updatedAt')),
    );
  }
}

final class GoalList {
  const GoalList({required this.goals, required this.asOf});

  final List<Goal> goals;
  final DateTime asOf;

  factory GoalList.fromJson(Map<String, Object?> json) {
    final rawList = json['goals'];
    if (rawList is! List<Object?>) {
      throw const FormatException('Champ goals attendu.');
    }
    return GoalList(
      goals: rawList
          .map((item) => Goal.fromJson(_asMap(item, 'goal')))
          .toList(),
      asOf: DateTime.parse(_reqString(json, 'asOf')),
    );
  }
}

enum ContributionStatus {
  confirmed('CONFIRMED'),
  reversed('REVERSED');

  const ContributionStatus(this.apiValue);
  final String apiValue;

  static ContributionStatus parse(String raw) {
    for (final value in values) {
      if (value.apiValue == raw) return value;
    }
    throw FormatException('Statut de versement inconnu : $raw');
  }
}

final class Contribution {
  const Contribution({
    required this.contributionId,
    required this.amountXaf,
    required this.status,
    required this.receiptNumber,
    this.confirmedAt,
  });

  final String contributionId;
  final MoneyXaf amountXaf;
  final ContributionStatus status;
  final DateTime? confirmedAt;
  final String receiptNumber;

  factory Contribution.fromJson(Map<String, Object?> json) {
    final confirmedRaw = _optString(json, 'confirmedAt');
    return Contribution(
      contributionId: _reqString(json, 'contributionId'),
      amountXaf: MoneyXaf.parse(_reqString(json, 'amountXaf')),
      status: ContributionStatus.parse(_reqString(json, 'status')),
      confirmedAt: confirmedRaw != null ? DateTime.parse(confirmedRaw) : null,
      receiptNumber: _reqString(json, 'receiptNumber'),
    );
  }
}

final class ContributionList {
  const ContributionList({required this.contributions, required this.asOf});

  final List<Contribution> contributions;
  final DateTime asOf;

  factory ContributionList.fromJson(Map<String, Object?> json) {
    final rawList = json['contributions'];
    if (rawList is! List<Object?>) {
      throw const FormatException('Champ contributions attendu.');
    }
    return ContributionList(
      contributions: rawList
          .map((item) => Contribution.fromJson(_asMap(item, 'contribution')))
          .toList(),
      asOf: DateTime.parse(_reqString(json, 'asOf')),
    );
  }
}

String _reqString(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is String) return value;
  throw FormatException('Champ texte requis manquant : $key');
}

String? _optString(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value == null) return null;
  if (value is String) return value;
  throw FormatException('Champ texte invalide : $key');
}

int _reqInt(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is int) return value;
  throw FormatException('Champ entier requis manquant : $key');
}

bool _reqBool(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is bool) return value;
  throw FormatException('Champ booléen requis manquant : $key');
}

List<String> _reqStringList(Map<String, Object?> json, String key) {
  final value = json[key];
  if (value is List<Object?>) {
    return value.map((e) {
      if (e is String) return e;
      throw FormatException('Élément texte attendu dans $key');
    }).toList();
  }
  throw FormatException('Liste de textes requise manquante : $key');
}

Map<String, Object?> _reqMap(Map<String, Object?> json, String key) {
  return _asMap(json[key], key);
}

Map<String, Object?> _asMap(Object? value, String label) {
  if (value is Map<Object?, Object?>) {
    return value.map((k, v) => MapEntry(k.toString(), v));
  }
  throw FormatException('Objet JSON attendu pour $label');
}

final class Installment {
  const Installment({required this.dueDate, required this.amountXaf});

  final String dueDate;
  final MoneyXaf amountXaf;

  factory Installment.fromJson(Map<String, Object?> json) {
    return Installment(
      dueDate: _reqString(json, 'dueDate'),
      amountXaf: MoneyXaf.parse(_reqString(json, 'amountXaf')),
    );
  }
}

final class Quote {
  const Quote({
    required this.quoteId,
    required this.offerId,
    required this.model,
    required this.planId,
    required this.durationMonths,
    required this.totalXaf,
    required this.feesXaf,
    required this.installments,
    required this.expiresAt,
    this.downPaymentXaf,
    this.tegPercent,
  });

  final String quoteId;
  final String offerId;
  final OfferModel model;
  final String planId;
  final int durationMonths;
  final MoneyXaf totalXaf;
  final MoneyXaf feesXaf;
  final MoneyXaf? downPaymentXaf;
  final String? tegPercent;
  final List<Installment> installments;
  final DateTime expiresAt;

  factory Quote.fromJson(Map<String, Object?> json) {
    final rawInstallments = json['installments'];
    if (rawInstallments is! List<Object?>) {
      throw const FormatException('Champ installments attendu.');
    }
    final downRaw = _optString(json, 'downPaymentXaf');
    return Quote(
      quoteId: _reqString(json, 'quoteId'),
      offerId: _reqString(json, 'offerId'),
      model: OfferModel.parse(_reqString(json, 'model')),
      planId: _reqString(json, 'planId'),
      durationMonths: _reqInt(json, 'durationMonths'),
      totalXaf: MoneyXaf.parse(_reqString(json, 'totalXaf')),
      feesXaf: MoneyXaf.parse(_reqString(json, 'feesXaf')),
      downPaymentXaf: downRaw != null ? MoneyXaf.parse(downRaw) : null,
      tegPercent: _optString(json, 'tegPercent'),
      installments: rawInstallments
          .map((item) => Installment.fromJson(_asMap(item, 'installment')))
          .toList(),
      expiresAt: DateTime.parse(_reqString(json, 'expiresAt')),
    );
  }
}

final class GoalSigningPayload {
  const GoalSigningPayload({
    required this.transition,
    required this.payloadBase64,
    required this.seq,
  });

  final String transition;
  final String payloadBase64;
  final int seq;

  factory GoalSigningPayload.fromJson(Map<String, Object?> json) {
    return GoalSigningPayload(
      transition: _reqString(json, 'transition'),
      payloadBase64: _reqString(json, 'payloadBase64'),
      seq: _reqInt(json, 'seq'),
    );
  }
}

enum BeneficiaryDocumentKind {
  lease('LEASE'),
  landTitle('LAND_TITLE');

  const BeneficiaryDocumentKind(this.apiValue);
  final String apiValue;
}

final class BeneficiaryDocument {
  const BeneficiaryDocument({
    required this.documentId,
    required this.goalId,
    required this.kind,
    required this.sha256,
    required this.reviewStatus,
  });

  final String documentId;
  final String goalId;
  final String kind;
  final String sha256;
  final String reviewStatus;

  factory BeneficiaryDocument.fromJson(Map<String, Object?> json) {
    return BeneficiaryDocument(
      documentId: _reqString(json, 'documentId'),
      goalId: _reqString(json, 'goalId'),
      kind: _reqString(json, 'kind'),
      sha256: _reqString(json, 'sha256'),
      reviewStatus: _reqString(json, 'reviewStatus'),
    );
  }
}

final class BeneficiaryReceipt {
  const BeneficiaryReceipt({
    required this.goalId,
    required this.payoutId,
    required this.beneficiaryId,
    required this.amountXaf,
    required this.executedAt,
    required this.bankReference,
    required this.entryHashPrefix,
  });

  final String goalId;
  final String payoutId;
  final String beneficiaryId;
  final MoneyXaf amountXaf;
  final DateTime executedAt;
  final String bankReference;
  final String entryHashPrefix;

  factory BeneficiaryReceipt.fromJson(Map<String, Object?> json) {
    return BeneficiaryReceipt(
      goalId: _reqString(json, 'goalId'),
      payoutId: _reqString(json, 'payoutId'),
      beneficiaryId: _reqString(json, 'beneficiaryId'),
      amountXaf: MoneyXaf.parse(_reqString(json, 'amountXaf')),
      executedAt: DateTime.parse(_reqString(json, 'executedAt')),
      bankReference: _reqString(json, 'bankReference'),
      entryHashPrefix: _reqString(json, 'entryHashPrefix'),
    );
  }
}

enum ClaimReason {
  paymentNotReceived('PAYMENT_NOT_RECEIVED'),
  handoverRefused('HANDOVER_REFUSED'),
  offerMismatch('OFFER_MISMATCH'),
  other('OTHER');

  const ClaimReason(this.apiValue);
  final String apiValue;
}

final class ClaimReceipt {
  const ClaimReceipt({
    required this.claimId,
    required this.reference,
    required this.status,
    required this.createdAt,
  });

  final String claimId;
  final String reference;
  final String status;
  final DateTime createdAt;

  factory ClaimReceipt.fromJson(Map<String, Object?> json) {
    return ClaimReceipt(
      claimId: _reqString(json, 'claimId'),
      reference: _reqString(json, 'reference'),
      status: _reqString(json, 'status'),
      createdAt: DateTime.parse(_reqString(json, 'createdAt')),
    );
  }
}

final class AccountDevice {
  const AccountDevice({
    required this.deviceId,
    required this.name,
    required this.status,
    required this.registeredAt,
    required this.current,
  });

  final String deviceId;
  final String name;
  final String status;
  final DateTime registeredAt;
  final bool current;

  factory AccountDevice.fromJson(Map<String, Object?> json) {
    return AccountDevice(
      deviceId: _reqString(json, 'deviceId'),
      name: _reqString(json, 'name'),
      status: _reqString(json, 'status'),
      registeredAt: DateTime.parse(_reqString(json, 'registeredAt')),
      current: _reqBool(json, 'current'),
    );
  }
}

final class AccountSession {
  const AccountSession({
    required this.sessionId,
    required this.deviceName,
    required this.createdAt,
    required this.accessExpiresAt,
    required this.refreshExpiresAt,
    required this.current,
  });

  final String sessionId;
  final String deviceName;
  final DateTime createdAt;
  final DateTime accessExpiresAt;
  final DateTime refreshExpiresAt;
  final bool current;

  factory AccountSession.fromJson(Map<String, Object?> json) {
    return AccountSession(
      sessionId: _reqString(json, 'sessionId'),
      deviceName: _reqString(json, 'deviceName'),
      createdAt: DateTime.parse(_reqString(json, 'createdAt')),
      accessExpiresAt: DateTime.parse(_reqString(json, 'accessExpiresAt')),
      refreshExpiresAt: DateTime.parse(_reqString(json, 'refreshExpiresAt')),
      current: _reqBool(json, 'current'),
    );
  }
}

final class AccountSecurity {
  const AccountSecurity({
    required this.devices,
    required this.sessions,
    required this.asOf,
  });

  final List<AccountDevice> devices;
  final List<AccountSession> sessions;
  final DateTime asOf;

  factory AccountSecurity.fromJson(Map<String, Object?> json) {
    final rawDevices = json['devices'];
    final rawSessions = json['sessions'];
    if (rawDevices is! List<Object?> || rawSessions is! List<Object?>) {
      throw const FormatException('Champs devices et sessions attendus.');
    }
    return AccountSecurity(
      devices: rawDevices
          .map((item) => AccountDevice.fromJson(_asMap(item, 'device')))
          .toList(),
      sessions: rawSessions
          .map((item) => AccountSession.fromJson(_asMap(item, 'session')))
          .toList(),
      asOf: DateTime.parse(_reqString(json, 'asOf')),
    );
  }
}

enum DataRightKind {
  access('ACCESS'),
  rectification('RECTIFICATION'),
  objection('OBJECTION'),
  erasure('ERASURE');

  const DataRightKind(this.apiValue);
  final String apiValue;

  static DataRightKind parse(String raw) {
    for (final value in values) {
      if (value.apiValue == raw) return value;
    }
    throw FormatException('Type de droit inconnu : $raw');
  }
}

final class DataRightReceipt {
  const DataRightReceipt({
    required this.requestId,
    required this.kind,
    required this.status,
    required this.receivedAt,
  });

  final String requestId;
  final DataRightKind kind;
  final String status;
  final DateTime receivedAt;

  factory DataRightReceipt.fromJson(Map<String, Object?> json) {
    return DataRightReceipt(
      requestId: _reqString(json, 'requestId'),
      kind: DataRightKind.parse(_reqString(json, 'kind')),
      status: _reqString(json, 'status'),
      receivedAt: DateTime.parse(_reqString(json, 'receivedAt')),
    );
  }
}

final class DataRightHistory {
  const DataRightHistory({required this.items, required this.asOf});

  final List<DataRightReceipt> items;
  final DateTime asOf;

  factory DataRightHistory.fromJson(Map<String, Object?> json) {
    final rawItems = json['items'];
    if (rawItems is! List<Object?>) {
      throw const FormatException('Champ items attendu.');
    }
    return DataRightHistory(
      items: rawItems
          .map((item) => DataRightReceipt.fromJson(_asMap(item, 'item')))
          .toList(),
      asOf: DateTime.parse(_reqString(json, 'asOf')),
    );
  }
}

final class KycVerification {
  const KycVerification({required this.verification});

  final String verification;

  factory KycVerification.fromJson(Map<String, Object?> json) {
    return KycVerification(verification: _reqString(json, 'verification'));
  }
}

/// Profil minimal du client connecté (`GET /v1/me`, OpenAPI 0.33.0, D77).
final class AccountProfile {
  const AccountProfile({
    required this.accountId,
    required this.phoneMasked,
    required this.memberSince,
    required this.legalNameDeclared,
    required this.currentTermsVersion,
    required this.termsAccepted,
  });

  final String accountId;
  final String phoneMasked;
  final String memberSince;
  final bool legalNameDeclared;

  /// F-ACC-004 (contrat 0.41.0) : version en vigueur et son acceptation.
  final String currentTermsVersion;
  final bool termsAccepted;

  factory AccountProfile.fromJson(Map<String, Object?> json) {
    return AccountProfile(
      accountId: _reqString(json, 'accountId'),
      phoneMasked: _reqString(json, 'phoneMasked'),
      memberSince: _reqString(json, 'memberSince'),
      legalNameDeclared: _reqBool(json, 'legalNameDeclared'),
      currentTermsVersion: _reqString(json, 'currentTermsVersion'),
      termsAccepted: _reqBool(json, 'termsAccepted'),
    );
  }
}

/// Résultat du renouvellement de session (`POST /v1/auth/session-refreshes`, OpenAPI 0.33.0).
final class ClientSessionRefresh {
  const ClientSessionRefresh({required this.accessExpiresAt});

  final DateTime accessExpiresAt;

  factory ClientSessionRefresh.fromJson(Map<String, Object?> json) {
    return ClientSessionRefresh(
      accessExpiresAt: DateTime.parse(_reqString(json, 'accessExpiresAt')),
    );
  }
}

/// Défi OTP d'inscription (`POST /v1/auth/otp-challenges`, Contrat 0.34.0).
final class OtpChallenge {
  const OtpChallenge({required this.challengeId, required this.expiresAt});

  final String challengeId;
  final DateTime expiresAt;

  factory OtpChallenge.fromJson(Map<String, Object?> json) {
    return OtpChallenge(
      challengeId: _reqString(json, 'challengeId'),
      expiresAt: DateTime.parse(_reqString(json, 'expiresAt')),
    );
  }
}

/// Résultat d'inscription (`POST /v1/auth/signups`, Contrat 0.34.0, D71).
final class SignupResult {
  const SignupResult({
    required this.accountId,
    required this.deviceId,
    required this.accessExpiresAt,
  });

  final String accountId;
  final String deviceId;
  final DateTime accessExpiresAt;

  factory SignupResult.fromJson(Map<String, Object?> json) {
    return SignupResult(
      accountId: _reqString(json, 'accountId'),
      deviceId: _reqString(json, 'deviceId'),
      accessExpiresAt: DateTime.parse(_reqString(json, 'accessExpiresAt')),
    );
  }
}

/// Défi de connexion par appareil (`POST /v1/auth/device-challenges`, Contrat 0.34.0, D71).
final class ClientLoginChallenge {
  const ClientLoginChallenge({
    required this.challengeId,
    required this.challenge,
    required this.expiresAt,
  });

  final String challengeId;
  final String challenge;
  final DateTime expiresAt;

  factory ClientLoginChallenge.fromJson(Map<String, Object?> json) {
    return ClientLoginChallenge(
      challengeId: _reqString(json, 'challengeId'),
      challenge: _reqString(json, 'challenge'),
      expiresAt: DateTime.parse(_reqString(json, 'expiresAt')),
    );
  }
}

/// Résultat de connexion appareil + PIN (`POST /v1/auth/sessions`, Contrat 0.34.0, D71).
final class ClientLoginResult {
  const ClientLoginResult({
    required this.accountId,
    required this.accessExpiresAt,
  });

  final String accountId;
  final DateTime accessExpiresAt;

  factory ClientLoginResult.fromJson(Map<String, Object?> json) {
    return ClientLoginResult(
      accountId: _reqString(json, 'accountId'),
      accessExpiresAt: DateTime.parse(_reqString(json, 'accessExpiresAt')),
    );
  }
}

/// Usage d'un défi d'appareil (`POST /v1/auth/device-challenges`, Contrat 0.35.0, D71 / SEC-AUTH-005).
enum DeviceChallengePurpose {
  login('LOGIN', 'molopay.client-login.v1'),
  refresh('REFRESH', 'molopay.client-refresh.v1');

  const DeviceChallengePurpose(this.apiValue, this.signingContext);
  final String apiValue;
  final String signingContext;
}

/// Notification client générique (`GET /v1/me/notifications`, Contrat 0.37.0, F-NOT-001/002).
final class CustomerNotification {
  const CustomerNotification({
    required this.notificationId,
    required this.eventType,
    required this.createdAt,
    required this.title,
    required this.body,
  });

  final String notificationId;
  final String eventType;
  final DateTime createdAt;
  final String title;
  final String body;

  factory CustomerNotification.fromJson(Map<String, Object?> json) {
    return CustomerNotification(
      notificationId: _reqString(json, 'notificationId'),
      eventType: _reqString(json, 'eventType'),
      createdAt: DateTime.parse(_reqString(json, 'createdAt')),
      title: _reqString(json, 'title'),
      body: _reqString(json, 'body'),
    );
  }
}

/// Fil paginé des notifications client (`GET /v1/me/notifications`).
final class CustomerNotificationFeed {
  const CustomerNotificationFeed({
    required this.items,
    required this.nextBefore,
    required this.asOf,
  });

  final List<CustomerNotification> items;
  final String? nextBefore;
  final DateTime asOf;

  factory CustomerNotificationFeed.fromJson(Map<String, Object?> json) {
    final rawItems = json['items'];
    if (rawItems is! List<Object?>) {
      throw const FormatException('Champ items attendu.');
    }
    return CustomerNotificationFeed(
      items: rawItems
          .map((item) => CustomerNotification.fromJson(_asMap(item, 'item')))
          .toList(),
      nextBefore: _optString(json, 'nextBefore'),
      asOf: DateTime.parse(_reqString(json, 'asOf')),
    );
  }
}
