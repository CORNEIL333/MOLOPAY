import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'molopay_tokens.dart';

bool _licensesRegistered = false;

/// Enregistre les licences SIL OFL 1.1 des polices auto-hébergées Outfit et Inter.
void registerMolopayFontLicenses() {
  if (_licensesRegistered) return;
  _licensesRegistered = true;
  LicenseRegistry.addLicense(() async* {
    final outfit = await rootBundle.loadString('assets/fonts/OFL-Outfit.txt');
    yield LicenseEntryWithLineBreaks(const <String>['Outfit'], outfit);
    final inter = await rootBundle.loadString('assets/fonts/OFL-Inter.txt');
    yield LicenseEntryWithLineBreaks(const <String>['Inter'], inter);
  });
}

ThemeData buildMolopayTheme({Brightness brightness = Brightness.light}) {
  final isDark = brightness == Brightness.dark;
  final bg = isDark ? MpColors.darkBg : MpColors.mist;
  final surface = isDark ? MpColors.darkSurface : MpColors.paper;
  final text = isDark ? MpColors.darkText : MpColors.ink;
  final primary = isDark ? MpColors.paper : MpColors.ink;
  final onPrimary = isDark ? MpColors.ink : MpColors.paper;

  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    fontFamily: mpFontText,
    scaffoldBackgroundColor: bg,
    colorScheme: ColorScheme(
      brightness: brightness,
      primary: primary,
      onPrimary: onPrimary,
      secondary: isDark ? MpColors.darkSurface2 : MpColors.mist2,
      onSecondary: text,
      error: isDark ? MpColors.statusDangerBg : MpColors.statusDanger,
      onError: isDark ? MpColors.ink : MpColors.paper,
      surface: surface,
      onSurface: text,
    ),
    textTheme: TextTheme(
      displayLarge: TextStyle(
        fontFamily: mpFontDisplay,
        color: text,
        fontWeight: FontWeight.w300,
      ),
      titleLarge: TextStyle(
        fontFamily: mpFontDisplay,
        color: text,
        fontWeight: FontWeight.w500,
      ),
      bodyMedium: TextStyle(fontFamily: mpFontText, color: text),
    ),
    splashFactory: NoSplash.splashFactory,
  );
}
