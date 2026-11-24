import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:molopay_mobile/core/api_client.dart';
import 'package:molopay_mobile/core/app_state.dart';
import 'package:molopay_mobile/core/models.dart';
import 'package:molopay_mobile/core/money.dart';
import 'package:molopay_mobile/core/problem.dart';
import 'package:molopay_mobile/screens/goals_screen.dart';
import 'package:molopay_mobile/screens/planned_expense_screen.dart';

void main() {
  group('F-CAT-004 / F-GOA-001 / F-PLN-001 — Devis et création d’objectifs A et C', () {
    test('requestQuote et createGoal Modèle C envoient les schémas OpenAPI exacts', () async {
      final calls = <String>[];
      final client = MoloPayApiClient(
        baseUrl: 'https://api.molopay.test',
        origin: 'https://app.molopay.test',
        httpClient: MockClient((request) async {
          calls.add('${request.method} ${request.url.path}');
          if (request.url.path == '/v1/offers/11111111-1111-4111-8111-111111111111/quotes') {
            expect(request.headers['idempotency-key'], isNotEmpty);
            expect(request.headers['origin'], 'https://app.molopay.test');
            return http.Response(
              jsonEncode({
                'quoteId': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                'offerId': '11111111-1111-4111-8111-111111111111',
                'model': 'SAVE_THEN_BUY',
                'planId': 'plan-monthly-a',
                'durationMonths': 6,
                'totalXaf': '185000',
                'feesXaf': '0',
                'installments': [
                  {'dueDate': '2026-12-01', 'amountXaf': '31000'},
                ],
                'expiresAt': '2026-11-21T10:00:00Z',
              }),
              201,
              headers: {'content-type': 'application/json'},
            );
          }
          if (request.url.path == '/v1/goals' && request.method == 'POST') {
            final body = jsonDecode(request.body) as Map<String, Object?>;
            expect(body['model'], 'PLANNED_EXPENSE');
            expect(body['targetXaf'], '300000');
            return http.Response(
              jsonEncode({
                'goalId': '55555555-5555-4555-8555-555555555555',
                'model': 'PLANNED_EXPENSE',
                'status': 'DRAFT',
                'locked': false,
                'offerId': null,
                'offerTitle': null,
                'partnerName': null,
                'beneficiaryId': 'ben-loyer-01',
                'planId': 'plan-c-monthly',
                'rhythm': 'MONTHLY',
                'minAmountXaf': '15000',
                'durationMonths': 6,
                'targetXaf': '300000',
                'savedXaf': '0',
                'progressBasisPoints': 0,
                'createdAt': '2026-11-20T09:00:00Z',
                'updatedAt': '2026-11-20T09:00:00Z',
              }),
              201,
              headers: {'content-type': 'application/json'},
            );
          }
          return http.Response('{}', 404);
        }),
      );

      final quote = await client.requestQuote(
        offerId: '11111111-1111-4111-8111-111111111111',
        planId: 'plan-monthly-a',
        durationMonths: 6,
      );
      expect(quote.totalXaf, MoneyXaf.parse('185000'));
      expect(quote.installments.first.amountXaf, MoneyXaf.parse('31000'));

      final goal = await client.createGoal(
        model: OfferModel.plannedExpense,
        beneficiaryId: 'ben-loyer-01',
        targetXaf: MoneyXaf.parse('300000'),
        planId: 'plan-c-monthly',
        durationMonths: 6,
        acceptTermsVersion: '2026-10-26-v1',
      );
      expect(goal.status, GoalStatus.draft);
      expect(goal.targetXaf, MoneyXaf.parse('300000'));
      expect(calls, hasLength(2));
    });
  });

  group('F-GOA-004 / F-PLN-002 / F-PLN-003 / F-SUP-001 — Cycle de vie, bénéficiaire C et réclamations', () {
    test('lockGoal, submitBeneficiaryDocument, getBeneficiaryReceipt et submitClaim', () async {
      final client = MoloPayApiClient(
        baseUrl: 'https://api.molopay.test',
        origin: 'https://app.molopay.test',
        httpClient: MockClient((request) async {
          if (request.url.path.endsWith('/lock')) {
            return http.Response(
              jsonEncode({
                'goalId': '55555555-5555-4555-8555-555555555555',
                'model': 'PLANNED_EXPENSE',
                'status': 'ACTIVE',
                'locked': true,
                'offerId': null,
                'offerTitle': null,
                'partnerName': null,
                'beneficiaryId': 'ben-loyer-01',
                'planId': 'plan-c-monthly',
                'rhythm': 'MONTHLY',
                'minAmountXaf': '15000',
                'durationMonths': 6,
                'targetXaf': '300000',
                'savedXaf': '300000',
                'progressBasisPoints': 10000,
                'createdAt': '2026-11-01T09:00:00Z',
                'updatedAt': '2026-11-20T09:00:00Z',
              }),
              200,
            );
          }
          if (request.url.path.endsWith('/beneficiary-documents')) {
            return http.Response(
              jsonEncode({
                'documentId': '66666666-6666-4666-8666-666666666666',
                'goalId': '55555555-5555-4555-8555-555555555555',
                'kind': 'LEASE',
                'sha256': 'a' * 64,
                'reviewStatus': 'PENDING',
              }),
              201,
            );
          }
          if (request.url.path.endsWith('/beneficiary-receipt')) {
            return http.Response(
              jsonEncode({
                'goalId': '55555555-5555-4555-8555-555555555555',
                'payoutId': '77777777-7777-4777-8777-777777777777',
                'beneficiaryId': 'ben-loyer-01',
                'amountXaf': '300000',
                'executedAt': '2026-11-20T11:00:00Z',
                'bankReference': 'VIR-CM-2026-881',
                'entryHashPrefix': 'deadbeef',
              }),
              200,
            );
          }
          if (request.url.path.endsWith('/claims')) {
            return http.Response(
              jsonEncode({
                'claimId': '88888888-8888-4888-8888-888888888888',
                'reference': 'R-ABCDEF1234',
                'status': 'OPEN',
                'createdAt': '2026-11-20T11:05:00Z',
              }),
              201,
            );
          }
          return http.Response('{}', 404);
        }),
      );

      final locked = await client.lockGoal(
        '55555555-5555-4555-8555-555555555555',
        pin: '123456',
      );
      expect(locked.locked, isTrue);

      final doc = await client.submitBeneficiaryDocument(
        '55555555-5555-4555-8555-555555555555',
        kind: BeneficiaryDocumentKind.lease,
        sha256: 'a' * 64,
      );
      expect(doc.reviewStatus, 'PENDING');

      final receipt = await client.getBeneficiaryReceipt(
        '55555555-5555-4555-8555-555555555555',
      );
      expect(receipt.bankReference, 'VIR-CM-2026-881');
      expect(receipt.entryHashPrefix, 'deadbeef');
      expect(receipt.amountXaf, MoneyXaf.parse('300000'));

      final claim = await client.submitClaim(
        '55555555-5555-4555-8555-555555555555',
        reason: ClaimReason.paymentNotReceived,
        details: 'Versement MoMo effectué mais non affiché.',
      );
      expect(claim.reference, 'R-ABCDEF1234');
    });

    test('declareLegalName renvoie RECEIVED neutre et refuse LEGAL_NAME_QUOTA sur 429', () async {
      var calls = 0;
      final client = MoloPayApiClient(
        baseUrl: 'https://api.molopay.test',
        origin: 'https://app.molopay.test',
        httpClient: MockClient((_) async {
          calls++;
          if (calls == 1) {
            return http.Response(jsonEncode({'verification': 'RECEIVED'}), 200);
          }
          return http.Response(
            jsonEncode({
              'type': 'https://molopay.cm/problems/quota',
              'title': 'Quota atteint',
              'status': 429,
              'code': 'LEGAL_NAME_QUOTA',
            }),
            429,
          );
        }),
      );

      final ok = await client.declareLegalName('Amina Ndiaye');
      expect(ok.verification, 'RECEIVED');

      await expectLater(
        () => client.declareLegalName('Amina Ndiaye'),
        throwsA(
          isA<ApiProblemException>()
              .having((e) => e.problem.status, 'status', 429)
              .having((e) => e.problem.code, 'code', 'LEGAL_NAME_QUOTA'),
        ),
      );
    });
  });

  testWidgets('F-PLN-001 / I-12 — Écran Modèle C refuse les décimales sans appeler l’API', (
    tester,
  ) async {
    var apiCalled = false;
    final api = MoloPayApiClient(
      baseUrl: 'https://api.molopay.test',
      origin: 'https://app.molopay.test',
      httpClient: MockClient((request) async {
        if (request.url.path == '/v1/plans') {
          return http.Response(
            jsonEncode({
              'plans': [
                {
                  'planId': 'plan-c-monthly',
                  'model': 'PLANNED_EXPENSE',
                  'rhythm': 'MONTHLY',
                  'minAmountXaf': '15000',
                  'maxDurationMonths': 12,
                },
              ],
            }),
            200,
          );
        }
        apiCalled = true;
        return http.Response('{}', 500);
      }),
    );
    final state = AppState(api: api);

    await tester.pumpWidget(
      MaterialApp(home: NewPlannedExpenseScreen(state: state)),
    );
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byKey(const Key('planned-beneficiary-field')),
      'ben-loyer-01',
    );
    await tester.enterText(
      find.byKey(const Key('planned-target-field')),
      '15000.50',
    );
    await tester.tap(find.byKey(const Key('planned-submit-button')));
    await tester.pumpAndSettle();

    expect(apiCalled, isFalse);
    expect(find.textContaining('entier'), findsWidgets);
  });

  testWidgets('F-GOA-004 / F-SUP-001 — Détail objectif affiche verrouillage et reçu réclamation', (
    tester,
  ) async {
    final api = MoloPayApiClient(
      baseUrl: 'https://api.molopay.test',
      origin: 'https://app.molopay.test',
      httpClient: MockClient((request) async {
        if (request.url.path.endsWith('/contributions')) {
          return http.Response(
            jsonEncode({'contributions': <Object>[], 'asOf': '2026-11-20T10:00:00Z'}),
            200,
          );
        }
        if (request.url.path.endsWith('/claims')) {
          return http.Response(
            jsonEncode({
              'claimId': '88888888-8888-4888-8888-888888888888',
              'reference': 'R-ABCDEF1234',
              'status': 'OPEN',
              'createdAt': '2026-11-20T11:05:00Z',
            }),
            201,
          );
        }
        return http.Response('{}', 404);
      }),
    );
    final state = AppState(api: api);
    final goal = Goal(
      goalId: '33333333-3333-4333-8333-333333333333',
      model: OfferModel.saveThenBuy,
      status: GoalStatus.active,
      locked: false,
      offerId: '11111111-1111-4111-8111-111111111111',
      offerTitle: 'Réfrigérateur 220L',
      partnerName: 'Électro Yaoundé',
      beneficiaryId: null,
      planId: 'plan-monthly-a',
      rhythm: Rhythm.monthly,
      minAmountXaf: MoneyXaf.parse('10000'),
      durationMonths: 6,
      targetXaf: MoneyXaf.parse('185000'),
      savedXaf: MoneyXaf.parse('45000'),
      progressBasisPoints: 2432,
      createdAt: DateTime.utc(2026, 11, 1),
      updatedAt: DateTime.utc(2026, 11, 20),
    );

    await tester.pumpWidget(
      MaterialApp(home: GoalDetailScreen(goal: goal, state: state)),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('goal-lock-button')), findsOneWidget);
    await tester.enterText(
      find.byKey(const Key('claim-details-field')),
      'Paiement confirmé côté opérateur mais non affiché.',
    );
    await tester.ensureVisible(find.byKey(const Key('claim-submit-button')));
    await tester.tap(find.byKey(const Key('claim-submit-button')));
    await tester.pumpAndSettle();

    expect(find.textContaining('R-ABCDEF1234'), findsOneWidget);
  });
}
