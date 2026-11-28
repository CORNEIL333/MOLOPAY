import 'dart:ui';

import 'package:flutter/cupertino.dart';

import 'molopay_tokens.dart';

export 'molopay_tokens.dart';

const ink = MpColors.ink;
const muted = MpColors.muted;
const paper = MpColors.paper;
const mist = MpColors.mist;

TextStyle type(
  double size, {
  Color color = ink,
  FontWeight weight = FontWeight.w500,
}) => TextStyle(
  fontFamily: size >= 20 ? mpFontDisplay : mpFontText,
  fontSize: size,
  color: color,
  fontWeight: weight,
  letterSpacing: size > 26 ? -1.1 : -0.2,
  height: 1.2,
);

class Press extends StatefulWidget {
  const Press({
    super.key,
    required this.child,
    required this.onTap,
    this.label,
  });
  final Widget child;
  final VoidCallback onTap;
  final String? label;
  @override
  State<Press> createState() => _PressState();
}

class _PressState extends State<Press> {
  bool down = false;
  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: widget.label,
    child: GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapDown: (_) => setState(() => down = true),
      onTapCancel: () => setState(() => down = false),
      onTapUp: (_) => setState(() => down = false),
      onTap: widget.onTap,
      child: AnimatedScale(
        scale: down ? 0.97 : 1,
        duration: MediaQuery.disableAnimationsOf(context)
            ? Duration.zero
            : MpMotion.micro,
        child: widget.child,
      ),
    ),
  );
}

class Primary extends StatelessWidget {
  const Primary(this.text, this.action, {super.key, this.dark = false});
  final String text;
  final VoidCallback action;
  final bool dark;
  @override
  Widget build(BuildContext context) {
    final bg = dark ? MpColors.paper : MpColors.ink;
    final fg = dark ? MpColors.ink : MpColors.paper;
    return Press(
      onTap: action,
      child: Container(
        constraints: const BoxConstraints(minHeight: 48),
        padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 15),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(MpRadius.pill),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Flexible(
              child: Text(
                text,
                style: type(15, color: fg, weight: FontWeight.w600),
              ),
            ),
            const SizedBox(width: 12),
            Icon(CupertinoIcons.arrow_right, color: fg, size: 17),
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
  });
  final Widget child;
  final EdgeInsets padding;
  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: BorderRadius.circular(MpRadius.lg),
    child: BackdropFilter(
      filter: ImageFilter.blur(sigmaX: MpGlass.blur, sigmaY: MpGlass.blur),
      child: Container(
        padding: padding,
        decoration: BoxDecoration(
          color: MpGlass.light,
          borderRadius: BorderRadius.circular(MpRadius.lg),
          border: Border.all(color: MpGlass.lightLine),
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
  final String title, subtitle;
  final VoidCallback action;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Press(
      onTap: action,
      child: Container(
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
              child: Icon(icon, color: MpColors.ink, size: 22),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: type(16, weight: FontWeight.w600)),
                  if (subtitle.isNotEmpty) ...[
                    const SizedBox(height: 5),
                    Text(subtitle, style: type(12, color: muted)),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 8),
            trailing ??
                const Icon(
                  CupertinoIcons.chevron_right,
                  size: 15,
                  color: muted,
                ),
          ],
        ),
      ),
    ),
  );
}

class Blank extends StatelessWidget {
  const Blank(this.icon, this.title, this.detail, {super.key});
  final IconData icon;
  final String title, detail;
  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
    decoration: BoxDecoration(
      color: MpColors.paper,
      borderRadius: BorderRadius.circular(MpRadius.lg),
      border: Border.all(color: MpColors.mist2),
    ),
    child: Column(
      children: [
        Container(
          width: 68,
          height: 68,
          decoration: BoxDecoration(
            color: MpColors.mist,
            borderRadius: BorderRadius.circular(22),
          ),
          child: Icon(icon, color: MpColors.ink, size: 30),
        ),
        const SizedBox(height: 18),
        Text(
          title,
          textAlign: TextAlign.center,
          style: type(21, weight: FontWeight.w600),
        ),
        const SizedBox(height: 10),
        Text(
          detail,
          textAlign: TextAlign.center,
          style: type(14, color: muted),
        ),
      ],
    ),
  );
}

class PreviewField extends StatelessWidget {
  const PreviewField(
    this.label,
    this.placeholder, {
    super.key,
    this.icon = CupertinoIcons.pencil,
  });
  final String label, placeholder;
  final IconData icon;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 18),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: type(13, color: muted, weight: FontWeight.w600),
        ),
        const SizedBox(height: 9),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: MpColors.paper,
            border: Border.all(color: MpColors.mist2),
            borderRadius: BorderRadius.circular(MpRadius.md),
          ),
          child: Row(
            children: [
              Icon(icon, color: muted, size: 20),
              const SizedBox(width: 12),
              Expanded(
                child: Text(placeholder, style: type(15, color: muted)),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}

class Enter extends StatelessWidget {
  const Enter({super.key, required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) => TweenAnimationBuilder<double>(
    tween: Tween(begin: 0, end: 1),
    duration: MediaQuery.disableAnimationsOf(context)
        ? Duration.zero
        : MpMotion.medium,
    curve: MpMotion.enterCurve,
    builder: (_, value, child) => Opacity(
      opacity: value,
      child: Transform.translate(
        offset: Offset(0, 22 * (1 - value)),
        child: child,
      ),
    ),
    child: child,
  );
}

class HeroArt extends StatelessWidget {
  const HeroArt({super.key, this.height = 270});
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
