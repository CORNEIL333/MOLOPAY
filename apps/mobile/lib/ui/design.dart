import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../core/problem.dart';
import '../l10n/strings.dart';
import 'materials.dart';
import 'molopay_tokens.dart';

export 'materials.dart';
export 'molopay_tokens.dart';

/// Primitives visuelles construites sur les jetons MoloPay (remplace l'ancienne palette).
const ink = MpColors.ink;
const muted = MpColors.muted;
const paper = MpColors.paper;
const mist = MpColors.mist;
const dangerBg = MpColors.statusDangerBg;
const dangerInk = MpColors.statusDanger;

TextStyle type(
  double size, {
  Color color = ink,
  FontWeight weight = FontWeight.w500,
  bool display = false,
  bool tabular = false,
}) => TextStyle(
  fontFamily: display || size >= 20 ? mpFontDisplay : mpFontText,
  fontSize: size,
  color: color,
  fontWeight: weight,
  letterSpacing: size > 26 ? -1.0 : -0.2,
  height: 1.25,
  fontFeatures: tabular ? const <FontFeature>[FontFeature.tabularFigures()] : null,
);

class Press extends StatefulWidget {
  const Press({
    super.key,
    required this.child,
    required this.onTap,
    this.label,
    this.enabled = true,
  });

  final Widget child;
  final VoidCallback? onTap;
  final String? label;
  final bool enabled;

  @override
  State<Press> createState() => _PressState();
}

class _PressState extends State<Press> {
  bool _down = false;

  @override
  Widget build(BuildContext context) {
    final active = widget.enabled && widget.onTap != null;
    final reduced = MpMotionConfig.reduced(context);
    return Semantics(
      button: true,
      enabled: active,
      label: widget.label,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapDown: active ? (_) => setState(() => _down = true) : null,
        onTapCancel: active ? () => setState(() => _down = false) : null,
        onTapUp: active ? (_) => setState(() => _down = false) : null,
        onTap: active ? widget.onTap : null,
        child: AnimatedScale(
          scale: _down && !reduced ? 0.97 : 1,
          duration: reduced ? Duration.zero : MpMotion.micro,
          curve: MpMotion.standardCurve,
          child: Opacity(opacity: active ? 1 : 0.55, child: widget.child),
        ),
      ),
    );
  }
}

class Primary extends StatelessWidget {
  const Primary(
    this.text,
    this.action, {
    super.key,
    this.dark = false,
    this.loading = false,
  });

  final String text;
  final VoidCallback? action;
  final bool dark;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    final bg = dark ? MpColors.paper : MpColors.ink;
    final fg = dark ? MpColors.ink : MpColors.paper;
    return Press(
      onTap: loading ? null : action,
      enabled: !loading && action != null,
      label: text,
      child: Container(
        constraints: const BoxConstraints(minHeight: 48),
        padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 14),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(MpRadius.pill),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (loading)
              SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2, color: fg),
              )
            else ...[
              Flexible(
                child: Text(
                  text,
                  style: type(15, color: fg, weight: FontWeight.w600),
                ),
              ),
              const SizedBox(width: 10),
              Icon(CupertinoIcons.arrow_right, color: fg, size: 16),
            ],
          ],
        ),
      ),
    );
  }
}

class Glass extends StatelessWidget {
  const Glass({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(20),
    this.tone = MpGlassTone.light,
  });

  final Widget child;
  final EdgeInsets padding;
  final MpGlassTone tone;

  @override
  Widget build(BuildContext context) =>
      GlassSurface(padding: padding, tone: tone, child: child);
}

