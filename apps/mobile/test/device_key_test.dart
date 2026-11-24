import 'package:flutter_test/flutter_test.dart';
import 'package:molopay_mobile/core/device_key.dart';
import 'package:molopay_mobile/core/models.dart';

import 'support/fake_device_keys.dart';

String _hex(List<int> bytes) =>
    bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();

void main() {
  test('D71 / SEC-AUTH-005 — message signé identique, octet pour octet, à celui que le serveur vérifie', () {
    // Vecteur calculé par challengeMessage() du serveur (REFRESH, défi de 32 octets 0x07).
    const expected =
        '6d6f6c6f7061792e636c69656e742d726566726573682e76310030313961623930302d303030302d373030302d383030302d3030303030303030303063390030313961623930302d303030302d373030302d383030302d303030303030303030306431000707070707070707070707070707070707070707070707070707070707070707';
    final message = deviceChallengeMessage(
      DeviceChallengePurpose.refresh,
      testChallengeId,
      testDeviceId,
      testChallenge,
    );
    expect(_hex(message), expected);
  });

  test('défi de longueur inattendue refusé (aucune signature)', () {
    expect(
      () => deviceChallengeMessage(
        DeviceChallengePurpose.login,
        testChallengeId,
        testDeviceId,
        'AAAA',
      ),
      throwsFormatException,
    );
  });
}
