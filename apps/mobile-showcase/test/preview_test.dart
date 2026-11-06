import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/widgets.dart';
import 'package:molopay_showcase/main.dart';

void main() {
  testWidgets('captures de présentation avec police réelle', (tester) async {
    final sdk = Platform.environment['FLUTTER_ROOT']!;
    final loader = FontLoader('Roboto');
    for (final name in ['regular', 'bold', 'black']) {
      final bytes = File('$sdk/bin/cache/artifacts/material_fonts/roboto-$name.ttf').readAsBytesSync();
      loader.addFont(Future.value(ByteData.sublistView(bytes)));
    }
    await loader.load();
    final icons = FontLoader('packages/cupertino_icons/CupertinoIcons');
    icons.addFont(rootBundle.load('packages/cupertino_icons/assets/CupertinoIcons.ttf'));
    await icons.load();
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    for (final id in ['home', 'welcome', 'profile']) {
      final key = GlobalKey();
      await tester.pumpWidget(RepaintBoundary(key: key, child: MolopayShowcase(key: ValueKey(id), initialPage: id)));
      await tester.pumpAndSettle();
      await tester.runAsync(() => precacheImage(const AssetImage('assets/avenir.png'), key.currentContext!));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.runAsync(() async {
        final boundary = key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
        final image = await boundary.toImage(pixelRatio: 2);
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        Directory('build/previews').createSync(recursive: true);
        File('build/previews/$id.png').writeAsBytesSync(bytes!.buffer.asUint8List());
        image.dispose();
      });
    }
  });
}
