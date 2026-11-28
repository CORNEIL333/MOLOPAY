import 'package:flutter_test/flutter_test.dart';
import 'package:molopay_mobile/core/money.dart';

void main() {
  group('NF-FUN-001 / I-12 — MoneyXaf (entiers BigInt XAF uniquement)', () {
    test('parse accepte 0 et les entiers positifs valides', () {
      expect(MoneyXaf.parse('0').amount, BigInt.zero);
      expect(MoneyXaf.parse('5000').amount, BigInt.from(5000));
      expect(
        MoneyXaf.parse('9007199254740993000').amount,
        BigInt.parse('9007199254740993000'),
      );
    });

    test('refuse les flottants, négatifs, zéros en tête et chaînes invalides', () {
      for (final invalid in [
        '',
        '-100',
        '12.50',
        '12,50',
        '01',
        '00',
        '1 000',
        'abc',
        'NaN',
        '+100',
      ]) {
        expect(
          () => MoneyXaf.parse(invalid),
          throwsA(
            isA<MoneyFormatException>().having(
              (e) => e.code,
              'code',
              'INVALID_MONEY_AMOUNT',
            ),
          ),
          reason: 'Doit refuser "$invalid"',
        );
      }
    });

    test('formatte les montants en FR et EN au format unique « 25 000 FCFA » sans flottant', () {
      final value = MoneyXaf.parse('1250000');
      expect(value.format(locale: 'fr'), '1\u202F250\u202F000 FCFA');
      expect(value.format(locale: 'en'), '1\u202F250\u202F000 FCFA');
      expect(value.format(sms: true), '1 250 000 FCFA');
      expect(MoneyXaf.zero.format(locale: 'fr'), '0 FCFA');
    });

    test('toApiString renvoie la chaîne décimale exacte', () {
      final value = MoneyXaf.parse('75000');
      expect(value.toApiString(), '75000');
    });
  });
}
