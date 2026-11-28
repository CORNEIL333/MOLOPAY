import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:molopay_mobile/core/money.dart';
import 'package:molopay_mobile/ui/materials.dart';
import 'package:molopay_mobile/ui/molopay_tokens.dart';

void main() {
  group('U0 · Fondations Flutter (F1, F5, F6, F8)', () {
    test('F1 — applique la palette noir/blanc/univers validée sans orange', () {
      expect(MpColors.ink, const Color(0xFF0F1012));
      expect(MpColors.paper, const Color(0xFFFFFFFF));
      expect(MpColors.mist, const Color(0xFFF2F2EE));
      expect(MpColors.universeEssentials, const Color(0xFFD9F26B));
      expect(MpColors.universeTechnology, const Color(0xFF8FDDF5));
      expect(MpColors.universeHousing, const Color(0xFFC3BDFF));
      expect(MpColors.universeMobility, const Color(0xFFFFA8C5));
      expect(MpColors.statusDanger, const Color(0xFFC4262E));
    });

    testWidgets(
      'F5 — MpMotionConfig.reduced détecte disableAnimations et le réglage applicatif',
      (tester) async {
        final controller = MpVisualEffectsController();
        bool? isReduced;

        await tester.pumpWidget(
          MediaQuery(
            data: const MediaQueryData(disableAnimations: true),
            child: MpVisualEffectsScope(
              controller: controller,
              child: Builder(
                builder: (context) {
                  isReduced = MpMotionConfig.reduced(context);
                  return const SizedBox.shrink();
                },
              ),
            ),
          ),
        );
        expect(isReduced, isTrue);

        controller.setReduceMotion(true);
        await tester.pumpWidget(
          MediaQuery(
            data: const MediaQueryData(disableAnimations: false),
            child: MpVisualEffectsScope(
              controller: controller,
              child: Builder(
                builder: (context) {
                  isReduced = MpMotionConfig.reduced(context);
                  return const SizedBox.shrink();
                },
              ),
            ),
          ),
        );
        expect(isReduced, isTrue);
      },
    );

    test(
      'F8 — bascule automatiquement en repli Sobre si plus de 5 % des images dépassent 16 ms',
      () {
        final controller = MpVisualEffectsController();
        expect(controller.autoSober, isFalse);

        // 20 images dont 1 lente (5,0 % pile) → pas encore de bascule (> 5 % requis).
        controller.recordFrameDurationsMicros([
          for (var i = 0; i < 19; i++) 12000,
          18500,
        ]);
        expect(controller.autoSober, isFalse);

        // 2e image lente sur 21 (~9,5 % > 5 %) → bascule automatique en mode Sobre.
        controller.recordFrameDurationsMicros(const [19000]);
        expect(controller.autoSober, isTrue);
      },
    );

    testWidgets(
      'F8 — GlassSurface retire BackdropFilter en mode Sobre et refuse > 2 surfaces (MP_GLASS_BUDGET_EXCEEDED)',
      (tester) async {
        final controller = MpVisualEffectsController();
        await tester.pumpWidget(
          MaterialApp(
            home: MpVisualEffectsScope(
              controller: controller,
              child: const MpScreenGlassScope(
                child: Column(
                  children: [
                    GlassSurface(child: Text('Un')),
                    GlassSurface(tone: MpGlassTone.dark, child: Text('Deux')),
                  ],
                ),
              ),
            ),
          ),
        );
        expect(find.byType(BackdropFilter), findsNWidgets(2));

        controller.setSoberEffects(true);
        await tester.pump();
        expect(find.byType(BackdropFilter), findsNothing);

        // Arbre vidé pour repartir d'un budget neuf.
        await tester.pumpWidget(const SizedBox.shrink());

        final errors = <String>[];
        final previousOnError = FlutterError.onError;
        FlutterError.onError = (details) =>
            errors.add(details.exceptionAsString());
        try {
          await tester.pumpWidget(
            MaterialApp(
              home: MpVisualEffectsScope(
                controller: MpVisualEffectsController(),
                child: const MpScreenGlassScope(
                  child: SingleChildScrollView(
                    child: Column(
                      children: [
                        GlassSurface(child: Text('1')),
                        GlassSurface(child: Text('2')),
                        GlassSurface(child: Text('3')),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          );
        } finally {
          FlutterError.onError = previousOnError;
        }
        expect(errors, isNotEmpty);
        expect(
          errors.every((e) => e.contains('MP_GLASS_BUDGET_EXCEEDED')),
          isTrue,
          reason: errors.join('\n'),
        );
      },
    );

    testWidgets(
      'F8 / F6 — refuse un montant financier dans GlassSurface (MP_GLASS_FINANCIAL_FORBIDDEN) et affiche des chiffres tabulaires stables',
      (tester) async {
        final errors = <String>[];
        final previousOnError = FlutterError.onError;
        FlutterError.onError = (details) =>
            errors.add(details.exceptionAsString());
        try {
          await tester.pumpWidget(
            MaterialApp(
              home: MpVisualEffectsScope(
                controller: MpVisualEffectsController(),
                child: MpScreenGlassScope(
                  child: GlassSurface(
                    child: MpAmountText(amount: MoneyXaf.parse('25000')),
                  ),
                ),
              ),
            ),
          );
        } finally {
          FlutterError.onError = previousOnError;
        }
        expect(errors, isNotEmpty);
        expect(
          errors.every((e) => e.contains('MP_GLASS_FINANCIAL_FORBIDDEN')),
          isTrue,
          reason: errors.join('\n'),
        );

        // Hors verre, le montant s'affiche en chiffres tabulaires, au format « 25 000 FCFA ».
        await tester.pumpWidget(
          MaterialApp(home: MpAmountText(amount: MoneyXaf.parse('25000'))),
        );
        final text = tester.widget<Text>(find.byType(Text));
        expect(text.data, '25\u202F000 FCFA');
        expect(
          text.style?.fontFeatures,
          contains(const FontFeature.tabularFigures()),
        );
      },
    );
  });
}
