// Généré par docs/05_direction_ux_et_ui/jetons/generate.py — ne pas modifier à la main.
import 'package:flutter/animation.dart';
import 'package:flutter/painting.dart';

abstract final class MpColors {
  static const ink = Color(0xFF0F1012);
  static const ink2 = Color(0xFF1C1D21);
  static const ink3 = Color(0xFF2A2C31);
  static const paper = Color(0xFFFFFFFF);
  static const mist = Color(0xFFF2F2EE);
  static const mist2 = Color(0xFFE4E5DF);
  static const muted = Color(0xFF6A6D73);
  static const mutedDark = Color(0xFF9A9CA3);
  static const universeEssentials = Color(0xFFD9F26B);
  static const universeTechnology = Color(0xFF8FDDF5);
  static const universeHousing = Color(0xFFC3BDFF);
  static const universeMobility = Color(0xFFFFA8C5);
  static const statusSuccess = Color(0xFF1F7A4A);
  static const statusSuccessBg = Color(0xFFE2F2E8);
  static const statusWarning = Color(0xFF8A5300);
  static const statusWarningBg = Color(0xFFFBEDD0);
  static const statusDanger = Color(0xFFC4262E);
  static const statusDangerBg = Color(0xFFFBE4E5);
  static const darkBg = Color(0xFF0B0B0D);
  static const darkSurface = Color(0xFF17181B);
  static const darkSurface2 = Color(0xFF1C1D21);
  static const darkText = Color(0xFFF1F2F4);
  static const darkLine = Color(0xFF2A2C31);
}

abstract final class MpRadius {
  static const sm = 12.0;
  static const md = 20.0;
  static const lg = 28.0;
  static const xl = 40.0;
  static const pill = 999.0;
}

abstract final class MpSpace {
  static const s1 = 4.0;
  static const s2 = 8.0;
  static const s3 = 12.0;
  static const s4 = 16.0;
  static const s5 = 24.0;
  static const s6 = 32.0;
  static const s7 = 48.0;
}

abstract final class MpMotion {
  static const micro = Duration(milliseconds: 100);
  static const short = Duration(milliseconds: 150);
  static const base = Duration(milliseconds: 250);
  static const medium = Duration(milliseconds: 350);
  static const long = Duration(milliseconds: 500);
  static const xlong = Duration(milliseconds: 800);
  static const celebration = Duration(milliseconds: 1200);
  static const standardCurve = Cubic(0.2, 0.0, 0.0, 1.0);
  static const enterCurve = Cubic(0.05, 0.7, 0.1, 1.0);
  static const exitCurve = Cubic(0.3, 0.0, 0.8, 0.15);
  static const utilityEnterCurve = Cubic(0.0, 0.0, 0.0, 1.0);
  static const utilityExitCurve = Cubic(0.3, 0.0, 1.0, 1.0);
  static const linearCurve = Cubic(0.0, 0.0, 1.0, 1.0);
}

// Polices : Outfit (montants, titres) et Inter (texte), embarquées dans les assets (pas de téléchargement à l'exécution).
const mpFontDisplay = 'Outfit';
const mpFontText = 'Inter';
