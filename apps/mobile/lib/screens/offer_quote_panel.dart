import 'package:flutter/material.dart';

import '../core/app_state.dart';
import '../core/models.dart';
import '../core/problem.dart';
import '../l10n/strings.dart';
import '../ui/design.dart';

/// Simulation d'échéancier côté serveur (`POST /v1/offers/{offerId}/quotes`)
/// et démarrage d'un objectif Modèle A (`POST /v1/goals`).
class OfferQuotePanel extends StatefulWidget {
  const OfferQuotePanel({
    super.key,
    required this.offer,
    required this.plans,
    required this.state,
  });

  static const String termsVersion = '2026-10-26-v1';

  final Offer offer;
  final List<PaymentPlan> plans;
  final AppState state;

  @override
  State<OfferQuotePanel> createState() => _OfferQuotePanelState();
}

class _OfferQuotePanelState extends State<OfferQuotePanel> {
  PaymentPlan? _selectedPlan;
  int _durationMonths = 3;
  bool _quoting = false;
  Quote? _quote;
  ApiProblem? _problem;

  bool _acceptedTerms = false;
  String? _termsError;
  bool _creating = false;
  Goal? _createdGoal;

  @override
  void initState() {
    super.initState();
    if (widget.plans.isNotEmpty) {
      _selectedPlan = widget.plans.first;
      _durationMonths = widget.plans.first.maxDurationMonths >= 3
          ? 3
          : widget.plans.first.maxDurationMonths;
    }
  }

  Future<void> _requestQuote() async {
    final plan = _selectedPlan;
    if (plan == null || _quoting) return;
    setState(() {
      _quoting = true;
      _problem = null;
      _quote = null;
      _createdGoal = null;
    });
    try {
      final result = await widget.state.api.requestQuote(
        offerId: widget.offer.offerId,
        planId: plan.planId,
        durationMonths: _durationMonths,
      );
      if (!mounted) return;
      setState(() => _quote = result);
    } on ApiProblemException catch (error) {
      if (!mounted) return;
      setState(() => _problem = error.problem);
    } finally {
      if (mounted) {
        setState(() => _quoting = false);
      }
    }
  }

  Future<void> _createModelAGoal(AppStrings s) async {
    final quote = _quote;
    if (quote == null || _creating) return;
    if (!_acceptedTerms) {
      setState(() => _termsError = s.termsRequired);
      return;
    }
    setState(() {
      _termsError = null;
      _creating = true;
      _problem = null;
    });
    try {
      final goal = await widget.state.api.createGoal(
        model: OfferModel.saveThenBuy,
        offerId: widget.offer.offerId,
        planId: quote.planId,
        durationMonths: quote.durationMonths,
        acceptTermsVersion: OfferQuotePanel.termsVersion,
      );
      if (!mounted) return;
      setState(() => _createdGoal = goal);
    } on ApiProblemException catch (error) {
      if (!mounted) return;
      setState(() => _problem = error.problem);
    } finally {
      if (mounted) {
        setState(() => _creating = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final locale = widget.state.locale;
    final s = AppStrings.of(locale);
    if (widget.plans.isEmpty) {
      return Text(s.noOffersDetail, style: type(13, color: muted));
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final plan in widget.plans)
          Press(
            label: plan.planId,
            onTap: () => setState(() {
              _selectedPlan = plan;
              if (_durationMonths > plan.maxDurationMonths) {
                _durationMonths = plan.maxDurationMonths;
              }
            }),
            child: Container(
              width: double.infinity,
              margin: const EdgeInsets.only(bottom: 10),
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(
                  color: _selectedPlan?.planId == plan.planId
                      ? orange
                      : const Color(0xFFF3ECE5),
                  width: _selectedPlan?.planId == plan.planId ? 2 : 1,
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${s.modelName(plan.model)} · ${s.rhythmName(plan.rhythm)}',
                    style: type(14, weight: FontWeight.w700),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Min. ${plan.minAmountXaf.format(locale: locale)} · max ${plan.maxDurationMonths} mois',
                    style: type(13, color: muted),
                  ),
                ],
              ),
            ),
          ),
        const SizedBox(height: 10),
        Primary(
          s.simulatePlanButton,
          _requestQuote,
          key: const Key('offer-quote-button'),
          loading: _quoting,
        ),
        if (_problem != null) ...[
          const SizedBox(height: 14),
          ProblemBanner(problem: _problem!, strings: s),
        ],
        if (_quote != null) ...[
          const SizedBox(height: 16),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: const Color(0xFFF3ECE5)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${_quote!.totalXaf.format(locale: locale)} (${_quote!.installments.length})',
                  style: type(16, weight: FontWeight.w700),
                ),
                const SizedBox(height: 8),
                for (final inst in _quote!.installments.take(6))
                  Text(
                    '${inst.dueDate} · ${inst.amountXaf.format(locale: locale)}',
                    style: type(13, color: muted),
                  ),
              ],
            ),
          ),
          if (_quote!.model == OfferModel.saveThenBuy &&
              _createdGoal == null) ...[
            const SizedBox(height: 12),
            Row(
              children: [
                Checkbox(
                  key: const Key('offer-terms-checkbox'),
                  value: _acceptedTerms,
                  activeColor: orange,
                  onChanged: _creating
                      ? null
                      : (v) => setState(() => _acceptedTerms = v ?? false),
                ),
                Expanded(child: Text(s.termsAcceptLabel, style: type(13))),
              ],
            ),
            if (_termsError != null)
              Text(_termsError!, style: type(12, color: dangerInk)),
            const SizedBox(height: 8),
            Primary(
              s.createGoalButton,
              () => _createModelAGoal(s),
              key: const Key('offer-start-goal-button'),
              loading: _creating,
            ),
          ],
          if (_createdGoal != null) ...[
            const SizedBox(height: 12),
            Text(
              '${s.goalStatusName(_createdGoal!.status)} · ${_createdGoal!.goalId}',
              style: type(13, color: orange, weight: FontWeight.w700),
            ),
          ],
        ],
      ],
    );
  }
}
