import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:molopay_mobile/core/api_client.dart';
import 'package:molopay_mobile/core/app_state.dart';
import 'package:molopay_mobile/screens/profile_screen.dart';

void main() {
  testWidgets('C2 / D77 — ProfileScreen affiche GET /v1/me sans niveau KYC', (
    tester,
  ) async {
    final api = MoloPayApiClient(
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
              'content-type': 'application/json; charset=utf-8',
              'set-cookie': 'client_session=s_ok; Path=/; HttpOnly',
            },
          );
        }
        if (request.url.path == '/v1/me') {
          return http.Response(
            jsonEncode({
              'accountId': '22222222-2222-4222-8222-222222222222',
              'phoneMasked': '+237•••••••34',
              'memberSince': '2026-10-26',
              'legalNameDeclared': true,
            }),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }
        return http.Response('{}', 404);
      }),
    );
    final state = AppState(api: api);
    await state.signIn(phone: '+237670000034', pin: '123456');

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
  });
}
