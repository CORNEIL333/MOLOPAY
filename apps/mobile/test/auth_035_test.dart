import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:molopay_mobile/core/api_client.dart';
import 'package:molopay_mobile/core/models.dart';
import 'package:molopay_mobile/core/problem.dart';

void main() {
  group('Contrat 0.35.0 / SEC-AUTH-005 — Renouvellement lié à l’appareil (défi REFRESH)', () {
    test('buildDeviceChallengeSigningBytes sépare les domaines LOGIN et REFRESH', () {
      final raw = List<int>.generate(32, (i) => i);
      final encoded = base64UrlEncode(raw).replaceAll('=', '');
      final loginBytes = MoloPayApiClient.buildDeviceChallengeSigningBytes(
        purpose: DeviceChallengePurpose.login,
        challengeId: '11111111-1111-4111-8111-111111111111',
        deviceId: '22222222-2222-4222-8222-222222222222',
        challengeBase64Url: encoded,
      );
      final refreshBytes = MoloPayApiClient.buildDeviceChallengeSigningBytes(
        purpose: DeviceChallengePurpose.refresh,
        challengeId: '11111111-1111-4111-8111-111111111111',
        deviceId: '22222222-2222-4222-8222-222222222222',
        challengeBase64Url: encoded,
      );

      expect(loginBytes, isNot(equals(refreshBytes)));
      expect(
        utf8.decode(refreshBytes.sublist(0, 'molopay.client-refresh.v1'.length)),
        'molopay.client-refresh.v1',
      );
    });

    test('requestDeviceChallenge(REFRESH) → refreshSession envoie challengeId + signature + cookie', () async {
      String? sentPurpose;
      Map<String, Object?>? sentRefreshBody;
      String? sentCookie;

      final client = MoloPayApiClient(
        baseUrl: 'https://api.molopay.test',
        origin: 'https://app.molopay.test',
        httpClient: MockClient((request) async {
          if (request.url.path == '/v1/auth/sessions') {
            return http.Response(
              jsonEncode({
                'accountId': '33333333-3333-4333-8333-333333333333',
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
            final body = jsonDecode(request.body) as Map<String, Object?>;
            sentPurpose = body['purpose'] as String?;
            return http.Response(
              jsonEncode({
                'challengeId': '55555555-5555-4555-8555-555555555555',
                'challenge': base64UrlEncode(List<int>.filled(32, 9)).replaceAll('=', ''),
                'expiresAt': '2026-11-20T12:17:00Z',
              }),
              201,
            );
          }
          if (request.url.path == '/v1/auth/session-refreshes') {
            sentCookie = request.headers['cookie'];
            sentRefreshBody = jsonDecode(request.body) as Map<String, Object?>;
            return http.Response(
              jsonEncode({'accessExpiresAt': '2026-11-20T12:45:00Z'}),
              201,
              headers: {
                'set-cookie':
                    'client_session=s2; Path=/; HttpOnly, client_refresh=r2; Path=/v1/auth; HttpOnly',
              },
            );
          }
          return http.Response('{}', 404);
        }),
      );

      await client.signInWithDevice(
        challengeId: '44444444-4444-4444-8444-444444444444',
        deviceId: '22222222-2222-4222-8222-222222222222',
        signature: base64Encode(List<int>.filled(64, 1)),
        pin: '739154',
      );

      final challenge = await client.requestDeviceChallenge(
        deviceId: '22222222-2222-4222-8222-222222222222',
        purpose: DeviceChallengePurpose.refresh,
      );
      expect(sentPurpose, 'REFRESH');

      final refreshed = await client.refreshSession(
        challengeId: challenge.challengeId,
        signature: base64Encode(List<int>.filled(64, 2)),
      );
      expect(sentCookie, 'client_refresh=r1');
      expect(sentRefreshBody?['challengeId'], '55555555-5555-4555-8555-555555555555');
      expect(sentRefreshBody?['signature'], isNotEmpty);
      expect(refreshed.accessExpiresAt, DateTime.utc(2026, 11, 20, 12, 45));
    });

    test('refreshSession refuse UNAUTHORIZED sur 401 (vol présumé / ancien jeton)', () async {
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
        () => client.refreshSession(
          challengeId: '55555555-5555-4555-8555-555555555555',
          signature: base64Encode(List<int>.filled(64, 2)),
        ),
        throwsA(
          isA<ApiProblemException>()
              .having((e) => e.problem.status, 'status', 401)
              .having((e) => e.problem.code, 'code', 'UNAUTHORIZED'),
        ),
      );
    });
  });
}
