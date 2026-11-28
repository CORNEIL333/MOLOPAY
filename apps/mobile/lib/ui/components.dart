import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/money.dart';
import 'design.dart';

enum MpPillVariant { primary, ghost, danger }
enum MpGoalStatusKind { active, funded, cancelled, locked, frozen }
enum MpStatusTone { success, warning, danger, info }

/// M-01 : bouton pilule >= 48 px (repos, pressé, désactivé, chargement).
class MpPillButton extends StatelessWidget {
  const MpPillButton({super.key, required this.label, required this.onPressed, this.variant = MpPillVariant.primary, this.loading = false});
  final String label;
  final VoidCallback? onPressed;
  final MpPillVariant variant;
  final bool loading;
  @override
  Widget build(BuildContext context) {
    final bg = switch (variant) { MpPillVariant.primary => MpColors.ink, MpPillVariant.ghost => MpColors.paper, MpPillVariant.danger => MpColors.statusDanger };
    final fg = variant == MpPillVariant.ghost ? MpColors.ink : MpColors.paper;
    return Press(
      label: label, enabled: !loading && onPressed != null, onTap: loading ? null : onPressed,
      child: Container(
        constraints: const BoxConstraints(minHeight: 48, minWidth: 44), padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(MpRadius.pill), border: variant == MpPillVariant.ghost ? Border.all(color: MpColors.ink) : null),
        child: Row(mainAxisSize: MainAxisSize.min, mainAxisAlignment: MainAxisAlignment.center, children: [
          if (loading) SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: fg))
          else Flexible(child: Text(label, style: type(15, color: fg, weight: FontWeight.w600))),
        ]),
      ),
    );
  }
}

/// M-01 : bouton d'icône rond 44 px avec libellé sémantique obligatoire.
class MpIconButton extends StatelessWidget {
  MpIconButton({super.key, required this.icon, required this.label, required this.onPressed, this.active = false}) {
    if (label.trim().isEmpty) throw FlutterError('MP_ICON_LABEL_REQUIRED');
  }
  final IconData icon;
  final String label;
  final VoidCallback? onPressed;
  final bool active;
  @override
  Widget build(BuildContext context) => Semantics(
    button: true, toggled: active, label: label,
    child: ExcludeSemantics(child: Press(
      enabled: onPressed != null, onTap: onPressed,
      child: Container(
        width: 44, height: 44,
        decoration: BoxDecoration(color: active ? MpColors.ink : MpColors.paper, shape: BoxShape.circle, border: Border.all(color: MpColors.mist2)),
        child: Icon(icon, size: 20, color: active ? MpColors.paper : MpColors.ink),
      ),
    )),
  );
}

/// M-04 : pastille de choix accessible (`Semantics.selected`).
class MpChoiceChip extends StatelessWidget {
  const MpChoiceChip({super.key, required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) => Semantics(
    button: true, selected: selected, enabled: onTap != null,
    child: Press(
      enabled: onTap != null, onTap: onTap,
      child: Container(
        constraints: const BoxConstraints(minHeight: 44), padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(color: selected ? MpColors.ink : MpColors.paper, borderRadius: BorderRadius.circular(MpRadius.pill), border: Border.all(color: selected ? MpColors.ink : MpColors.mist2)),
        child: Text(label, style: type(13, color: selected ? MpColors.paper : MpColors.ink, weight: FontWeight.w600, tabular: true)),
      ),
    ),
  );
}

/// M-04 : pastilles de montant entier XAF (aucun champ libre flottant).
class MpAmountChips extends StatelessWidget {
  const MpAmountChips({super.key, required this.amounts, required this.selected, required this.onSelect});
  final List<MoneyXaf> amounts;
  final MoneyXaf? selected;
  final ValueChanged<MoneyXaf> onSelect;
  @override
  Widget build(BuildContext context) => Wrap(spacing: 8, runSpacing: 8, children: [for (final a in amounts) MpChoiceChip(label: a.format(), selected: selected == a, onTap: () => onSelect(a))]);
}

/// M-36, M-27 : champ PIN / OTP à 6 chiffres ASCII (auto-remplissage SMS pour OTP, zéro persistance).
class MpPinOtpField extends StatelessWidget {
  const MpPinOtpField({super.key, required this.label, required this.controller, this.isOtp = false, this.errorText, this.enabled = true});
  final String label;
  final TextEditingController controller;
  final bool isOtp, enabled;
  final String? errorText;
  @override
  Widget build(BuildContext context) => TextField(
    controller: controller, enabled: enabled, obscureText: !isOtp, keyboardType: TextInputType.number, maxLength: 6,
    autofillHints: isOtp ? const [AutofillHints.oneTimeCode] : const <String>[],
    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
    style: type(24, display: true, tabular: true, weight: FontWeight.w600),
    decoration: InputDecoration(labelText: label, errorText: errorText, counterText: ''),
  );
}

const _frTens = <String>['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante-dix', 'quatre-vingt', 'quatre-vingt-dix'];
const _frUnits = <String>['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];

String _frUnder1000(int n) {
  if (n == 0) return '';
  final h = n ~/ 100, rem = n % 100;
  return <String>[
    if (h == 1) 'cent' else if (h > 1) '${_frUnits[h]} cent',
    if (rem > 0 && rem < 20) _frUnits[rem]
    else if (rem >= 20)
      (rem % 10 == 0) ? _frTens[rem ~/ 10]
      : (rem ~/ 10 == 7 || rem ~/ 10 == 9) ? '${_frTens[(rem ~/ 10) - 1]}-${_frUnits[10 + (rem % 10)]}'
      : '${_frTens[rem ~/ 10]}${rem % 10 == 1 ? "-et-un" : "-${_frUnits[rem % 10]}"}',
  ].join(' ');
}

String mpAmountInWords(MoneyXaf amount, {String locale = 'fr'}) {
  final v = amount.amount.toInt();
  if (locale == 'en') return '${amount.format(locale: "en", sms: true)} CFA francs';
  if (v == 0) return 'zéro franc CFA';
  final m = v ~/ 1000000, k = (v % 1000000) ~/ 1000, u = v % 1000;
  return '${<String>[
    if (m == 1) "un million" else if (m > 1) "${_frUnder1000(m)} millions",
    if (k == 1) "mille" else if (k > 1) "${_frUnder1000(k)} mille",
    if (u > 0) _frUnder1000(u),
  ].join(" ")} francs CFA';
}

