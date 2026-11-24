import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:molopay_mobile/core/api_client.dart';
import 'package:molopay_mobile/core/problem.dart';

import 'support/fake_device_keys.dart';

void main() {
  test('G6 — Transport HTTP TCP réel (loopback) : health, session, cookie, GET /v1/me, signout, 401', () async {
    await HttpOverrides.runZoned(() async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(() async => server.close(force: true));

      server.listen((request) async {
        final path = request.uri.path;
        request.response.headers.contentType = ContentType.json;
        if (path == '/health') {
          request.response
            ..statusCode = 200
            ..write(jsonEncode({'status': 'ok'}));
        } else if (path == '/v1/auth/device-challenges' &&
            request.method == 'POST') {
          request.response
            ..statusCode = 201
            ..write(
              jsonEncode({
                'challengeId': testChallengeId,
                'challenge': testChallenge,
                'expiresAt': '2026-11-20T12:02:00Z',
              }),
            );
        } else if (path == '/v1/auth/sessions' && request.method == 'POST') {
          final sent = jsonDecode(
            await utf8.decodeStream(request),
          ) as Map<String, Object?>;
          expect(sent.keys.toSet(), {
            'challengeId',
            'deviceId',
            'signature',
            'pin',
          });
          expect(request.headers.value('origin'), 'http://127.0.0.1');
          expect(request.headers.value('idempotency-key'), isNotEmpty);
          request.response.headers.add(
            'set-cookie',
            'client_session=tcp_cookie_123; Path=/; HttpOnly',
          );
          request.response
            ..statusCode = 201
            ..write(sessionBody());
        } else if (path == '/v1/me') {
          final cookie = request.headers.value('cookie') ?? '';
          if (!cookie.contains('client_session=tcp_cookie_123')) {
            request.response
              ..statusCode = 401
              ..write(
                jsonEncode({
                  'type': 'about:blank',
                  'title': 'Unauthorized',
                  'status': 401,
                  'code': 'UNAUTHORIZED',
                }),
              );
          } else {
            request.response
              ..statusCode = 200
              ..write(
                jsonEncode({
                  'accountId': '22222222-2222-4222-8222-222222222222',
                  'phoneMasked': '+2376•••••••34',
                  'memberSince': '2026-10-26',
                  'legalNameDeclared': false,
                  'currentTermsVersion': '2026-10-26-v1',
                  'termsAccepted': true,
                }),
              );
          }
        } else if (path == '/v1/auth/signouts' && request.method == 'POST') {
          request.response.statusCode = 204;
        } else {
          request.response.statusCode = 404;
        }
        await request.response.close();
      });

      final client = MoloPayApiClient(
        baseUrl: 'http://127.0.0.1:${server.port}',
        origin: 'http://127.0.0.1',
      );
      addTearDown(client.dispose);

      expect(await client.checkHealth(), isTrue);
      final session = await signInForTest(client);
      expect(session.accountId, '22222222-2222-4222-8222-222222222222');

      final me = await client.getCurrentAccount();
      expect(me.phoneMasked, '+2376•••••••34');

      await client.signOut();
      expect(client.hasSession, isFalse);

      await expectLater(
        () => client.getCurrentAccount(),
        throwsA(
          isA<ApiProblemException>()
              .having((e) => e.problem.status, 'status', 401)
              .having((e) => e.problem.code, 'code', 'UNAUTHORIZED'),
        ),
      );
    });
  });
}
