import 'dart:collection';
import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter/material.dart';

import '../core/money.dart';
import 'molopay_tokens.dart';

enum MpLiquidUniverse { home, essentials, technology, housing, mobility, aurora }
enum MpGlassTone { light, dark }

/// F5 : détection unifiée de la réduction du mouvement (Android, iOS et réglage applicatif).
abstract final class MpMotionConfig {
  static bool reduced(BuildContext context) {
    final platformReduced =
        View.maybeOf(context)?.platformDispatcher.accessibilityFeatures.reduceMotion ?? false;
    final appReduced = MpVisualEffectsScope.maybeOf(context)?.reduceMotion ?? false;
    return MediaQuery.disableAnimationsOf(context) || platformReduced || appReduced;
  }
}

/// Contrôleur F8 : matières et bascule automatique en mode Sobre (> 5 % d'images > 16 ms).
class MpVisualEffectsController extends ChangeNotifier {
  final ListQueue<int> _recentMicros = ListQueue<int>();
  bool _soberEffects = false;
  bool _reduceMotion = false;
  bool _autoSober = false;

  bool get soberEffects => _soberEffects;
  bool get reduceMotion => _reduceMotion;
  bool get autoSober => _autoSober;

  void setSoberEffects(bool v) { if (_soberEffects != v) { _soberEffects = v; notifyListeners(); } }
  void setReduceMotion(bool v) { if (_reduceMotion != v) { _reduceMotion = v; notifyListeners(); } }

  void recordFrameTimings(List<FrameTiming> timings) =>
      recordFrameDurationsMicros(timings.map((t) => t.totalSpan.inMicroseconds));

  void recordFrameDurationsMicros(Iterable<int> durationsMicros) {
    for (final m in durationsMicros) {
      _recentMicros.addLast(m);
      while (_recentMicros.length > 120) { _recentMicros.removeFirst(); }
    }
    if (_autoSober || _recentMicros.length < 20) return;
    if (_recentMicros.where((d) => d > 16000).length / _recentMicros.length > 0.05) {
      _autoSober = true;
      notifyListeners();
    }
  }

  bool isSober(BuildContext context) => _soberEffects || _autoSober || MpMotionConfig.reduced(context);
}

class MpVisualEffectsScope extends InheritedNotifier<MpVisualEffectsController> {
  const MpVisualEffectsScope({super.key, required MpVisualEffectsController controller, required super.child})
      : super(notifier: controller);
  static MpVisualEffectsController? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<MpVisualEffectsScope>()?.notifier;
}

class _GlassTracker { final Set<Object> active = <Object>{}; }

class _GlassScopeInherited extends InheritedWidget {
  const _GlassScopeInherited({required this.tracker, required super.child});
  final _GlassTracker tracker;
  @override
  bool updateShouldNotify(_GlassScopeInherited old) => !identical(tracker, old.tracker);
}

class MpScreenGlassScope extends StatefulWidget {
  const MpScreenGlassScope({super.key, required this.child});
  final Widget child;
  @override
  State<MpScreenGlassScope> createState() => _MpScreenGlassScopeState();
}

class _MpScreenGlassScopeState extends State<MpScreenGlassScope> {
  final _GlassTracker _tracker = _GlassTracker();
  @override
  Widget build(BuildContext context) => _GlassScopeInherited(tracker: _tracker, child: widget.child);
}

class _InsideGlassMarker extends InheritedWidget {
  const _InsideGlassMarker({required super.child});
  static bool inside(BuildContext c) => c.getInheritedWidgetOfExactType<_InsideGlassMarker>() != null;
  @override
  bool updateShouldNotify(_InsideGlassMarker old) => false;
}

class MpAmountText extends StatelessWidget {
  const MpAmountText({
    super.key,
    required this.amount,
    this.locale = 'fr',
    this.fontSize = 22,
    this.color = MpColors.ink,
    this.fontWeight = FontWeight.w500,
  });
  final MoneyXaf amount;
  final String locale;
  final double fontSize;
  final Color color;
  final FontWeight fontWeight;

  @override
  Widget build(BuildContext context) {
    if (_InsideGlassMarker.inside(context)) throw FlutterError('MP_GLASS_FINANCIAL_FORBIDDEN');
    return Text(
      amount.format(locale: locale),
      style: TextStyle(
        fontFamily: mpFontDisplay,
        fontSize: fontSize,
        fontWeight: fontWeight,
        color: color,
        letterSpacing: -0.5,
        fontFeatures: const <FontFeature>[FontFeature.tabularFigures()],
      ),
    );
  }
}

class GlassSurface extends StatefulWidget {
  const GlassSurface({
    super.key,
    required this.child,
    this.tone = MpGlassTone.light,
    this.borderRadius = MpRadius.lg,
    this.padding = const EdgeInsets.all(MpSpace.s4),
  });
  final Widget child;
  final MpGlassTone tone;
  final double borderRadius;
  final EdgeInsetsGeometry padding;
  @override
  State<GlassSurface> createState() => _GlassSurfaceState();
}

