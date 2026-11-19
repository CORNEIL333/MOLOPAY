import 'dart:ui';

import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../core/problem.dart';
import '../l10n/strings.dart';

/// Palette et primitives visuelles reprises de `apps/mobile-showcase/lib/design.dart`.
const orange = Color(0xFFF16B27);
const ink = Color(0xFF34271F);
const muted = Color(0xFF6B5D54);
const paper = Color(0xFFFFFCF8);
const peach = Color(0xFFFFE5CF);
const dangerBg = Color(0xFFFFEFEA);
const dangerInk = Color(0xFF9E2A1C);

TextStyle type(
  double size, {
  Color color = ink,
  FontWeight weight = FontWeight.w500,
}) => TextStyle(
  fontSize: size,
  color: color,
  fontWeight: weight,
  letterSpacing: size > 26 ? -1.1 : -0.2,
  height: 1.25,
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
          scale: _down ? 0.97 : 1,
          duration: MediaQuery.disableAnimationsOf(context)
              ? Duration.zero
              : const Duration(milliseconds: 140),
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
  Widget build(BuildContext context) => Press(
    onTap: loading ? null : action,
    enabled: !loading && action != null,
    label: text,
    child: Container(
      constraints: const BoxConstraints(minHeight: 54),
      padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 15),
      decoration: BoxDecoration(
        color: dark ? ink : orange,
        borderRadius: BorderRadius.circular(22),
        boxShadow: [
          BoxShadow(
            color: (dark ? ink : orange).withValues(alpha: 0.15),
            blurRadius: 20,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          if (loading)
            const SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: Colors.white,
              ),
            )
          else ...[
            Flexible(
              child: Text(
                text,
                style: type(16, color: Colors.white, weight: FontWeight.w700),
              ),
            ),
            const SizedBox(width: 12),
            const Icon(
              CupertinoIcons.arrow_right,
              color: Colors.white,
              size: 18,
            ),
          ],
        ],
      ),
    ),
  );
}

class Glass extends StatelessWidget {
  const Glass({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(20),
  });

  final Widget child;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: BorderRadius.circular(28),
    child: BackdropFilter(
      filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
      child: Container(
        padding: padding,
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.90),
          borderRadius: BorderRadius.circular(28),
          border: Border.all(color: Colors.white),
        ),
        child: child,
      ),
    ),
  );
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
          color: Colors.white,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: const Color(0xFFF3ECE5)),
        ),
        child: Row(
          children: [
            Container(
              width: 46,
              height: 46,
              decoration: BoxDecoration(
                color: const Color(0xFFFFF0E4),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Icon(icon, color: orange, size: 22),
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
      color: Colors.white,
      borderRadius: BorderRadius.circular(28),
      border: Border.all(color: const Color(0xFFF2E9E0)),
    ),
    child: Column(
      children: [
        Container(
          width: 68,
          height: 68,
          decoration: BoxDecoration(
            color: const Color(0xFFFFF0E5),
            borderRadius: BorderRadius.circular(24),
          ),
          child: Icon(icon, color: orange, size: 30),
        ),
        const SizedBox(height: 16),
        Text(
          title,
          textAlign: TextAlign.center,
          style: type(20, weight: FontWeight.w700),
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
          borderRadius: BorderRadius.circular(22),
          border: Border.all(color: dangerInk.withValues(alpha: 0.2)),
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
                    style: type(15, color: dangerInk, weight: FontWeight.w700),
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
    borderRadius: BorderRadius.circular(30),
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
              colors: [peach, paper],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
          ),
          child: const Center(
            child: Icon(CupertinoIcons.house_fill, size: 96, color: orange),
          ),
        ),
      ),
    ),
  );
}
