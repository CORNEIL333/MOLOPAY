import 'dart:convert';
import 'dart:typed_data';

import 'models.dart';

/// Clé d'appareil enrôlée (D71 / SEC-AUTH-001) : identifiant rendu par le
/// serveur à l'inscription et signature des défis par la clé privée, qui ne
/// quitte jamais le stockage sécurisé de la plateforme (SEC-MOB-002).
abstract interface class DeviceKey {
  String get deviceId;

  /// Signature Ed25519 (64 octets) du message, en base64 standard.
  Future<String> sign(Uint8List message);
}

/// Fournisseur de clé d'appareil (Keystore / Secure Enclave). Tant qu'aucune
/// implémentation de plateforme n'est branchée (D90), l'application n'en a pas
/// et l'affiche honnêtement : ni inscription ni connexion, aucune simulation.
abstract interface class DeviceKeyProvider {
  /// Clé enrôlée sur cet appareil, ou `null`.
  Future<DeviceKey?> enrolled();

  /// Crée une nouvelle paire et renvoie la clé publique SPKI DER en base64.
  Future<String> createPublicKey();

  /// Associe la clé créée à l'identifiant d'appareil rendu par le serveur.
  Future<void> bind(String deviceId);
}

/// Message signé (contrat 0.35.0) : UTF-8 de
/// `<contexte>\0<challengeId>\0<deviceId>\0` suivi des 32 octets du défi (base64url).
Uint8List deviceChallengeMessage(
  DeviceChallengePurpose purpose,
  String challengeId,
  String deviceId,
  String challengeBase64Url,
) {
  final prefix = utf8.encode(
    '${purpose.signingContext}\u0000$challengeId\u0000$deviceId\u0000',
  );
  final challenge = base64Url.decode(base64Url.normalize(challengeBase64Url));
  if (challenge.length != 32) {
    throw const FormatException('Défi de 32 octets attendu.');
  }
  return Uint8List.fromList([...prefix, ...challenge]);
}
