import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:molopay_mobile/core/api_client.dart';
import 'package:molopay_mobile/core/device_key.dart';
import 'package:molopay_mobile/core/models.dart';

/// Doublure de test du stockage sécurisé de la plateforme (Keystore / Secure
/// Enclave) : identifiant et signature fixes, messages enregistrés. Le serveur
/// de ces tests est lui-même une doublure ; la vérification Ed25519 réelle est
/// couverte côté serveur (tests de base de données et d'attaque).
const String testDeviceId = '019ab900-0000-7000-8000-0000000000d1';
const String testChallengeId = '019ab900-0000-7000-8000-0000000000c9';
final String testChallenge = base64Url
    .encode(List<int>.filled(32, 7))
    .replaceAll('=', '');
final String testSignature = base64.encode(List<int>.filled(64, 1));

class FakeDeviceKey implements DeviceKey {
  final List<Uint8List> signed = <Uint8List>[];

  @override
  String get deviceId => testDeviceId;

  @override
  Future<String> sign(Uint8List message) async {
    signed.add(message);
    return testSignature;
  }
}

class FakeDeviceKeyProvider implements DeviceKeyProvider {
  FakeDeviceKeyProvider({this.key});

  /// Appareil déjà enrôlé (ou `null`).
  FakeDeviceKey? key;
  String? boundDeviceId;

  @override
  Future<DeviceKey?> enrolled() async => key;

  @override
  Future<String> createPublicKey() async =>
      base64.encode(List<int>.filled(44, 3));

  @override
  Future<void> bind(String deviceId) async {
    boundDeviceId = deviceId;
    key = FakeDeviceKey();
  }
}

/// Réponse de la doublure serveur au défi de connexion (contrat 0.35.0).
http.Response deviceChallengeResponse() => http.Response(
  jsonEncode({
    'challengeId': testChallengeId,
    'challenge': testChallenge,
    'expiresAt': '2026-11-20T12:02:00Z',
  }),
  201,
  headers: {'content-type': 'application/json'},
);

/// Corps de session du contrat 0.35.0 (`POST /v1/auth/sessions`).
String sessionBody() => jsonEncode({
  'accountId': '22222222-2222-4222-8222-222222222222',
  'accessExpiresAt': '2026-11-20T12:00:00Z',
});

/// Connexion D71 au niveau du client HTTP : défi, signature, PIN.
Future<ClientLoginResult> signInForTest(
  MoloPayApiClient client, {
  String pin = '123456',
}) async {
  final challenge = await client.requestDeviceChallenge(deviceId: testDeviceId);
  final message = deviceChallengeMessage(
    DeviceChallengePurpose.login,
    challenge.challengeId,
    testDeviceId,
    challenge.challenge,
  );
  return client.signInWithDevice(
    challengeId: challenge.challengeId,
    deviceId: testDeviceId,
    signature: await FakeDeviceKey().sign(message),
    pin: pin,
  );
}
