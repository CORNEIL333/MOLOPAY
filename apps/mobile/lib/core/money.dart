/// Type monétaire entier XAF basé exclusivement sur [BigInt] (Invariant I-12, NF-FUN-001).
/// Aucun flottant n'est jamais utilisé pour représenter ou formater un montant.
class MoneyFormatException implements FormatException {
  const MoneyFormatException(this.message, {this.source});

  final String code = 'INVALID_MONEY_AMOUNT';

  @override
  final String message;

  @override
  final Object? source;

  @override
  int? get offset => null;

  @override
  String toString() => 'MoneyFormatException($code): $message';
}

final class MoneyXaf implements Comparable<MoneyXaf> {
  const MoneyXaf._(this.amount);

  static final RegExp _apiPattern = RegExp(r'^(0|[1-9][0-9]*)$');

  static final MoneyXaf zero = MoneyXaf._(BigInt.zero);

  final BigInt amount;

  /// Parse une chaîne décimale entière non négative conforme au schéma OpenAPI `Money`.
  factory MoneyXaf.parse(String raw) {
    if (!_apiPattern.hasMatch(raw)) {
      throw MoneyFormatException(
        'Montant XAF invalide : entier décimal non négatif attendu.',
        source: raw,
      );
    }
    return MoneyXaf._(BigInt.parse(raw));
  }

  /// Construit un [MoneyXaf] depuis un [BigInt] non négatif.
  factory MoneyXaf.fromBigInt(BigInt value) {
    if (value.isNegative) {
      throw const MoneyFormatException(
        'Un montant XAF ne peut pas être négatif.',
      );
    }
    return MoneyXaf._(value);
  }

  String toApiString() => amount.toString();

  /// Formate le montant entier (« 25 000 FCFA ») sans conversion en flottant.
  /// En mode [sms] (GSM-7 / USSD), utilise l'espace ASCII ordinaire au lieu de U+202F.
  String format({String locale = 'fr', bool sms = false}) {
    final digits = amount.toString();
    final sep = sms ? ' ' : '\u202F';
    final buffer = StringBuffer();
    final len = digits.length;
    for (var i = 0; i < len; i++) {
      if (i > 0 && (len - i) % 3 == 0) {
        buffer.write(sep);
      }
      buffer.write(digits[i]);
    }
    buffer.write(' FCFA');
    return buffer.toString();
  }

  @override
  int compareTo(MoneyXaf other) => amount.compareTo(other.amount);

  @override
  bool operator ==(Object other) =>
      identical(this, other) || (other is MoneyXaf && other.amount == amount);

  @override
  int get hashCode => amount.hashCode;

  @override
  String toString() => toApiString();
}