class Tile extends StatelessWidget {
  const Tile(
    this.icon,
    this.title,
    this.subtitle,
    this.action, {
    super.key,
    this.trailing,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback action;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Press(
      onTap: action,
      child: Container(
        constraints: const BoxConstraints(minHeight: 64),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: MpColors.paper,
          borderRadius: BorderRadius.circular(MpRadius.lg),
          border: Border.all(color: MpColors.mist2),
        ),
        child: Row(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: MpColors.mist,
                borderRadius: BorderRadius.circular(14),
              ),
              child: Icon(icon, color: MpColors.ink, size: 20),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: type(16, weight: FontWeight.w600)),
                  if (subtitle.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(subtitle, style: type(13, color: muted)),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 8),
            trailing ??
                const Icon(
                  CupertinoIcons.chevron_right,
                  size: 16,
                  color: muted,
                ),
          ],
        ),
      ),
    ),
  );
}

class Blank extends StatelessWidget {
  const Blank(
    this.icon,
    this.title,
    this.detail, {
    super.key,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String title;
  final String detail;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 28),
    decoration: BoxDecoration(
      color: MpColors.paper,
      borderRadius: BorderRadius.circular(MpRadius.lg),
      border: Border.all(color: MpColors.mist2),
    ),
    child: Column(
      children: [
        Container(
          width: 64,
          height: 64,
          decoration: BoxDecoration(
            color: MpColors.mist,
            borderRadius: BorderRadius.circular(20),
          ),
          child: Icon(icon, color: MpColors.ink, size: 28),
        ),
        const SizedBox(height: 16),
        Text(
          title,
          textAlign: TextAlign.center,
          style: type(20, weight: FontWeight.w600, display: true),
        ),
        const SizedBox(height: 8),
        Text(
          detail,
          textAlign: TextAlign.center,
          style: type(14, color: muted),
        ),
        if (actionLabel != null && onAction != null) ...[
          const SizedBox(height: 18),
          Primary(actionLabel!, onAction),
        ],
      ],
    ),
  );
}

class ProblemBanner extends StatelessWidget {
  const ProblemBanner({
    super.key,
    required this.problem,
    required this.strings,
    this.onRetry,
  });

  final ApiProblem problem;
  final AppStrings strings;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final title = problem.isNetworkError ? strings.offlineTitle : problem.title;
    final detail = problem.isNetworkError
        ? strings.offlineDetail
        : (problem.detail ??
              (problem.isServiceUnavailable ? strings.unavailableRouteHint : null));

    return Semantics(
      liveRegion: true,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: dangerBg,
          borderRadius: BorderRadius.circular(MpRadius.md),
          border: Border.all(color: dangerInk.withValues(alpha: 0.25)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  problem.isNetworkError
                      ? CupertinoIcons.wifi_slash
                      : CupertinoIcons.exclamationmark_triangle_fill,
                  color: dangerInk,
                  size: 20,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    title,
                    style: type(15, color: dangerInk, weight: FontWeight.w600),
                  ),
                ),
              ],
            ),
            if (detail != null) ...[
              const SizedBox(height: 8),
              Text(detail, style: type(13, color: ink)),
            ],
            const SizedBox(height: 8),
            Text(
              'Code : ${problem.code}',
              style: type(12, color: muted, weight: FontWeight.w600),
            ),
            if (onRetry != null) ...[
              const SizedBox(height: 12),
              TextButton.icon(
                onPressed: onRetry,
                icon: const Icon(CupertinoIcons.refresh, size: 16),
                label: Text(strings.retry),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class HeroArt extends StatelessWidget {
  const HeroArt({super.key, this.height = 200});

  final double height;

  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: BorderRadius.circular(MpRadius.lg),
    child: SizedBox(
      height: height,
      width: double.infinity,
      child: Image.asset(
        'assets/avenir.png',
        fit: BoxFit.cover,
        semanticLabel: 'Illustration MoloPay',
        errorBuilder: (_, _, _) => Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              colors: [MpColors.universeEssentials, MpColors.paper],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
          ),
          child: const Center(
            child: Icon(CupertinoIcons.house_fill, size: 96, color: MpColors.ink),
          ),
        ),
      ),
    ),
  );
}