List<(int, int)> mpCemacBanknotes(MoneyXaf amount) {
  var rem = amount.amount.toInt();
  final out = <(int, int)>[];
  for (final note in const <int>[10000, 5000, 2000, 1000, 500]) {
    final c = rem ~/ note;
    if (c > 0 && out.length < 4) { out.add((note, c)); rem -= c * note; }
  }
  return out;
}

/// M-21 : montant en 4 représentations (chiffres tabulaires, lettres, coupures CEMAC, écoute).
class MpInclusiveAmount extends StatelessWidget {
  const MpInclusiveAmount({super.key, required this.amount, this.locale = 'fr', this.large = false, this.onSpeak});
  final MoneyXaf amount;
  final String locale;
  final bool large;
  final ValueChanged<String>? onSpeak;

  @override
  Widget build(BuildContext context) {
    final words = mpAmountInWords(amount, locale: locale);
    final notes = mpCemacBanknotes(amount);
    return Container(
      padding: const EdgeInsets.all(MpSpace.s4),
      decoration: BoxDecoration(color: MpColors.paper, borderRadius: BorderRadius.circular(MpRadius.md), border: Border.all(color: MpColors.mist2)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Flexible(child: MpAmountText(amount: amount, locale: locale, fontSize: large ? 32 : 24, fontWeight: FontWeight.w600)),
          MpChoiceChip(label: locale == 'en' ? 'Listen' : 'Écouter', selected: false, onTap: () => onSpeak?.call(words)),
        ]),
        const SizedBox(height: 6),
        Text(words, style: type(13, color: MpColors.muted)),
        if (notes.isNotEmpty) ...[
          const SizedBox(height: 8),
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final (d, c) in notes) Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(color: MpColors.mist, borderRadius: BorderRadius.circular(MpRadius.pill)),
              child: Text('$c × ${d == 10000 ? "10 000" : d == 5000 ? "5 000" : d == 2000 ? "2 000" : d == 1000 ? "1 000" : "500"}', style: type(12, weight: FontWeight.w600, tabular: true)),
            ),
          ]),
        ],
      ]),
    );
  }
}

/// M-20, M-24 : anneau de cotisation à 8 segments isolé dans un RepaintBoundary.
class CotisationRing extends StatefulWidget {
  CotisationRing({super.key, required this.filled, this.size = 44, this.waiting = false, this.locale = 'fr'}) {
    if (filled < 0 || filled > 8) throw FlutterError('COTISATION_RING_RANGE');
  }
  final int filled;
  final double size;
  final bool waiting;
  final String locale;
  @override
  State<CotisationRing> createState() => _CotisationRingState();
}

class _CotisationRingState extends State<CotisationRing> with SingleTickerProviderStateMixin {
  late final AnimationController _spin = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (widget.waiting && !MpMotionConfig.reduced(context)) { _spin.repeat(); } else { _spin.stop(); }
  }

  @override
  void dispose() { _spin.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) => Semantics(
    label: widget.locale == 'en' ? '${widget.filled} of 8' : '${widget.filled} sur 8',
    child: RepaintBoundary(child: RotationTransition(turns: _spin, child: CustomPaint(size: Size.square(widget.size), painter: _RingPainter(widget.filled)))),
  );
}

