import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:molopay_mobile/core/api_client.dart';
import 'package:molopay_mobile/core/models.dart';
import 'package:molopay_mobile/core/money.dart';
import 'package:molopay_mobile/core/problem.dart';

void main() {
  group('F-CAT-001 / F-CAT-003 — Catalogue API réelle', () {
    test('listOffers envoie les filtres en query et parse OfferList', () async {
      Uri? capturedUri;
      final client = MoloPayApiClient(
        baseUrl: 'https://api.molopay.test',
        origin: 'https://app.molopay.test',
        httpClient: MockClient((request) async {
          capturedUri = request.url;
          expect(request.method, 'GET');
          return http.Response(
            jsonEncode({
              'offers': [
                {
                  'offerId': '11111111-1111-4111-8111-111111111111',
                  'title': 'Réfrigérateur 220L',
                  'partnerId': 'prt-01',
                  'partnerName': 'Électro Yaoundé',
                  'universe': 'ESSENTIALS',
                  'models': ['SAVE_THEN_BUY'],
                  'cities': ['yaounde', 'douala'],
                  'priceXaf': '185000',
                  'availability': {'kind': 'IN_STOCK', 'units': 4},
                  'warranty': '12 mois',
                  'discountTerms': 'Prix figé à l’accord',
                  'status': 'PUBLISHED',
                },
              ],
              'asOf': '2026-11-20T10:00:00Z',
            }),
            200,
            headers: {'content-type': 'application/json'},
          );
        }),
      );

      final result = await client.listOffers(
        universe: Universe.essentials,
        city: City.yaounde,
      );

      expect(capturedUri?.path, '/v1/offers');
      expect(capturedUri?.queryParameters['universe'], 'ESSENTIALS');
      expect(capturedUri?.queryParameters['city'], 'yaounde');
      expect(result.offers, hasLength(1));
      expect(result.offers.first.priceXaf, MoneyXaf.parse('185000'));
      expect(result.offers.first.availability, isA<InStockAvailability>());
      expect(result.asOf, DateTime.utc(2026, 11, 20, 10));
    });

    test('getOffer refuse avec code métier exact OFFER_NOT_FOUND sur 404', () async {
      final client = MoloPayApiClient(
        baseUrl: 'https://api.molopay.test',
        origin: 'https://app.molopay.test',
        httpClient: MockClient((_) async {
          return http.Response(
            jsonEncode({
              'type': 'https://molopay.cm/problems/offer-not-found',
              'title': 'Offre introuvable',
              'status': 404,
              'code': 'OFFER_NOT_FOUND',
              'detail': 'Aucune offre publiée pour cet identifiant.',
            }),
            404,
            headers: {'content-type': 'application/problem+json'},
          );
        }),
      );

      expect(
        () => client.getOffer('11111111-1111-4111-8111-111111111111'),
        throwsA(
          isA<ApiProblemException>()
              .having((e) => e.problem.status, 'status', 404)
              .having((e) => e.problem.code, 'code', 'OFFER_NOT_FOUND'),
        ),
      );
    });
  });

  group('SEC-AUTH-001 / INT-IDEM-001 — Connexion, en-têtes et cookie de session', () {
    test('signIn envoie Origin + Idempotency-Key et mémorise client_session', () async {
      final capturedHeaders = <String, String>{};
      String? sentCookieOnGoals;

      final client = MoloPayApiClient(
        baseUrl: 'https://api.molopay.test',
        origin: 'https://app.molopay.test',
        httpClient: MockClient((request) async {
          if (request.url.path == '/v1/auth/sessions') {
            capturedHeaders.addAll(request.headers);
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
                'set-cookie': 'client_session=sess_opaque_value; Path=/; HttpOnly; SameSite=Strict',
              },
            );
          }
          if (request.url.path == '/v1/goals') {
            sentCookieOnGoals = request.headers['cookie'];
            return http.Response(
              jsonEncode({'goals': <Object>[], 'asOf': '2026-11-20T10:05:00Z'}),
              200,
              headers: {'content-type': 'application/json'},
            );
          }
          return http.Response('{}', 404);
        }),
      );

      final session = await client.signIn(phone: '+237670000001', pin: '123456');
      expect(session.displayName, 'Amina N.');
      expect(capturedHeaders['origin'], 'https://app.molopay.test');
      expect(capturedHeaders['idempotency-key'], isNotEmpty);
      expect(client.hasSession, isTrue);

      await client.listGoals();
      expect(sentCookieOnGoals, 'client_session=sess_opaque_value');
    });

    test('signIn refuse avec SERVICE_UNAVAILABLE sur 503 sans simuler de session', () async {
      final client = MoloPayApiClient(
        baseUrl: 'https://api.molopay.test',
        origin: 'https://app.molopay.test',
        httpClient: MockClient((_) async {
          return http.Response(
            jsonEncode({
              'type': 'https://molopay.cm/problems/service-unavailable',
              'title': 'Service indisponible',
              'status': 503,
              'code': 'SERVICE_UNAVAILABLE',
              'detail': 'Connexion client fermée en attente de configuration.',
            }),
            503,
            headers: {'content-type': 'application/problem+json'},
          );
        }),
      );

      await expectLater(
        () => client.signIn(phone: '+237670000001', pin: '123456'),
        throwsA(
          isA<ApiProblemException>()
              .having((e) => e.problem.status, 'status', 503)
              .having((e) => e.problem.code, 'code', 'SERVICE_UNAVAILABLE'),
        ),
      );
      expect(client.hasSession, isFalse);
    });

    test('erreur réseau renvoie NETWORK_UNAVAILABLE (hors connexion lisible)', () async {
      final client = MoloPayApiClient(
        baseUrl: 'https://api.molopay.test',
        origin: 'https://app.molopay.test',
        httpClient: MockClient((_) async {
          throw http.ClientException('SocketException: Network unreachable');
        }),
      );

      await expectLater(
        () => client.listOffers(),
        throwsA(
          isA<ApiProblemException>()
              .having((e) => e.problem.code, 'code', 'NETWORK_UNAVAILABLE')
              .having((e) => e.problem.isNetworkError, 'isNetworkError', isTrue),
        ),
      );
    });
  });

  group('F-GOA-001 / I-9 — Objectifs et versements confirmés', () {
    test('listGoals et listContributions parsent les montants XAF en BigInt', () async {
      final client = MoloPayApiClient(
        baseUrl: 'https://api.molopay.test',
        origin: 'https://app.molopay.test',
        httpClient: MockClient((request) async {
          if (request.url.path == '/v1/goals') {
            return http.Response(
              jsonEncode({
                'goals': [
                  {
                    'goalId': '33333333-3333-4333-8333-333333333333',
                    'model': 'SAVE_THEN_BUY',
                    'status': 'ACTIVE',
                    'locked': false,
                    'offerId': '11111111-1111-4111-8111-111111111111',
                    'offerTitle': 'Réfrigérateur 220L',
                    'partnerName': 'Électro Yaoundé',
                    'beneficiaryId': null,
                    'planId': 'plan-monthly-a',
                    'rhythm': 'MONTHLY',
                    'minAmountXaf': '10000',
                    'durationMonths': 6,
                    'targetXaf': '185000',
                    'savedXaf': '45000',
                    'progressBasisPoints': 2432,
                    'createdAt': '2026-11-01T08:00:00Z',
                    'updatedAt': '2026-11-19T09:00:00Z',
                  },
                ],
                'asOf': '2026-11-20T10:10:00Z',
              }),
              200,
              headers: {'content-type': 'application/json'},
            );
          }
          if (request.url.path ==
              '/v1/goals/33333333-3333-4333-8333-333333333333/contributions') {
            return http.Response(
              jsonEncode({
                'contributions': [
                  {
                    'contributionId': '44444444-4444-4444-8444-444444444444',
                    'amountXaf': '25000',
                    'status': 'CONFIRMED',
                    'confirmedAt': '2026-11-15T14:30:00Z',
                    'receiptNumber': 'RCP-2026-0001',
                  },
                ],
                'asOf': '2026-11-20T10:10:00Z',
              }),
              200,
              headers: {'content-type': 'application/json'},
            );
          }
          return http.Response('{}', 404);
        }),
      );

      final goals = await client.listGoals();
      expect(goals.goals, hasLength(1));
      expect(goals.goals.first.savedXaf, MoneyXaf.parse('45000'));
      expect(goals.goals.first.targetXaf, MoneyXaf.parse('185000'));

      final contributions = await client.listContributions(
        '33333333-3333-4333-8333-333333333333',
      );
      expect(contributions.contributions, hasLength(1));
      expect(contributions.contributions.first.amountXaf, MoneyXaf.parse('25000'));
      expect(contributions.contributions.first.receiptNumber, 'RCP-2026-0001');
    });

    test('listGoals refuse avec UNAUTHORIZED sur 401', () async {
      final client = MoloPayApiClient(
        baseUrl: 'https://api.molopay.test',
        origin: 'https://app.molopay.test',
        httpClient: MockClient((_) async {
          return http.Response(
            jsonEncode({
              'type': 'https://molopay.cm/problems/unauthorized',
              'title': 'Authentification requise',
              'status': 401,
              'code': 'UNAUTHORIZED',
            }),
            401,
            headers: {'content-type': 'application/problem+json'},
          );
        }),
      );

      await expectLater(
        () => client.listGoals(),
        throwsA(
          isA<ApiProblemException>()
              .having((e) => e.problem.status, 'status', 401)
              .having((e) => e.problem.code, 'code', 'UNAUTHORIZED'),
        ),
      );
    });
  });
}
