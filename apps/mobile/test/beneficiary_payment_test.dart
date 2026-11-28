import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:molopay_mobile/core/api_client.dart';
import 'package:molopay_mobile/core/app_state.dart';
import 'package:molopay_mobile/core/models.dart';
import 'package:molopay_mobile/core/money.dart';
import 'package:molopay_mobile/screens/goals_screen.dart';

const _goalId = '55555555-5555-4555-8555-555555555555';

Map<String, Object?> _goalJson(String status) => {
  'goalId': _goalId,
  'model': 'PLANNED_EXPENSE',
  'status': status,
  'locked': true,
  'offerId': null,
  'offerTitle': null,
  'partnerName': null,
  'beneficiaryId': 'ben-loyer-01',
  'planId': 'plan-c-monthly',
  'rhythm': 'MONTHLY',
  'minAmountXaf': '25000',
  'durationMonths': 12,
  'targetXaf': '300000',
  'savedXaf': '300000',
  'progressBasisPoints': 10000,
  'createdAt': '2026-11-01T10:00:00Z',
  'updatedAt': '2026-11-20T10:00:00Z',
};

Future<List<http.Request>> _pumpFunded(WidgetTester tester) async {
  final requests = <http.Request>[];
  final api = MoloPayApiClient(
    baseUrl: 'https://api.molopay.test',
    origin: 'https://app.molopay.test',
    httpClient: MockClient((request) async {
      requests.add(request);
      if (request.url.path.endsWith('/contributions')) {
        return http.Response(
          jsonEncode({
            'contributions': <Object>[],
            'asOf': '2026-11-20T10:00:00Z',
          }),
          200,
        );
      }
      if (request.url.path.endsWith('/beneficiary-payment')) {
        return http.Response(jsonEncode(_goalJson('PAID_TO_BENEFICIARY')), 200);
      }
      if (request.url.path.endsWith('/beneficiary-receipt')) {
        return http.Response(
          '{"type":"about:blank","title":"Introuvable","status":404,"code":"NOT_FOUND"}',
          404,
        );
      }
      return http.Response('{}', 404);
    }),
  );
  final goal = Goal.fromJson(_goalJson('FUNDED'));
  await tester.pumpWidget(
    MaterialApp(
      home: GoalDetailScreen(
        goal: goal,
        state: AppState(api: api),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return requests;
}

Future<void> _tap(WidgetTester tester, String key) async {
  await tester.ensureVisible(find.byKey(Key(key)));
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'F-PLN-003 — règlement C : résumé irréversible, puis PIN, puis appel serveur',
    (tester) async {
      final requests = await _pumpFunded(tester);
      expect(find.byKey(const Key('beneficiary-pin-field')), findsNothing);

      await _tap(tester, 'beneficiary-pay-prepare');
      expect(find.textContaining('ben-loyer-01'), findsOneWidget);
      expect(
        find.textContaining(MoneyXaf.parse('300000').format(locale: 'fr')),
        findsWidgets,
      );
      expect(find.textContaining('irréversible'), findsOneWidget);

      await tester.enterText(
        find.byKey(const Key('beneficiary-pin-field')),
        '123456',
      );
      await _tap(tester, 'beneficiary-pay-confirm');

      final payment = requests
          .where((r) => r.url.path == '/v1/goals/$_goalId/beneficiary-payment')
          .toList();
      expect(payment, hasLength(1));
      expect(jsonDecode(payment.single.body), {'pin': '123456'});
      expect(find.byKey(const Key('beneficiary-paid-status')), findsOneWidget);
      expect(find.byKey(const Key('beneficiary-pay-prepare')), findsNothing);
    },
  );

  testWidgets(
    'F-PLN-003 — refuse : PIN mal formé, aucun appel ; annulation ferme le résumé',
    (tester) async {
      final requests = await _pumpFunded(tester);
      await _tap(tester, 'beneficiary-pay-prepare');
      await tester.enterText(
        find.byKey(const Key('beneficiary-pin-field')),
        '12345',
      );
      await _tap(tester, 'beneficiary-pay-confirm');
      expect(
        requests.where((r) => r.url.path.endsWith('/beneficiary-payment')),
        isEmpty,
      );
      expect(find.byKey(const Key('beneficiary-pin-error')), findsOneWidget);

      await _tap(tester, 'beneficiary-pay-cancel');
      expect(find.byKey(const Key('beneficiary-pin-field')), findsNothing);
      expect(
        requests.where((r) => r.url.path.endsWith('/beneficiary-payment')),
        isEmpty,
      );
    },
  );

  testWidgets(
    'F-PLN-002 — dépôt de la pièce : orienté vers le client web, aucune empreinte saisie à la main',
    (tester) async {
      await _pumpFunded(tester);
      expect(
        find.byKey(const Key('beneficiary-document-web-notice')),
        findsOneWidget,
      );
      expect(
        find
            .byType(TextField)
            .evaluate()
            .where(
              (e) =>
                  (e.widget as TextField).decoration?.labelText?.contains(
                    'SHA-256',
                  ) ??
                  false,
            ),
        isEmpty,
      );
    },
  );
}
