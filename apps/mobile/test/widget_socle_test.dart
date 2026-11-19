import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:molopay_mobile/app.dart';
import 'package:molopay_mobile/core/api_client.dart';

MoloPayApiClient _buildMockApi({
  bool loginUnavailable = false,
  bool offline = false,
}) {
  return MoloPayApiClient(
    baseUrl: 'https://api.molopay.test',
    origin: 'https://app.molopay.test',
    httpClient: MockClient((request) async {
      if (offline) {
        throw http.ClientException('Offline');
      }
      if (request.url.path == '/health') {
        return http.Response(jsonEncode({'status': 'ok'}), 200);
      }
      if (request.url.path == '/v1/offers') {
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
                'cities': ['yaounde'],
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
      }
      if (request.url.path == '/v1/plans') {
        return http.Response(
          jsonEncode({
            'plans': [
              {
                'planId': 'plan-monthly-a',
                'model': 'SAVE_THEN_BUY',
                'rhythm': 'MONTHLY',
                'minAmountXaf': '10000',
                'maxDurationMonths': 12,
              },
            ],
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      }
      if (request.url.path == '/v1/auth/sessions') {
        if (loginUnavailable) {
          return http.Response(
            jsonEncode({
              'type': 'https://molopay.cm/problems/service-unavailable',
              'title': 'Connexion indisponible',
              'status': 503,
              'code': 'SERVICE_UNAVAILABLE',
              'detail': 'Route de connexion fermée en attente de D71.',
            }),
            503,
            headers: {'content-type': 'application/problem+json'},
          );
        }
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
            'set-cookie': 'client_session=sess_ok; Path=/; HttpOnly',
          },
        );
      }
      if (request.url.path == '/v1/goals') {
        if (request.headers['cookie'] == null) {
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
        }
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
}

void main() {
  testWidgets('F-CAT-001 — Catalogue charge les offres réelles et affiche le détail', (
    tester,
  ) async {
    await tester.pumpWidget(MoloPayApp(apiClient: _buildMockApi()));
    await tester.pumpAndSettle();

    expect(find.text('molopay'), findsOneWidget);
    expect(find.text('MAQUETTE'), findsNothing);

    await tester.tap(find.text('Explorer'));
    await tester.pumpAndSettle();

    expect(find.text('Réfrigérateur 220L'), findsOneWidget);
    expect(find.textContaining('185'), findsWidgets);

    await tester.tap(find.text('Réfrigérateur 220L'));
    await tester.pumpAndSettle();

    expect(find.text('Électro Yaoundé'), findsWidgets);
    expect(find.text('12 mois'), findsOneWidget);
  });

  testWidgets('SEC-AUTH-001 — Connexion affiche indisponible sur 503 sans simulation', (
    tester,
  ) async {
    await tester.pumpWidget(
      MoloPayApp(apiClient: _buildMockApi(loginUnavailable: true)),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Projets'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Se connecter'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('login-phone-field')), '+237670000001');
    await tester.enterText(find.byKey(const Key('login-pin-field')), '123456');
    await tester.tap(find.byKey(const Key('login-submit-button')));
    await tester.pumpAndSettle();

    expect(find.textContaining('SERVICE_UNAVAILABLE'), findsOneWidget);
  });

  testWidgets('F-GOA-001 — Connexion puis liste des objectifs et versements confirmés', (
    tester,
  ) async {
    await tester.pumpWidget(MoloPayApp(apiClient: _buildMockApi()));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Projets'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Se connecter'));
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(const Key('login-phone-field')), '+237670000001');
    await tester.enterText(find.byKey(const Key('login-pin-field')), '123456');
    await tester.tap(find.byKey(const Key('login-submit-button')));
    await tester.pumpAndSettle();

    expect(find.text('Réfrigérateur 220L'), findsOneWidget);

    await tester.tap(find.text('Réfrigérateur 220L'));
    await tester.pumpAndSettle();

    expect(find.text('RCP-2026-0001'), findsOneWidget);
  });

  testWidgets('NF-OFFLINE / I18N — État hors connexion lisible et bascule FR/EN', (
    tester,
  ) async {
    await tester.pumpWidget(MoloPayApp(apiClient: _buildMockApi(offline: true)));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Explorer'));
    await tester.pumpAndSettle();

    expect(find.textContaining('NETWORK_UNAVAILABLE'), findsOneWidget);

    await tester.tap(find.text('Profil'));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('locale-toggle-en')));
    await tester.pumpAndSettle();

    expect(find.text('Profile'), findsWidgets);
  });
}
