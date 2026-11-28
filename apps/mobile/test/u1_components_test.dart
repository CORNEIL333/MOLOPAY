import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:molopay_mobile/core/money.dart';
import 'package:molopay_mobile/ui/components.dart';
import 'package:molopay_mobile/ui/materials.dart';
import 'package:molopay_mobile/ui/theme.dart';

Widget _wrap(Widget child, {bool disableAnimations = false}) {
  return MpVisualEffectsScope(
    controller: MpVisualEffectsController(),
    child: MaterialApp(
      theme: buildMolopayTheme(),
      builder: (context, inner) => MediaQuery(
        data: MediaQuery.of(context).copyWith(disableAnimations: disableAnimations),
        child: MpScreenGlassScope(child: Scaffold(body: inner ?? const SizedBox())),
      ),
      home: child,
    ),
  );
}

void main() {
  group('09_… § 3 · U1c Composants Flutter (accessibilité, mode réduit, M-xx)', () {
    testWidgets('MpIconButton refuse un libellé vide (MP_ICON_LABEL_REQUIRED) et respecte >= 44 px', (tester) async {
      expect(
        () => MpIconButton(icon: CupertinoIcons.heart, label: '   ', onPressed: () {}),
        throwsA(isA<FlutterError>().having((e) => e.message, 'message', 'MP_ICON_LABEL_REQUIRED')),
      );

      var tapped = false;
      await tester.pumpWidget(
        _wrap(MpIconButton(icon: CupertinoIcons.heart, label: 'Ajouter aux envies', active: true, onPressed: () => tapped = true)),
      );
      final size = tester.getSize(find.byType(MpIconButton));
      expect(size.width, greaterThanOrEqualTo(44));
      expect(size.height, greaterThanOrEqualTo(44));
      await tester.tap(find.bySemanticsLabel('Ajouter aux envies'));
      expect(tapped, isTrue);
    });

    testWidgets('CotisationRing refuse hors 0..8 (COTISATION_RING_RANGE), expose "4 sur 8" et fige l’attente en mode réduit', (tester) async {
      expect(
        () => CotisationRing(filled: 9),
        throwsA(isA<FlutterError>().having((e) => e.message, 'message', 'COTISATION_RING_RANGE')),
      );

      await tester.pumpWidget(
        _wrap(CotisationRing(filled: 4, waiting: true), disableAnimations: true),
      );
      expect(find.bySemanticsLabel('4 sur 8'), findsOneWidget);
      await tester.pump(const Duration(milliseconds: 500));
      expect(tester.takeException(), isNull);
    });

    testWidgets('MpInclusiveAmount affiche chiffres tabulaires, lettres, coupures CEMAC et bouton Écouter', (tester) async {
      var spoken = '';
      await tester.pumpWidget(
        _wrap(
          MpInclusiveAmount(
            amount: MoneyXaf.parse('25000'),
            locale: 'fr',
            large: true,
            onSpeak: (words) => spoken = words,
          ),
        ),
      );
      expect(find.textContaining('25'), findsWidgets);
      expect(find.textContaining('vingt-cinq mille francs CFA'), findsOneWidget);
      expect(find.text('2 × 10 000'), findsOneWidget);
      expect(find.text('1 × 5 000'), findsOneWidget);
      await tester.tap(find.text('Écouter'));
      expect(spoken, contains('vingt-cinq mille'));
    });

    testWidgets('MpUniverseGoalCard affiche l’état par icône + mot et MpSlideToConfirm offre l’alternative accessible', (tester) async {
      var confirmed = false;
      await tester.pumpWidget(
        _wrap(
          ListView(
            children: [
              MpUniverseGoalCard(
                title: 'Réfrigérateur combiné 240 L',
                universe: MpLiquidUniverse.essentials,
                statusKind: MpGoalStatusKind.active,
                statusLabel: 'En cours',
                saved: MoneyXaf.parse('120000'),
                target: MoneyXaf.parse('240000'),
                filledSegments: 4,
              ),
              MpSlideToConfirm(
                label: 'Glissez pour signer',
                accessibleButtonLabel: 'Signer sans glisser',
                onConfirm: () => confirmed = true,
              ),
            ],
          ),
        ),
      );
      expect(find.text('En cours'), findsOneWidget);
      expect(find.text('Réfrigérateur combiné 240 L'), findsOneWidget);
      await tester.tap(find.text('Signer sans glisser'));
      await tester.pump();
      expect(confirmed, isTrue);
    });

    testWidgets('MpDelayedSkeleton attend 300 ms (M-30) et MpFloatingNavBar expose 4 onglets en verre', (tester) async {
      await tester.pumpWidget(
        _wrap(
          Column(
            children: [
              const MpDelayedSkeleton(label: 'Chargement des offres'),
              MpFloatingNavBar(
                activeIndex: 0,
                onSelect: (_) {},
                items: const [
                  MpNavTab(icon: CupertinoIcons.search, label: 'Catalogue'),
                  MpNavTab(icon: CupertinoIcons.heart, label: 'Envies'),
                  MpNavTab(icon: CupertinoIcons.scope, label: 'Projets'),
                  MpNavTab(icon: CupertinoIcons.person, label: 'Compte'),
                ],
              ),
            ],
          ),
          disableAnimations: true,
        ),
      );
      expect(find.byKey(const ValueKey('mp-skeleton-visible')), findsNothing);
      await tester.pump(const Duration(milliseconds: 250));
      expect(find.byKey(const ValueKey('mp-skeleton-visible')), findsNothing);
      await tester.pump(const Duration(milliseconds: 60));
      expect(find.byKey(const ValueKey('mp-skeleton-visible')), findsOneWidget);
      expect(find.text('Catalogue'), findsOneWidget);
      expect(find.text('Envies'), findsOneWidget);
      expect(find.text('Projets'), findsOneWidget);
      expect(find.text('Compte'), findsOneWidget);
    });
  });
}
