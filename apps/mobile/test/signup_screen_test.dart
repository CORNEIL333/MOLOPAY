import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:molopay_mobile/core/api_client.dart';
import 'package:molopay_mobile/core/app_state.dart';
import 'package:molopay_mobile/screens/signup_screen.dart';

void main() {
  testWidgets('Contrat 0.34.0 — SignupScreen affiche SERVICE_UNAVAILABLE sur 503 SMS sans simulation', (
    tester,
  ) async {
    final api = MoloPayApiClient(
      baseUrl: 'https://api.molopay.test',
      origin: 'https://app.molopay.test',
      httpClient: MockClient((_) async {
        return http.Response(
          jsonEncode({
            'type': 'https://molopay.cm/problems/service-unavailable',
            'title': 'Service SMS indisponible',
            'status': 503,
            'code': 'SERVICE_UNAVAILABLE',
          }),
          503,
        );
      }),
    );
    final state = AppState(api: api);

    await tester.pumpWidget(MaterialApp(home: SignupScreen(state: state)));
    await tester.enterText(
      find.byKey(const Key('signup-phone-field')),
      '+237690000000',
    );
    await tester.tap(find.byKey(const Key('signup-otp-button')));
    await tester.pumpAndSettle();

    expect(find.textContaining('SERVICE_UNAVAILABLE'), findsOneWidget);
  });

  testWidgets('Contrat 0.34.0 — SignupScreen enchaîne OTP puis inscription avec clé Ed25519', (
    tester,
  ) async {
    final api = MoloPayApiClient(
      baseUrl: 'https://api.molopay.test',
      origin: 'https://app.molopay.test',
      httpClient: MockClient((request) async {
        if (request.url.path == '/v1/auth/otp-challenges') {
          return http.Response(
            jsonEncode({
              'challengeId': '11111111-1111-4111-8111-111111111111',
              'expiresAt': '2026-11-20T12:05:00Z',
            }),
            201,
          );
        }
        if (request.url.path == '/v1/auth/signups') {
          return http.Response(
            jsonEncode({
              'accountId': '33333333-3333-4333-8333-333333333333',
              'deviceId': '22222222-2222-4222-8222-222222222222',
              'accessExpiresAt': '2026-11-20T12:15:00Z',
            }),
            201,
            headers: {'set-cookie': 'client_session=s_ok; Path=/; HttpOnly'},
          );
        }
        return http.Response('{}', 404);
      }),
    );
    final state = AppState(api: api);

    await tester.pumpWidget(
      MaterialApp(
        home: SignupScreen(
          state: state,
          provideDevicePublicKey: () async => 'MCowBQYDK2VwAyEAtestkey',
        ),
      ),
    );
    await tester.enterText(
      find.byKey(const Key('signup-phone-field')),
      '+237690000000',
    );
    await tester.tap(find.byKey(const Key('signup-otp-button')));
    await tester.pumpAndSettle();

    await tester.enterText(
      find.byKey(const Key('signup-code-field')),
      '482910',
    );
    await tester.enterText(
      find.byKey(const Key('signup-pin-field')),
      '739154',
    );
    await tester.tap(find.byKey(const Key('signup-terms-checkbox')));
    await tester.tap(find.byKey(const Key('signup-submit-button')));
    await tester.pumpAndSettle();

    expect(find.textContaining('22222222-2222-4222-8222-222222222222'), findsOneWidget);
  });
}