class _RingPainter extends CustomPainter {
  const _RingPainter(this.filled);
  final int filled;

  @override
  void paint(Canvas canvas, Size size) {
    final stroke = size.width * 0.12;
    final r = (Offset.zero & size).deflate(stroke);
    for (var i = 0; i < 8; i++) {
      final p = Paint()..style = PaintingStyle.stroke..strokeWidth = stroke..strokeCap = StrokeCap.round
        ..color = i < filled ? MpColors.ink : MpColors.ink.withValues(alpha: 0.2);
      canvas.drawArc(r, -math.pi / 2 + i * (math.pi * 2 / 8) + 0.09, (math.pi * 2 / 8) - 0.18, false, p);
    }
  }

  @override
  bool shouldRepaint(_RingPainter old) => old.filled != filled;
}

/// Pastille de statut point + mot (jamais couleur seule).
class MpStatusBadge extends StatelessWidget {
  const MpStatusBadge({super.key, required this.label, this.tone = MpStatusTone.info, this.icon});
  final String label;
  final MpStatusTone tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = switch (tone) {
      MpStatusTone.success => (MpColors.statusSuccessBg, MpColors.statusSuccess),
      MpStatusTone.warning => (MpColors.statusWarningBg, MpColors.statusWarning),
      MpStatusTone.danger => (MpColors.statusDangerBg, MpColors.statusDanger),
      MpStatusTone.info => (MpColors.mist, MpColors.ink),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(MpRadius.pill)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        if (icon != null) ...[Icon(icon, size: 13, color: fg), const SizedBox(width: 4)]
        else ...[Container(width: 6, height: 6, decoration: BoxDecoration(color: fg, shape: BoxShape.circle)), const SizedBox(width: 6)],
        Text(label, style: type(12, color: fg, weight: FontWeight.w600)),
      ]),
    );
  }
}

/// M-13, M-22 : carte de projet par univers (aplat pastel sous texte noir #0f1012, icône + mot).
class MpUniverseGoalCard extends StatelessWidget {
  const MpUniverseGoalCard({super.key, required this.title, required this.universe, required this.statusKind, required this.statusLabel, required this.saved, required this.target, required this.filledSegments, this.onTap});
  final String title, statusLabel;
  final MpLiquidUniverse universe;
  final MpGoalStatusKind statusKind;
  final MoneyXaf saved, target;
  final int filledSegments;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) {
    final bg = switch (universe) { MpLiquidUniverse.essentials => MpColors.universeEssentials, MpLiquidUniverse.technology => MpColors.universeTechnology, MpLiquidUniverse.housing => MpColors.universeHousing, MpLiquidUniverse.mobility => MpColors.universeMobility, _ => MpColors.paper };
    final icon = switch (statusKind) { MpGoalStatusKind.active => CupertinoIcons.scope, MpGoalStatusKind.funded => CupertinoIcons.check_mark_circled, MpGoalStatusKind.cancelled => CupertinoIcons.xmark_circle, MpGoalStatusKind.locked => CupertinoIcons.lock, MpGoalStatusKind.frozen => CupertinoIcons.exclamationmark_circle };
    return Press(
      onTap: onTap, enabled: onTap != null,
      child: Container(
        padding: const EdgeInsets.all(MpSpace.s4), decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(MpRadius.lg)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [MpStatusBadge(label: statusLabel, icon: icon), CotisationRing(filled: filledSegments, size: 34)]),
          const SizedBox(height: 10), Text(title, style: type(18, color: MpColors.ink, weight: FontWeight.w600, display: true)),
          const SizedBox(height: 6), Text('${saved.format()} / ${target.format()}', style: type(15, color: MpColors.ink, weight: FontWeight.w600, tabular: true)),
        ]),
      ),
    );
  }
}

/// M-23 : glisser pour confirmer avec alternative bouton accessible TalkBack / VoiceOver.
class MpSlideToConfirm extends StatefulWidget {
  const MpSlideToConfirm({super.key, required this.label, required this.accessibleButtonLabel, required this.onConfirm, this.disabled = false});
  final String label, accessibleButtonLabel;
  final VoidCallback onConfirm;
  final bool disabled;
  @override State<MpSlideToConfirm> createState() => _MpSlideToConfirmState();
}

class _MpSlideToConfirmState extends State<MpSlideToConfirm> {
  double _value = 0;
  bool _locked = false;
  void _trigger() { if (!_locked && !widget.disabled) { setState(() { _locked = true; _value = 1; }); widget.onConfirm(); } }
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(MpSpace.s3), decoration: BoxDecoration(color: MpColors.paper, borderRadius: BorderRadius.circular(MpRadius.md), border: Border.all(color: MpColors.mist2)),
    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(widget.label, style: type(14, weight: FontWeight.w600)),
      Slider(value: _value, onChanged: (_locked || widget.disabled) ? null : (v) { setState(() => _value = v); if (v >= 0.92) _trigger(); }),
      MpPillButton(label: widget.accessibleButtonLabel, variant: MpPillVariant.ghost, onPressed: (_locked || widget.disabled) ? null : _trigger),
    ]),
  );
}

