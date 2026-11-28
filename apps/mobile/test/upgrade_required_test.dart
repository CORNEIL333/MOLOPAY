import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:molopay_mobile/app.dart';
import 'package:molopay_mobile/core/api_client.dart';
import 'package:molopay_mobile/core/app_state.dart';
import 'package:molopay_mobile/core/problem.dart';

http.Response _upgrade() => http.Response.bytes(
  utf8.encode(
    jsonEncode({
      'type': 'urn:achat:problem:client-upgrade-required',
      'title': 'Mise à jour requise',
      'status': 426,
      'code': 'CLIENT_UPGRADE_REQUIRED',
    }),
  ),
  426,
  headers: {'content-type': 'application/problem+json; charset=utf-8'},
);

void main() {
  test('SEC-MOB-005 — un 426 marque l’état « mise à jour requise » et efface la session', () async {
    final api = MoloPayApiClient(
      baseUrl: 'https://api.molopay.test',
      origin: 'https://app.molopay.test',
      httpClient: MockClient((request) async {
        if (request.url.path == '/v1/auth/sessions') {
          return http.Response(
            jsonEncode({
              'accountId': '33333333-3333-4333-8333-333333333333',
              'accessExpiresAt': '2026-11-20T12:30:00Z',
            }),
            201,
            headers: {'set-cookie': 'client_session=s2; Path=/; HttpOnly'},
          );
        }
        return _upgrade();
      }),
    );
    final state = AppState(api: api);
    await api.signInWithDevice(
      challengeId: '44444444-4444-4444-8444-444444444444',
      deviceId: '22222222-2222-4222-8222-222222222222',
      signature: base64Encode(List<int>.filled(64, 1)),
      pin: '739154',
    );
    expect(api.hasSession, isTrue);
    var notified = 0;
    state.addListener(() => notified++);
    expect(state.upgradeRequired, isFalse);
    await expectLater(api.listOffers(), throwsA(isA<ApiProblemException>()));
    expect(state.upgradeRequired, isTrue);
    expect(api.hasSession, isFalse);
    expect(notified, 1);
    await expectLater(api.listOffers(), throwsA(isA<ApiProblemException>()));
    expect(notified, 1, reason: 'notifié une seule fois');
  });

  test('SEC-MOB-005 — refuse : une autre erreur (409, 503) ne déclenche pas l’écran', () async {
    var status = 409;
    final api = MoloPayApiClient(
      baseUrl: 'https://api.molopay.test',
      origin: 'https://app.molopay.test',
      httpClient: MockClient(
        (_) async => http.Response(
          '{"status":$status,"title":"x","code":"CONFLICT"}',
          status,
        ),
      ),
    );
    final state = AppState(api: api);
    await expectLater(api.listOffers(), throwsA(isA<ApiProblemException>()));
    status = 503;
    await expectLater(api.listOffers(), throwsA(isA<ApiProblemException>()));
    expect(state.upgradeRequired, isFalse);
  });

  testWidgets(
    'SEC-MOB-005 — l’application entière est remplacée par l’écran de mise à jour',
    (tester) async {
      final api = MoloPayApiClient(
        baseUrl: 'https://api.molopay.test',
        origin: 'https://app.molopay.test',
        httpClient: MockClient((request) async {
          if (request.url.path == '/health') {
            return http.Response('{"status":"ok"}', 200);
          }
          return _upgrade();
        }),
      );
      await tester.pumpWidget(MoloPayApp(apiClient: api));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('upgrade-required-screen')), findsNothing);
      await tester.tap(find.text('Explorer'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('upgrade-required-screen')), findsOneWidget);
      expect(find.text('Explorer'), findsNothing);
      expect(find.textContaining(MoloPayApiClient.appVersion), findsOneWidget);
    },
  );
}
