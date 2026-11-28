import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:molopay_mobile/core/api_client.dart';
import 'package:molopay_mobile/core/problem.dart';

void main() {
  test('SEC-MOB-005 — version déclarée égale à celle de pubspec.yaml', () {
    final pubspec = File('pubspec.yaml').readAsStringSync();
    final version = RegExp(
      r'^version: ([0-9]+\.[0-9]+\.[0-9]+)',
      multiLine: true,
    ).firstMatch(pubspec)?.group(1);
    expect(MoloPayApiClient.appVersion, version);
    expect(MoloPayApiClient.clientVersionHeader, 'mobile/$version');
  });

  test('SEC-MOB-005 — chaque requête déclare la version ; 426 reconnu comme mise à jour requise', () async {
    final headers = <String?>[];
    final client = MoloPayApiClient(
      baseUrl: 'https://api.molopay.test',
      origin: 'https://app.molopay.test',
      httpClient: MockClient((request) async {
        headers.add(request.headers['x-client-version']);
        return http.Response.bytes(
          utf8.encode(
            jsonEncode({
              'type': 'urn:achat:problem:client-upgrade-required',
              'title': 'Mise à jour de l’application requise',
              'status': 426,
              'code': 'CLIENT_UPGRADE_REQUIRED',
            }),
          ),
          426,
          headers: {'content-type': 'application/problem+json; charset=utf-8'},
        );
      }),
    );
    await expectLater(
      client.listOffers(),
      throwsA(
        isA<ApiProblemException>().having(
          (e) => e.problem.isUpgradeRequired,
          'isUpgradeRequired',
          isTrue,
        ),
      ),
    );
    expect(headers, ['mobile/${MoloPayApiClient.appVersion}']);
  });

  test('SEC-MOB-005 — 426 sans corps problème reste reconnu', () {
    final problem = ApiProblem.fromHttpStatus(426);
    expect(problem.code, 'CLIENT_UPGRADE_REQUIRED');
    expect(problem.isUpgradeRequired, isTrue);
  });
}
