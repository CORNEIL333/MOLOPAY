import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../core/api_client.dart';
import '../l10n/strings.dart';
import '../ui/design.dart';

/// SEC-MOB-005 : version refusée par le serveur (426). Aucune autre action
/// n'est proposée ; aucun lien de boutique tant que l'application n'y est pas
/// publiée (pas d'adresse inventée).
class UpgradeRequiredScreen extends StatelessWidget {
  const UpgradeRequiredScreen({super.key, required this.strings});

  final AppStrings strings;

  @override
  Widget build(BuildContext context) {
    final s = strings;
    return Scaffold(
      key: const Key('upgrade-required-screen'),
      backgroundColor: paper,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    CupertinoIcons.arrow_down_circle,
                    size: 56,
                    color: orange,
                  ),
                  const SizedBox(height: 16),
                  Semantics(
                    header: true,
                    child: Text(
                      s.upgradeRequiredTitle,
                      textAlign: TextAlign.center,
                      style: type(22, weight: FontWeight.w800),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    s.upgradeRequiredBody,
                    textAlign: TextAlign.center,
                    style: type(14, color: ink),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    s.installedVersion(MoloPayApiClient.appVersion),
                    style: type(12, color: muted),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
