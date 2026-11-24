import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:molopay_mobile/core/api_client.dart';
import 'package:molopay_mobile/core/app_state.dart';
import 'package:molopay_mobile/screens/profile_screen.dart';

import 'support/fake_device_keys.dart';

void main() {
  testWidgets('C2 / D77 — ProfileScreen affiche GET /v1/me sans niveau KYC', (
    tester,
  ) async {
    var accepted = false;
    String? acceptedVersion;
    final api = MoloPayApiClient(
      baseUrl: 'https://api.molopay.test',
      origin: 'https://app.molopay.test',
      httpClient: MockClient((request) async {
        if (request.url.path == '/v1/auth/device-challenges') {
          return deviceChallengeResponse();
        }
        if (request.url.path == '/v1/auth/sessions') {
          return http.Response(
            sessionBody(),
            201,
            headers: {
              'content-type': 'application/json; charset=utf-8',
              'set-cookie': 'client_session=s_ok; Path=/; HttpOnly',
            },
          );
        }
        if (request.url.path == '/v1/me/terms-acceptances') {
          acceptedVersion =
              (jsonDecode(request.body) as Map<String, Object?>)['version']
                  as String?;
          accepted = true;
          return http.Response(
            jsonEncode({
              'version': '2026-10-26-v1',
              'acceptedAt': '2026-11-24T10:00:00Z',
            }),
            201,
          );
        }
        if (request.url.path == '/v1/me') {
          return http.Response(
            jsonEncode({
              'accountId': '22222222-2222-4222-8222-222222222222',
              'phoneMasked': '+237•••••••34',
              'memberSince': '2026-10-26',
              'legalNameDeclared': true,
              'currentTermsVersion': '2026-10-26-v1',
              'termsAccepted': accepted,
            }),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }
        return http.Response('{}', 404);
      }),
    );
    final state = AppState(
      api: api,
      deviceKeys: FakeDeviceKeyProvider(key: FakeDeviceKey()),
    );
    await state.signInWithDevice(pin: '123456');

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: ProfileScreen(state: state, onOpenLogin: () {}),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.textContaining('+237•••••••34'), findsOneWidget);
    expect(find.text('Nom légal déclaré'), findsOneWidget);
    expect(find.textContaining('BASIC'), findsNothing);
    expect(find.textContaining('SANCTIONS'), findsNothing);

    // F-ACC-004 : conditions en vigueur non acceptées → invitation, acceptation, profil relu.
    expect(find.byKey(const Key('profile-terms-notice')), findsOneWidget);
    await tester.ensureVisible(find.byKey(const Key('profile-terms-accept')));
    await tester.tap(find.byKey(const Key('profile-terms-accept')));
    await tester.pumpAndSettle();
    expect(acceptedVersion, '2026-10-26-v1');
    expect(find.byKey(const Key('profile-terms-notice')), findsNothing);
  });
}
