import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:molopay_mobile/core/api_client.dart';
import 'package:molopay_mobile/core/problem.dart';

void main() {
  group('Contrat 0.34.0 / D71 / SEC-AUTH-001 — Inscription OTP et connexion appareil + PIN', () {
    test('buildClientLoginSigningBytes construit le préfixe UTF-8 exact suivi des 32 octets du défi', () {
      final rawChallenge = List<int>.generate(32, (i) => i + 1);
      final encoded = base64UrlEncode(rawChallenge).replaceAll('=', '');
      final bytes = MoloPayApiClient.buildClientLoginSigningBytes(
        challengeId: '11111111-1111-4111-8111-111111111111',
        deviceId: '22222222-2222-4222-8222-222222222222',
        challengeBase64Url: encoded,
      );

      final expectedPrefix = utf8.encode(
        'molopay.client-login.v1\u0000'
        '11111111-1111-4111-8111-111111111111\u0000'
        '22222222-2222-4222-8222-222222222222\u0000',
      );
      expect(bytes.length, expectedPrefix.length + 32);
      expect(bytes.sublist(0, expectedPrefix.length), expectedPrefix);
      expect(bytes.sublist(expectedPrefix.length), rawChallenge);
    });

    test('requestOtpChallenge → signUp puis requestDeviceChallenge → signInWithDevice', () async {
      final client = MoloPayApiClient(
        baseUrl: 'https://api.molopay.test',
        origin: 'https://app.molopay.test',
        httpClient: MockClient((request) async {
          expect(request.headers['origin'], 'https://app.molopay.test');
          expect(request.headers['idempotency-key'], isNotEmpty);

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
              headers: {
                'set-cookie':
                    'client_session=s1; Path=/; HttpOnly, client_refresh=r1; Path=/v1/auth; HttpOnly',
              },
            );
          }
          if (request.url.path == '/v1/auth/device-challenges') {
            return http.Response(
              jsonEncode({
                'challengeId': '44444444-4444-4444-8444-444444444444',
                'challenge': base64UrlEncode(List<int>.filled(32, 7)).replaceAll('=', ''),
                'expiresAt': '2026-11-20T12:02:00Z',
              }),
              201,
            );
          }
          if (request.url.path == '/v1/auth/sessions') {
            final body = jsonDecode(request.body) as Map<String, Object?>;
            expect(body['challengeId'], '44444444-4444-4444-8444-444444444444');
            expect(body['deviceId'], '22222222-2222-4222-8222-222222222222');
            return http.Response(
              jsonEncode({
                'accountId': '33333333-3333-4333-8333-333333333333',
                'accessExpiresAt': '2026-11-20T12:30:00Z',
              }),
              201,
              headers: {'set-cookie': 'client_session=s2; Path=/; HttpOnly'},
            );
          }
          return http.Response('{}', 404);
        }),
      );

      final otp = await client.requestOtpChallenge(phone: '+237690000000');
      expect(otp.challengeId, '11111111-1111-4111-8111-111111111111');

      final signup = await client.signUp(
        challengeId: otp.challengeId,
        code: '482910',
        pin: '739154',
        devicePublicKey: 'MCowBQYDK2VwAyEAtestkey',
        deviceName: 'Pixel Test',
        acceptTermsVersion: '2026-10-26-v1',
      );
      expect(signup.deviceId, '22222222-2222-4222-8222-222222222222');
      expect(client.hasSession, isTrue);
      expect(client.hasRefreshToken, isTrue);

      final challenge = await client.requestDeviceChallenge(
        deviceId: signup.deviceId,
      );
      final login = await client.signInWithDevice(
        challengeId: challenge.challengeId,
        deviceId: signup.deviceId,
        signature: base64Encode(List<int>.filled(64, 1)),
        pin: '739154',
      );
      expect(login.accountId, '33333333-3333-4333-8333-333333333333');
    });

    test('signUp refuse IDENTITY_PIN_WEAK sur 422', () async {
      final client = MoloPayApiClient(
        baseUrl: 'https://api.molopay.test',
        origin: 'https://app.molopay.test',
        httpClient: MockClient((_) async {
          return http.Response(
            jsonEncode({
              'type': 'https://molopay.cm/problems/pin-weak',
              'title': 'PIN trop faible',
              'status': 422,
              'code': 'IDENTITY_PIN_WEAK',
            }),
            422,
          );
        }),
      );

      await expectLater(
        () => client.signUp(
          challengeId: '11111111-1111-4111-8111-111111111111',
          code: '482910',
          pin: '123456',
          devicePublicKey: 'MCowBQYDK2VwAyEAtestkey',
          deviceName: 'Pixel Test',
          acceptTermsVersion: '2026-10-26-v1',
        ),
        throwsA(
          isA<ApiProblemException>()
              .having((e) => e.problem.status, 'status', 422)
              .having((e) => e.problem.code, 'code', 'IDENTITY_PIN_WEAK'),
        ),
      );
    });
  });
}