/// M-30 : squelette de chargement affiché après 300 ms seulement.
class MpDelayedSkeleton extends StatefulWidget {
  const MpDelayedSkeleton({super.key, required this.label});
  final String label;
  @override State<MpDelayedSkeleton> createState() => _MpDelayedSkeletonState();
}

class _MpDelayedSkeletonState extends State<MpDelayedSkeleton> {
  Timer? _timer;
  bool _visible = false;
  @override void initState() { super.initState(); _timer = Timer(const Duration(milliseconds: 300), () { if (mounted) setState(() => _visible = true); }); }
  @override void dispose() { _timer?.cancel(); super.dispose(); }
  @override
  Widget build(BuildContext context) => !_visible ? const SizedBox.shrink() : Semantics(
    key: const ValueKey('mp-skeleton-visible'), label: widget.label,
    child: Column(children: List<Widget>.generate(3, (_) => Container(height: 16, margin: const EdgeInsets.only(bottom: 8), decoration: BoxDecoration(color: MpColors.mist2, borderRadius: BorderRadius.circular(10))))),
  );
}

/// M-33 : bandeau hors ligne avec date et heure de dernière mise à jour.
class MpOfflineBanner extends StatelessWidget {
  const MpOfflineBanner({super.key, required this.date, required this.time, this.locale = 'fr'});
  final String date, time, locale;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
    decoration: BoxDecoration(color: MpColors.ink, borderRadius: BorderRadius.circular(MpRadius.sm)),
    child: Row(children: [
      const Icon(CupertinoIcons.wifi_slash, size: 16, color: MpColors.paper), const SizedBox(width: 8),
      Expanded(child: Text(locale == 'en' ? 'No connection. Data from $date at $time.' : 'Pas de connexion. Données du $date à $time.', style: type(12, color: MpColors.paper))),
    ]),
  );
}

class MpNavTab { const MpNavTab({required this.icon, required this.label}); final IconData icon; final String label; }

/// M-11 : barre de navigation flottante à 4 onglets sur GlassSurface (repli Sobre auto).
class MpFloatingNavBar extends StatelessWidget {
  const MpFloatingNavBar({super.key, required this.items, required this.activeIndex, required this.onSelect});
  final List<MpNavTab> items;
  final int activeIndex;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) => GlassSurface(
    borderRadius: MpRadius.pill, padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
    child: Row(children: [
      for (var i = 0; i < items.length; i++)
        Expanded(child: Semantics(
          button: true, selected: i == activeIndex, label: items[i].label,
          child: ExcludeSemantics(child: Press(
            onTap: () => onSelect(i),
            child: Container(
              constraints: const BoxConstraints(minHeight: 44),
              decoration: BoxDecoration(color: i == activeIndex ? MpColors.ink : Colors.transparent, borderRadius: BorderRadius.circular(MpRadius.pill)),
              child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                Icon(items[i].icon, size: 18, color: i == activeIndex ? MpColors.paper : MpColors.ink),
                Text(items[i].label, style: type(11, color: i == activeIndex ? MpColors.paper : MpColors.ink, weight: FontWeight.w600)),
              ]),
            ),
          )),
        )),
    ]),
  );
}

Future<T?> showMpBottomSheet<T>(BuildContext context, Widget child) => showModalBottomSheet<T>(
  context: context, backgroundColor: MpColors.paper,
  shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(MpRadius.lg))),
  builder: (_) => SafeArea(child: Padding(padding: const EdgeInsets.all(MpSpace.s4), child: child)),
);

Future<bool> showMpConfirmDialog(BuildContext context, {required String title, required String body, required String cancelLabel, required String confirmLabel, bool danger = false}) async =>
  (await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title, style: type(18, display: true, weight: FontWeight.w600)),
      content: Text(body, style: type(14, color: MpColors.muted)),
      actions: [
        MpPillButton(label: cancelLabel, variant: MpPillVariant.ghost, onPressed: () => Navigator.of(ctx).pop(false)),
        MpPillButton(label: confirmLabel, variant: danger ? MpPillVariant.danger : MpPillVariant.primary, onPressed: () => Navigator.of(ctx).pop(true)),
      ],
    ),
  )) ?? false;

void showMpToast(BuildContext context, String message, {Duration duration = const Duration(seconds: 4)}) =>
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message), duration: duration.inMilliseconds < 4000 ? const Duration(seconds: 4) : duration));
