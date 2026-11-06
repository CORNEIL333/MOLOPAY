import 'package:flutter/cupertino.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:molopay_showcase/main.dart';
import 'package:molopay_showcase/screens.dart';

void main() {
  testWidgets('la préférence de mouvement reste cohérente après navigation', (
    tester,
  ) async {
    addTearDown(() => reduceMotion.value = false);
    await tester.pumpWidget(const MolopayShowcase(initialPage: 'preferences'));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(CupertinoSwitch).last);
    await tester.pumpAndSettle();
    expect(reduceMotion.value, isTrue);
    final navigator = tester.state<NavigatorState>(find.byType(Navigator));
    navigator.pushNamed('preferences');
    await tester.pumpAndSettle();
    expect(
      tester.widget<CupertinoSwitch>(find.byType(CupertinoSwitch).last).value,
      isTrue,
    );
    await tester.tap(find.byType(CupertinoSwitch).last);
    await tester.pumpAndSettle();
    expect(reduceMotion.value, isFalse);
  });
  testWidgets(
    'ouvre la maquette puis permet une visite sans authentification',
    (tester) async {
      await tester.pumpWidget(const MolopayShowcase());
      await tester.pumpAndSettle();
      await tester.tap(find.text('Ouvrir la maquette'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Explorer'));
      await tester.pumpAndSettle();
      expect(find.text('Vos envies.\nVotre rythme.'), findsOneWidget);
      await tester.tap(find.bySemanticsLabel('Créer un projet'));
      await tester.pumpAndSettle();
      expect(find.text('Une envie en tête ?'), findsOneWidget);
      await tester.tap(find.text('Préparer une dépense'));
      await tester.pumpAndSettle();
      expect(find.text('Les grandes étapes\nse préparent.'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  for (final id in ['home', 'welcome', 'index', ...screens.keys]) {
    testWidgets('écran $id à 320 pixels sans débordement ni saisie sensible', (
      tester,
    ) async {
      tester.view.physicalSize = const Size(320, 700);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(MolopayShowcase(initialPage: id));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.byType(EditableText), findsNothing);
      expect(find.byType(CupertinoTextField), findsNothing);
    });
  }
  testWidgets('le dock ouvre les vrais écrans vides de projets et profil', (
    tester,
  ) async {
    await tester.pumpWidget(const MolopayShowcase(initialPage: 'home'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Projets').last);
    await tester.pumpAndSettle();
    expect(find.text('Aucun projet ouvert pour le moment'), findsNothing);
    expect(find.text('Tout commence par une envie.'), findsOneWidget);
    await tester.tap(find.text('Profil'));
    await tester.pumpAndSettle();
    expect(find.text('Aucun compte connecté'), findsOneWidget);
  });
}
