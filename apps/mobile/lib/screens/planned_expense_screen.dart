import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/app_state.dart';
import '../core/models.dart';
import '../core/money.dart';
import '../core/problem.dart';
import '../l10n/strings.dart';
import '../ui/design.dart';

/// Création d'un objectif Modèle C (`PLANNED_EXPENSE`, F-PLN-001 / I-12).
class NewPlannedExpenseScreen extends StatefulWidget {
  const NewPlannedExpenseScreen({super.key, required this.state});

  static const String termsVersion = '2026-10-26-v1';

  final AppState state;

  @override
  State<NewPlannedExpenseScreen> createState() =>
      _NewPlannedExpenseScreenState();
}

class _NewPlannedExpenseScreenState extends State<NewPlannedExpenseScreen> {
  final TextEditingController _beneficiaryController = TextEditingController();
  final TextEditingController _targetController = TextEditingController();
  final TextEditingController _durationController = TextEditingController(
    text: '3',
  );

  bool _loadingPlans = true;
  List<PaymentPlan> _plans = const [];
  String? _selectedPlanId;
  bool _acceptedTerms = false;
  bool _submitting = false;

  String? _beneficiaryError;
  String? _targetError;
  String? _termsError;
  ApiProblem? _problem;

  @override
  void initState() {
    super.initState();
    _loadPlans();
  }

  @override
  void dispose() {
    _beneficiaryController.dispose();
    _targetController.dispose();
    _durationController.dispose();
    super.dispose();
  }

  Future<void> _loadPlans() async {
    setState(() {
      _loadingPlans = true;
      _problem = null;
    });
    try {
      final all = await widget.state.api.listPlans();
      final cPlans = all
          .where((p) => p.model == OfferModel.plannedExpense)
          .toList();
      if (!mounted) return;
      setState(() {
        _plans = cPlans;
        _selectedPlanId = cPlans.isNotEmpty ? cPlans.first.planId : null;
        _loadingPlans = false;
      });
    } on ApiProblemException catch (error) {
      if (!mounted) return;
      setState(() {
        _problem = error.problem;
        _loadingPlans = false;
      });
    }
  }

  Future<void> _submit() async {
    if (_submitting || _selectedPlanId == null) return;
    final s = AppStrings.of(widget.state.locale);
    final ben = _beneficiaryController.text.trim();
    final targetRaw = _targetController.text.trim();
    final duration = int.tryParse(_durationController.text.trim()) ?? 0;
    final plan = _plans.firstWhere((p) => p.planId == _selectedPlanId);

    MoneyXaf? parsedTarget;
    try {
      final candidate = MoneyXaf.parse(targetRaw);
      if (candidate.amount > BigInt.zero) {
        parsedTarget = candidate;
      }
    } on MoneyFormatException {
      parsedTarget = null;
    }

    setState(() {
      _beneficiaryError = ben.isEmpty ? s.beneficiaryIdLabel : null;
      _targetError = parsedTarget == null ? s.targetAmountInvalid : null;
      _termsError = _acceptedTerms ? null : s.termsRequired;
      _problem = null;
    });

    if (ben.isEmpty ||
        parsedTarget == null ||
        !_acceptedTerms ||
        duration < 1 ||
        duration > plan.maxDurationMonths) {
      return;
    }

    setState(() => _submitting = true);
    try {
      final created = await widget.state.api.createGoal(
        model: OfferModel.plannedExpense,
        beneficiaryId: ben,
        targetXaf: parsedTarget,
        planId: plan.planId,
        durationMonths: duration,
        acceptTermsVersion: NewPlannedExpenseScreen.termsVersion,
      );
      if (!mounted) return;
      Navigator.of(context).pop(created);
    } on ApiProblemException catch (error) {
      if (!mounted) return;
      setState(() => _problem = error.problem);
    } finally {
      if (mounted) {
        setState(() => _submitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = AppStrings.of(widget.state.locale);

    return Scaffold(
      backgroundColor: paper,
      appBar: AppBar(
        backgroundColor: paper,
        elevation: 0,
        foregroundColor: ink,
        title: Text(
          s.newPlannedExpense,
          style: type(17, weight: FontWeight.w700),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (_problem != null) ...[
                  ProblemBanner(problem: _problem!, strings: s, onRetry: _loadPlans),
                  const SizedBox(height: 16),
                ],
                if (_loadingPlans)
                  const Center(
                    child: Padding(
                      padding: EdgeInsets.symmetric(vertical: 32),
                      child: CircularProgressIndicator(color: orange),
                    ),
                  )
                else if (_plans.isEmpty)
                  Blank(
                    CupertinoIcons.calendar,
                    s.newPlannedExpense,
                    s.noOffersDetail,
                  )
                else ...[
                  Text(
                    s.beneficiaryIdLabel,
                    style: type(13, color: muted, weight: FontWeight.w600),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    key: const Key('planned-beneficiary-field'),
                    controller: _beneficiaryController,
                    enabled: !_submitting,
                    decoration: InputDecoration(
                      errorText: _beneficiaryError,
                      filled: true,
                      fillColor: Colors.white,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(18),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    s.targetAmountLabel,
                    style: type(13, color: muted, weight: FontWeight.w600),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    key: const Key('planned-target-field'),
                    controller: _targetController,
                    enabled: !_submitting,
                    keyboardType: TextInputType.number,
                    decoration: InputDecoration(
                      errorText: _targetError,
                      filled: true,
                      fillColor: Colors.white,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(18),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    s.durationLabel,
                    style: type(13, color: muted, weight: FontWeight.w600),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    key: const Key('planned-duration-field'),
                    controller: _durationController,
                    enabled: !_submitting,
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    decoration: InputDecoration(
                      filled: true,
                      fillColor: Colors.white,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(18),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  CheckboxListTile(
                    contentPadding: EdgeInsets.zero,
                    value: _acceptedTerms,
                    activeColor: orange,
                    onChanged: _submitting
                        ? null
                        : (v) => setState(() => _acceptedTerms = v ?? false),
                    title: Text(s.termsAcceptLabel, style: type(13)),
                  ),
                  if (_termsError != null) ...[
                    Text(_termsError!, style: type(12, color: dangerInk)),
                    const SizedBox(height: 8),
                  ],
                  const SizedBox(height: 14),
                  Primary(
                    s.createGoalButton,
                    _submit,
                    key: const Key('planned-submit-button'),
                    loading: _submitting,
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