class _GlassSurfaceState extends State<GlassSurface> {
  final Object _token = Object();
  _GlassTracker? _tracker;

  @override
  void deactivate() { _tracker?.active.remove(_token); super.deactivate(); }
  @override
  void dispose() { _tracker?.active.remove(_token); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    final next = context.getInheritedWidgetOfExactType<_GlassScopeInherited>()?.tracker;
    if (!identical(_tracker, next)) { _tracker?.active.remove(_token); _tracker = next; }
    if (_tracker != null && !_tracker!.active.contains(_token)) {
      if (_tracker!.active.length >= 2) throw FlutterError('MP_GLASS_BUDGET_EXCEEDED');
      _tracker!.active.add(_token);
    }
    final sober = MpVisualEffectsScope.maybeOf(context)?.isSober(context) ?? MpMotionConfig.reduced(context);
    final isDark = widget.tone == MpGlassTone.dark;
    final radius = BorderRadius.circular(widget.borderRadius);
    final box = Container(
      padding: widget.padding,
      decoration: BoxDecoration(
        color: sober ? (isDark ? MpGlass.soberDark : MpGlass.soberLight) : (isDark ? MpGlass.dark : MpGlass.light),
        borderRadius: radius,
        border: Border.all(color: isDark ? MpGlass.darkLine : MpGlass.lightLine),
      ),
      child: _InsideGlassMarker(child: widget.child),
    );
    return RepaintBoundary(
      child: ClipRRect(
        borderRadius: radius,
        child: sober
            ? box
            : BackdropFilter(filter: ImageFilter.blur(sigmaX: MpGlass.blur, sigmaY: MpGlass.blur), child: box),
      ),
    );
  }
}

class LiquidBackground extends StatefulWidget {
  const LiquidBackground({super.key, this.universe = MpLiquidUniverse.home, this.frozen = false, this.animateInTests = false});
  final MpLiquidUniverse universe;
  final bool frozen;
  final bool animateInTests;
  @override
  State<LiquidBackground> createState() => _LiquidBackgroundState();
}

class _LiquidBackgroundState extends State<LiquidBackground> with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl = AnimationController(vsync: this, duration: MpMotion.liquid);

  List<Color> get _stops => switch (widget.universe) {
    MpLiquidUniverse.home => MpGradients.home,
    MpLiquidUniverse.essentials => MpGradients.essentials,
    MpLiquidUniverse.technology => MpGradients.technology,
    MpLiquidUniverse.housing => MpGradients.housing,
    MpLiquidUniverse.mobility => MpGradients.mobility,
    MpLiquidUniverse.aurora => MpGradients.aurora,
  };

  @override
  void dispose() { _ctrl.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) {
    final sober = MpVisualEffectsScope.maybeOf(context)?.isSober(context) ?? MpMotionConfig.reduced(context);
    final inTest = !widget.animateInTests && WidgetsBinding.instance.runtimeType.toString().contains('TestWidgets');
    final isFrozen = widget.frozen || widget.universe == MpLiquidUniverse.aurora || sober || inTest;
    if (isFrozen) { if (_ctrl.isAnimating) _ctrl.stop(); } else if (!_ctrl.isAnimating) { _ctrl.repeat(reverse: true); }
    return ExcludeSemantics(
      child: RepaintBoundary(
        child: AnimatedBuilder(
          animation: _ctrl,
          builder: (_, _) => CustomPaint(
            painter: _BlobsPainter(colors: _stops, phase: isFrozen ? 0.0 : _ctrl.value, aurora: widget.universe == MpLiquidUniverse.aurora),
            size: Size.infinite,
          ),
        ),
      ),
    );
  }
}

class _BlobsPainter extends CustomPainter {
  const _BlobsPainter({required this.colors, required this.phase, required this.aurora});
  final List<Color> colors;
  final double phase;
  final bool aurora;
  static const _anchors = <Offset>[Offset(0.18, 0.16), Offset(0.84, 0.28), Offset(0.28, 0.78), Offset(0.78, 0.72)];

  @override
  void paint(Canvas canvas, Size size) {
    final r = math.max(size.width, size.height) * 0.55;
    for (var i = 0; i < colors.length; i++) {
      final a = _anchors[i % _anchors.length];
      final c = Offset(size.width * a.dx + math.sin((phase + i * 0.25) * math.pi) * size.width * 0.08,
          size.height * a.dy + math.cos((phase + i * 0.35) * math.pi) * size.height * 0.06);
      canvas.drawCircle(c, r, Paint()..shader = RadialGradient(colors: <Color>[
        colors[i].withValues(alpha: aurora ? 0.55 : 0.85), colors[i].withValues(alpha: 0),
      ]).createShader(Rect.fromCircle(center: c, radius: r)));
    }
  }

  @override
  bool shouldRepaint(_BlobsPainter old) => old.phase != phase || old.aurora != aurora || old.colors != colors;
}
