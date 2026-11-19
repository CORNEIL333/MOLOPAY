import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:molopay_mobile/app.dart';
import 'package:molopay_mobile/core/api_client.dart';
import 'package:molopay_mobile/core/app_state.dart';
import 'package:molopay_mobile/core/models.dart';
import 'package:molopay_mobile/core/money.dart';
import 'package:molopay_mobile/core/problem.dart';
import 'package:molopay_mobile/screens/offer_quote_panel.dart';

void main() {
  group('Contrat 0.33.0 — GET /v1/me et POST /v1/auth/session-refreshes', () {
    test('getCurrentAccount et refreshSession (rotation cookie client_refresh + Idempotency-Key)', () async {
      String? refreshCookieSent;
      String? idempotencySent;
      final client = MoloPayApiClient(
        baseUrl: 'https://api.molopay.test',
        origin: 'https://app.molopay.test',
        httpClient: MockClient((request) async {
          if (request.url.path == '/v1/auth/sessions') {
            return http.Response(
              jsonEncode({
                'accountId': '22222222-2222-4222-8222-222222222222',
                'displayName': 'Amina N.',
                'locale': 'fr',
                'expiresAt': '2026-11-20T12:00:00Z',
              }),
              201,
              headers: {
                'content-type': 'application/json',
                'set-cookie':
                    'client_session=sess_v1; Path=/; HttpOnly, client_refresh=ref_v1; Path=/v1/auth; HttpOnly',
              },
            );
          }
          if (request.url.path == '/v1/me') {
            return http.Response(
              jsonEncode({
                'accountId': '22222222-2222-4222-8222-222222222222',
                'phoneMasked': '+2376•••••••34',
                'memberSince': '2026-10-26',
                'legalNameDeclared': true,
              }),
              200,
              headers: {'content-type': 'application/json; charset=utf-8'},
            );
          }
          if (request.url.path == '/v1/auth/session-refreshes') {
            refreshCookieSent = request.headers['cookie'];
            idempotencySent = request.headers['idempotency-key'];
            return http.Response(
              jsonEncode({'accessExpiresAt': '2026-11-20T13:00:00Z'}),
              201,
              headers: {
                'set-cookie':
                    'client_session=sess_v2; Path=/; HttpOnly, client_refresh=ref_v2; Path=/v1/auth; HttpOnly',
              },
            );
          }
          return http.Response('{}', 404);
        }),
      );

      await client.signIn(phone: '+237670000034', pin: '123456');
      expect(client.hasRefreshToken, isTrue);

      final profile = await client.getCurrentAccount();
      expect(profile.phoneMasked, '+2376•••••••34');
      expect(profile.legalNameDeclared, isTrue);

      final refreshed = await client.refreshSession();
      expect(refreshCookieSent, 'client_refresh=ref_v1');
      expect(idempotencySent, isNotEmpty);
      expect(refreshed.accessExpiresAt, DateTime.utc(2026, 11, 20, 13));
    });

    test('refreshSession refuse UNAUTHORIZED sur jeton réutilisé (401)', () async {
      final client = MoloPayApiClient(
        baseUrl: 'https://api.molopay.test',
        origin: 'https://app.molopay.test',
        httpClient: MockClient((_) async {
          return http.Response(
            jsonEncode({
              'type': 'https://molopay.cm/problems/unauthorized',
              'title': 'Session révoquée',
              'status': 401,
              'code': 'UNAUTHORIZED',
            }),
            401,
          );
        }),
      );

      await expectLater(
        () => client.refreshSession(),
        throwsA(
          isA<ApiProblemException>()
              .having((e) => e.problem.status, 'status', 401)
              .having((e) => e.problem.code, 'code', 'UNAUTHORIZED'),
        ),
      );
    });
  });

  testWidgets('G6 — Bureau (1200x800) affiche NavigationRail et OfferQuotePanel crée un brouillon Modèle A', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 800);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final api = MoloPayApiClient(
      baseUrl: 'https://api.molopay.test',
      origin: 'https://app.molopay.test',
      httpClient: MockClient((request) async {
        if (request.url.path == '/v1/offers') {
          return http.Response(
            jsonEncode({'offers': <Object>[], 'asOf': '2026-11-20T10:00:00Z'}),
            200,
          );
        }
        if (request.url.path == '/v1/plans') {
          return http.Response(jsonEncode({'plans': <Object>[]}), 200);
        }
        if (request.url.path.endsWith('/quotes')) {
          return http.Response(
            jsonEncode({
              'quoteId': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              'offerId': '11111111-1111-4111-8111-111111111111',
              'model': 'SAVE_THEN_BUY',
              'planId': 'plan-monthly-a',
              'durationMonths': 3,
              'totalXaf': '185000',
              'feesXaf': '0',
              'installments': [
                {'dueDate': '2026-12-01', 'amountXaf': '62000'},
              ],
              'expiresAt': '2026-11-21T10:00:00Z',
            }),
            201,
          );
        }
        if (request.url.path == '/v1/goals' && request.method == 'POST') {
          return http.Response(
            jsonEncode({
              'goalId': '99999999-9999-4999-8999-999999999999',
              'model': 'SAVE_THEN_BUY',
              'status': 'DRAFT',
              'locked': false,
              'offerId': '11111111-1111-4111-8111-111111111111',
              'offerTitle': 'Réfrigérateur 220L',
              'partnerName': 'Électro Yaoundé',
              'beneficiaryId': null,
              'planId': 'plan-monthly-a',
              'rhythm': 'MONTHLY',
              'minAmountXaf': '10000',
              'durationMonths': 3,
              'targetXaf': '185000',
              'savedXaf': '0',
              'progressBasisPoints': 0,
              'createdAt': '2026-11-20T10:00:00Z',
              'updatedAt': '2026-11-20T10:00:00Z',
            }),
            201,
          );
        }
        return http.Response('{}', 404);
      }),
    );

    await tester.pumpWidget(MoloPayApp(apiClient: api));
    await tester.pumpAndSettle();

    expect(find.byType(NavigationRail), findsOneWidget);

    final state = AppState(api: api);
    final offer = Offer(
      offerId: '11111111-1111-4111-8111-111111111111',
      title: 'Réfrigérateur 220L',
      partnerId: 'prt-01',
      partnerName: 'Électro Yaoundé',
      universe: Universe.essentials,
      models: const [OfferModel.saveThenBuy],
      cities: const [City.yaounde],
      priceXaf: MoneyXaf.parse('185000'),
      availability: const InStockAvailability(3),
      warranty: '12 mois',
      discountTerms: 'Prix figé',
      status: OfferStatus.published,
    );
    final plan = PaymentPlan(
      planId: 'plan-monthly-a',
      model: OfferModel.saveThenBuy,
      rhythm: Rhythm.monthly,
      minAmountXaf: MoneyXaf.parse('10000'),
      maxDurationMonths: 12,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: OfferQuotePanel(offer: offer, plans: [plan], state: state),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('offer-quote-button')));
    await tester.pumpAndSettle();
    expect(find.textContaining('62'), findsOneWidget);

    await tester.tap(find.byKey(const Key('offer-terms-checkbox')));
    await tester.tap(find.byKey(const Key('offer-start-goal-button')));
    await tester.pumpAndSettle();
    expect(find.textContaining('99999999-9999-4999-8999-999999999999'), findsOneWidget);
  });

}
