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
    required this.displayName,
    required this.locale,
    required this.expiresAt,
  });

  final String accountId;
  final String displayName;
  final String locale;
  final DateTime expiresAt;

  factory SessionSummary.fromJson(Map<String, Object?> json) {
    return SessionSummary(
      accountId: _reqString(json, 'accountId'),
      displayName: _reqString(json, 'displayName'),
      locale: _reqString(json, 'locale'),
      expiresAt: DateTime.parse(_reqString(json, 'expiresAt')),
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
      goals: rawList.map((item) => Goal.fromJson(_asMap(item, 'goal'))).toList(),
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
