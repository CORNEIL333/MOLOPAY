import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:molopay_mobile/core/api_client.dart';
import 'package:molopay_mobile/core/app_state.dart';
import 'package:molopay_mobile/core/problem.dart';
import 'package:molopay_mobile/screens/notifications_screen.dart';

void main() {
  test('F-NOT-001 / Contrat 0.37.0 — listNotifications pagine avec before et refuse 401', () async {
    final uris = <Uri>[];
    final client = MoloPayApiClient(
      baseUrl: 'https://api.molopay.test',
      origin: 'https://app.molopay.test',
      httpClient: MockClient((request) async {
        uris.add(request.url);
        if (request.url.queryParameters['before'] == '11111111-1111-4111-8111-111111111111') {
          return http.Response(
            jsonEncode({
              'type': 'about:blank',
              'title': 'Authentification requise',
              'status': 401,
              'code': 'UNAUTHORIZED',
            }),
            401,
          );
        }
        return http.Response(
          jsonEncode({
            'items': [
              {
                'notificationId': '11111111-1111-4111-8111-111111111111',
                'eventType': 'PAYMENT_CONFIRMED',
                'createdAt': '2026-11-20T10:00:00Z',
                'title': 'Versement confirmé',
                'body': 'Votre versement a bien été enregistré.',
              },
            ],
            'nextBefore': '11111111-1111-4111-8111-111111111111',
            'asOf': '2026-11-20T10:05:00Z',
          }),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }),
    );

    final feed = await client.listNotifications();
    expect(feed.items, hasLength(1));
    expect(feed.items.first.eventType, 'PAYMENT_CONFIRMED');
    expect(feed.nextBefore, '11111111-1111-4111-8111-111111111111');

    await expectLater(
      () => client.listNotifications(before: feed.nextBefore),
      throwsA(
        isA<ApiProblemException>()
            .having((e) => e.problem.status, 'status', 401)
            .having((e) => e.problem.code, 'code', 'UNAUTHORIZED'),
      ),
    );
    expect(uris.last.queryParameters['before'], '11111111-1111-4111-8111-111111111111');
  });

  testWidgets('F-NOT-001 — NotificationsScreen affiche le fil et charge la page suivante', (
    tester,
  ) async {
    final api = MoloPayApiClient(
      baseUrl: 'https://api.molopay.test',
      origin: 'https://app.molopay.test',
      httpClient: MockClient((request) async {
        if (request.url.queryParameters['before'] == '11111111-1111-4111-8111-111111111111') {
          return http.Response(
            jsonEncode({
              'items': [
                {
                  'notificationId': '22222222-2222-4222-8222-222222222222',
                  'eventType': 'GOAL_FUNDED',
                  'createdAt': '2026-11-19T10:00:00Z',
                  'title': 'Objectif atteint',
                  'body': 'Votre objectif est financé à 100 %.',
                },
              ],
              'nextBefore': null,
              'asOf': '2026-11-20T10:06:00Z',
            }),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }
        return http.Response(
          jsonEncode({
            'items': [
              {
                'notificationId': '11111111-1111-4111-8111-111111111111',
                'eventType': 'PAYMENT_CONFIRMED',
                'createdAt': '2026-11-20T10:00:00Z',
                'title': 'Versement confirmé',
                'body': 'Votre versement a bien été enregistré.',
              },
            ],
            'nextBefore': '11111111-1111-4111-8111-111111111111',
            'asOf': '2026-11-20T10:05:00Z',
          }),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }),
    );
    final state = AppState(api: api);

    await tester.pumpWidget(MaterialApp(home: NotificationsScreen(state: state)));
    await tester.pumpAndSettle();

    expect(find.text('Versement confirmé'), findsOneWidget);
    await tester.tap(find.byKey(const Key('notifications-load-more')));
    await tester.pumpAndSettle();

    expect(find.text('Objectif atteint'), findsOneWidget);
    expect(find.byKey(const Key('notifications-load-more')), findsNothing);
  });
}
