import 'dart:ui';

import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

const orange = Color(0xFFF16B27);
const ink = Color(0xFF34271F);
const muted = Color(0xFF86776C);
const paper = Color(0xFFFFFCF8);
const peach = Color(0xFFFFE5CF);

TextStyle type(
  double size, {
  Color color = ink,
  FontWeight weight = FontWeight.w500,
}) => TextStyle(
  fontSize: size,
  color: color,
  fontWeight: weight,
  letterSpacing: size > 26 ? -1.3 : -.25,
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
        scale: down ? .96 : 1,
        duration: MediaQuery.disableAnimationsOf(context)
            ? Duration.zero
            : const Duration(milliseconds: 140),
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
  Widget build(BuildContext context) => Press(
    onTap: action,
    child: Container(
      constraints: const BoxConstraints(minHeight: 58),
      padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 17),
      decoration: BoxDecoration(
        color: dark ? ink : orange,
        borderRadius: BorderRadius.circular(22),
        boxShadow: [
          BoxShadow(
            color: (dark ? ink : orange).withValues(alpha: .15),
            blurRadius: 24,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Flexible(
            child: Text(
              text,
              style: type(16, color: Colors.white, weight: FontWeight.w700),
            ),
          ),
          const SizedBox(width: 14),
          const Icon(CupertinoIcons.arrow_right, color: Colors.white, size: 18),
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
          color: Colors.white.withValues(alpha: .88),
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
              child: Icon(icon, color: orange, size: 23),
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
      color: Colors.white,
      borderRadius: BorderRadius.circular(30),
      border: Border.all(color: const Color(0xFFF2E9E0)),
    ),
    child: Column(
      children: [
        Container(
          width: 76,
          height: 76,
          decoration: BoxDecoration(
            color: const Color(0xFFFFF0E5),
            borderRadius: BorderRadius.circular(27),
          ),
          child: Icon(icon, color: orange, size: 34),
        ),
        const SizedBox(height: 20),
        Text(
          title,
          textAlign: TextAlign.center,
          style: type(21, weight: FontWeight.w700),
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
            color: Colors.white,
            border: Border.all(color: const Color(0xFFEFE6DC)),
            borderRadius: BorderRadius.circular(18),
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
        : const Duration(milliseconds: 520),
    curve: Curves.easeOutCubic,
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
    borderRadius: BorderRadius.circular(34),
    child: SizedBox(
      height: height,
      width: double.infinity,
      child: Image.asset(
        'assets/avenir.png',
        fit: BoxFit.cover,
        errorBuilder: (_, error, stack) => Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              colors: [peach, paper],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
          ),
          child: const Center(
            child: Icon(CupertinoIcons.house_fill, size: 110, color: orange),
          ),
        ),
      ),
    ),
  );
}
