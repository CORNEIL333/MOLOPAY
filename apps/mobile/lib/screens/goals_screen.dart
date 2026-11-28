import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/app_state.dart';
import '../core/models.dart';
import '../core/problem.dart';
import '../l10n/strings.dart';
import '../ui/design.dart';
import 'planned_expense_screen.dart';

class GoalsScreen extends StatefulWidget {
  const GoalsScreen({
    super.key,
    required this.state,
    required this.onOpenLogin,
  });

  final AppState state;
  final VoidCallback onOpenLogin;

  @override
  State<GoalsScreen> createState() => _GoalsScreenState();
}

class _GoalsScreenState extends State<GoalsScreen> {
  bool _loading = false;
  GoalList? _goalList;
  ApiProblem? _problem;

  @override
  void initState() {
    super.initState();
    widget.state.addListener(_onStateChanged);
    if (widget.state.isAuthenticated) {
      _load();
    }
  }

  @override
  void dispose() {
    widget.state.removeListener(_onStateChanged);
    super.dispose();
  }

  void _onStateChanged() {
    if (!mounted) return;
    if (widget.state.isAuthenticated) {
      _load();
    } else {
      setState(() {
        _goalList = null;
        _problem = null;
        _loading = false;
      });
    }
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _problem = null;
    });
    try {
      final list = await widget.state.api.listGoals();
      if (!mounted) return;
      setState(() {
        _goalList = list;
        _loading = false;
      });
    } on ApiProblemException catch (error) {
      if (!mounted) return;
      if (error.problem.isUnauthorized) {
        widget.state.handleUnauthorized();
      }
      setState(() {
        _problem = error.problem;
        _loading = false;
      });
    }
  }

  Future<void> _openNewPlannedExpense() async {
    final created = await Navigator.of(context).push<Goal>(
      CupertinoPageRoute<Goal>(
        builder: (_) => NewPlannedExpenseScreen(state: widget.state),
      ),
    );
    if (created != null && mounted) {
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = AppStrings.of(widget.state.locale);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(s.goalsTitle, style: type(34, weight: FontWeight.w800)),
        const SizedBox(height: 8),
        Text(s.goalsCaption, style: type(14, color: muted)),
        const SizedBox(height: 20),
        if (!widget.state.isAuthenticated)
          Blank(
            CupertinoIcons.lock_shield,
            s.loginRequiredTitle,
            s.loginRequiredDetail,
            actionLabel: s.signInButton,
            onAction: widget.onOpenLogin,
          )
        else ...[
          Tile(
            CupertinoIcons.plus_circle,
            s.newPlannedExpense,
            '',
            _openNewPlannedExpense,
          ),
          const SizedBox(height: 8),
          if (_loading)
            const Center(
              child: Padding(
                padding: EdgeInsets.symmetric(vertical: 36),
                child: CircularProgressIndicator(color: ink),
              ),
            )
          else if (_problem != null)
            ProblemBanner(problem: _problem!, strings: s, onRetry: _load)
          else if (_goalList == null || _goalList!.goals.isEmpty)
            Blank(
              CupertinoIcons.flag,
              s.noGoalsTitle,
              s.noGoalsDetail,
              actionLabel: s.refresh,
              onAction: _load,
            )
          else ...[
            Text(s.dataAsOf(_goalList!.asOf), style: type(12, color: muted)),
            const SizedBox(height: 12),
            for (final goal in _goalList!.goals)
              _GoalCard(
                goal: goal,
                strings: s,
                onTap: () => Navigator.of(context).push(
                  CupertinoPageRoute<void>(
                    builder: (_) =>
                        GoalDetailScreen(goal: goal, state: widget.state),
                  ),
                ),
              ),
          ],
        ],
      ],
    );
  }
}

class _GoalCard extends StatelessWidget {
  const _GoalCard({
    required this.goal,
    required this.strings,
    required this.onTap,
  });

  final Goal goal;
  final AppStrings strings;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final title = goal.offerTitle ?? strings.modelName(goal.model);
    final pct = goal.progressPercent;

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Press(
        onTap: onTap,
        label: title,
        child: Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: const Color(0xFFF3ECE5)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      title,
                      style: type(17, weight: FontWeight.w700),
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 5,
                    ),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFF0E4),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Text(
                      strings.goalStatusName(goal.status),
                      style: type(11, color: ink, weight: FontWeight.w700),
                    ),
                  ),
                ],
              ),
              if (goal.partnerName != null) ...[
                const SizedBox(height: 4),
                Text(goal.partnerName!, style: type(13, color: muted)),
              ],
              const SizedBox(height: 14),
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: LinearProgressIndicator(
                  value: pct / 100,
                  minHeight: 8,
                  backgroundColor: const Color(0xFFF3ECE5),
                  color: ink,
                ),
              ),
              const SizedBox(height: 10),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    '${goal.savedXaf.format(locale: strings.locale)} / ${goal.targetXaf.format(locale: strings.locale)}',
                    style: type(13, weight: FontWeight.w600),
                  ),
                  Text(
                    '$pct %',
                    style: type(13, color: ink, weight: FontWeight.w700),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class GoalDetailScreen extends StatefulWidget {
  const GoalDetailScreen({super.key, required this.goal, required this.state});

  final Goal goal;
  final AppState state;

  @override
  State<GoalDetailScreen> createState() => _GoalDetailScreenState();
}

class _GoalDetailScreenState extends State<GoalDetailScreen> {
  late Goal _goal;
  bool _loading = true;
  ContributionList? _contributions;
  BeneficiaryReceipt? _beneficiaryReceipt;
  ApiProblem? _problem;
  ApiProblem? _actionProblem;
  String? _actionStatus;

  final TextEditingController _claimDetailsController = TextEditingController();
  ClaimReason _claimReason = ClaimReason.paymentNotReceived;
  ClaimReceipt? _claimReceipt;
  bool _claimPending = false;

  final TextEditingController _payPinController = TextEditingController();
  bool _payConfirming = false;
  bool _payPending = false;
  bool _paid = false;
  String? _payPinError;

  @override
  void initState() {
    super.initState();
    _goal = widget.goal;
    _load();
  }

  @override
  void dispose() {
    _claimDetailsController.dispose();
    _payPinController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _problem = null;
    });
    try {
      final result = await widget.state.api.listContributions(_goal.goalId);
      BeneficiaryReceipt? receipt;
      if (_goal.model == OfferModel.plannedExpense &&
          (_goal.status == GoalStatus.paidToBeneficiary ||
              _goal.status == GoalStatus.closed)) {
        try {
          receipt = await widget.state.api.getBeneficiaryReceipt(_goal.goalId);
        } on ApiProblemException {
          receipt = null;
        }
      }
      if (!mounted) return;
      setState(() {
        _contributions = result;
        _beneficiaryReceipt = receipt;
        _loading = false;
      });
    } on ApiProblemException catch (error) {
      if (!mounted) return;
      setState(() {
        _problem = error.problem;
        _loading = false;
      });
    }
  }

  Future<void> _promptLock(AppStrings s) async {
    final pinController = TextEditingController();
    final pin = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(s.lockGoalButton),
        content: TextField(
          controller: pinController,
          obscureText: true,
          keyboardType: TextInputType.number,
          maxLength: 6,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          decoration: InputDecoration(labelText: s.pinLabel),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: Text(s.back)),
          TextButton(
            onPressed: () => Navigator.pop(ctx, pinController.text),
            child: Text(s.lockGoalButton),
          ),
        ],
      ),
    );
    pinController.clear();
    pinController.dispose();
    if (pin == null || !RegExp(r'^[0-9]{6}$').hasMatch(pin) || !mounted) return;

    setState(() {
      _actionProblem = null;
      _actionStatus = null;
    });
    try {
      final updated = await widget.state.api.lockGoal(_goal.goalId, pin: pin);
      if (!mounted) return;
      setState(() {
        _goal = updated;
        _actionStatus = s.lockGoalDone;
      });
    } on ApiProblemException catch (error) {
      if (!mounted) return;
      setState(() => _actionProblem = error.problem);
    }
  }

  /// F-PLN-003 : règlement au bénéficiaire vérifié, sous PIN, après résumé.
  Future<void> _payBeneficiary(AppStrings s) async {
    final pin = _payPinController.text;
    if (!RegExp(r'^[0-9]{6}$').hasMatch(pin)) {
      setState(() => _payPinError = s.pinInvalid);
      return;
    }
    if (_payPending) return;
    _payPinController.clear();
    setState(() {
      _payPinError = null;
      _payPending = true;
      _actionProblem = null;
    });
    try {
      final updated = await widget.state.api.payBeneficiary(
        _goal.goalId,
        pin: pin,
      );
      if (!mounted) return;
      setState(() {
        _goal = updated;
        _paid = true;
        _payConfirming = false;
      });
    } on ApiProblemException catch (error) {
      if (!mounted) return;
      setState(() => _actionProblem = error.problem);
    } finally {
      if (mounted) setState(() => _payPending = false);
    }
  }

  Widget _beneficiaryPayment(AppStrings s, Goal goal) {
    return Container(
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
            s.beneficiarySectionTitle,
            style: type(15, weight: FontWeight.w700),
          ),
          const SizedBox(height: 6),
          Text(
            s.beneficiaryDocumentWebNotice,
            key: const Key('beneficiary-document-web-notice'),
            style: type(12, color: muted),
          ),
          const SizedBox(height: 12),
          if (!_payConfirming) ...[
            Text(s.beneficiaryPayHelp, style: type(13, color: ink)),
            const SizedBox(height: 10),
            Primary(
              s.beneficiaryPayPrepare,
              () => setState(() {
                _payConfirming = true;
                _payPinError = null;
              }),
              key: const Key('beneficiary-pay-prepare'),
              dark: true,
            ),
          ] else ...[
            Text(
              s.beneficiaryPaySummaryTitle,
              style: type(14, weight: FontWeight.w700),
            ),
            const SizedBox(height: 6),
            Text(
              '${s.beneficiaryPayAmount} : ${goal.savedXaf.format(locale: s.locale)}',
              style: type(14, weight: FontWeight.w600),
            ),
            Text(
              '${s.beneficiaryLabel} : ${goal.beneficiaryId ?? '—'}',
              style: type(13, color: ink),
            ),
            const SizedBox(height: 8),
            Text(
              s.beneficiaryPayIrreversible,
              style: type(12, color: ink, weight: FontWeight.w700),
            ),
            const SizedBox(height: 10),
            TextField(
              key: const Key('beneficiary-pin-field'),
              controller: _payPinController,
              obscureText: true,
              keyboardType: TextInputType.number,
              maxLength: 6,
              enabled: !_payPending,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: InputDecoration(
                labelText: s.pinLabel,
                error: _payPinError == null
                    ? null
                    : Text(
                        _payPinError!,
                        key: const Key('beneficiary-pin-error'),
                        style: type(12, color: Colors.red.shade700),
                      ),
              ),
            ),
            const SizedBox(height: 8),
            Primary(
              s.beneficiaryPayConfirm,
              () => _payBeneficiary(s),
              key: const Key('beneficiary-pay-confirm'),
              loading: _payPending,
            ),
            TextButton(
              key: const Key('beneficiary-pay-cancel'),
              onPressed: _payPending
                  ? null
                  : () {
                      _payPinController.clear();
                      setState(() {
                        _payConfirming = false;
                        _payPinError = null;
                      });
                    },
              child: Text(s.beneficiaryPayCancel),
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _submitClaim() async {
    final details = _claimDetailsController.text.trim();
    if (details.length < 10 || _claimPending) return;
    setState(() {
      _claimPending = true;
      _actionProblem = null;
    });
    try {
      final receipt = await widget.state.api.submitClaim(
        _goal.goalId,
        reason: _claimReason,
        details: details,
      );
      if (!mounted) return;
      _claimDetailsController.clear();
      setState(() => _claimReceipt = receipt);
    } on ApiProblemException catch (error) {
      if (!mounted) return;
      setState(() => _actionProblem = error.problem);
    } finally {
      if (mounted) {
        setState(() => _claimPending = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = AppStrings.of(widget.state.locale);
    final goal = _goal;
    final title = goal.offerTitle ?? s.modelName(goal.model);

    return Scaffold(
      backgroundColor: paper,
      appBar: AppBar(
        backgroundColor: paper,
        elevation: 0,
        foregroundColor: ink,
        title: Text(title, style: type(17, weight: FontWeight.w700)),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFEDD9),
                    borderRadius: BorderRadius.circular(24),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(s.savedLabel, style: type(12, color: muted)),
                      const SizedBox(height: 6),
                      Text(
                        goal.savedXaf.format(locale: s.locale),
                        style: type(28, weight: FontWeight.w800),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        '${s.targetLabel} : ${goal.targetXaf.format(locale: s.locale)} (${goal.progressPercent} %)',
                        style: type(13, color: ink),
                      ),
                      if (goal.locked) ...[
                        const SizedBox(height: 8),
                        Row(
                          children: [
                            const Icon(
                              CupertinoIcons.lock_fill,
                              size: 14,
                              color: ink,
                            ),
                            const SizedBox(width: 6),
                            Text(
                              s.lockedLabel,
                              style: type(
                                12,
                                color: ink,
                                weight: FontWeight.w700,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                if (_actionStatus != null) ...[
                  Text(
                    _actionStatus!,
                    style: type(14, color: ink, weight: FontWeight.w700),
                  ),
                  const SizedBox(height: 12),
                ],
                if (_actionProblem != null) ...[
                  ProblemBanner(problem: _actionProblem!, strings: s),
                  const SizedBox(height: 12),
                ],
                if (goal.status == GoalStatus.active && !goal.locked) ...[
                  Primary(
                    s.lockGoalButton,
                    () => _promptLock(s),
                    key: const Key('goal-lock-button'),
                    dark: true,
                  ),
                  const SizedBox(height: 10),
                ],
                if (goal.status == GoalStatus.draft ||
                    (goal.status == GoalStatus.active && !goal.locked)) ...[
                  Text(
                    s.signedActionUnavailable,
                    style: type(12, color: muted),
                  ),
                  const SizedBox(height: 12),
                ],
                if (goal.model == OfferModel.saveThenBuy &&
                    goal.status == GoalStatus.funded) ...[
                  Text(s.handoverPendingNotice, style: type(12, color: muted)),
                  const SizedBox(height: 12),
                ],
                if (_paid) ...[
                  Text(
                    s.beneficiaryPaid,
                    key: const Key('beneficiary-paid-status'),
                    style: type(14, color: ink, weight: FontWeight.w700),
                  ),
                  const SizedBox(height: 12),
                ],
                if (goal.model == OfferModel.plannedExpense &&
                    goal.status == GoalStatus.funded) ...[
                  _beneficiaryPayment(s, goal),
                  const SizedBox(height: 16),
                ],
                if (_beneficiaryReceipt != null) ...[
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
                          s.beneficiarySectionTitle,
                          style: type(15, weight: FontWeight.w700),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          '${_beneficiaryReceipt!.amountXaf.format(locale: s.locale)} · ${_beneficiaryReceipt!.bankReference}',
                          style: type(14, weight: FontWeight.w600),
                        ),
                        Text(
                          'Ledger: ${_beneficiaryReceipt!.entryHashPrefix}',
                          style: type(12, color: muted),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                ],
                Text(
                  s.contributionsTitle,
                  style: type(18, weight: FontWeight.w700),
                ),
                const SizedBox(height: 12),
                if (_loading)
                  const Center(
                    child: Padding(
                      padding: EdgeInsets.symmetric(vertical: 24),
                      child: CircularProgressIndicator(color: ink),
                    ),
                  )
                else if (_problem != null)
                  ProblemBanner(problem: _problem!, strings: s, onRetry: _load)
                else if (_contributions == null ||
                    _contributions!.contributions.isEmpty)
                  Blank(
                    CupertinoIcons.doc_text,
                    s.noContributions,
                    s.goalsCaption,
                  )
                else ...[
                  Text(
                    s.dataAsOf(_contributions!.asOf),
                    style: type(12, color: muted),
                  ),
                  const SizedBox(height: 10),
                  for (final item in _contributions!.contributions)
                    Container(
                      width: double.infinity,
                      margin: const EdgeInsets.only(bottom: 10),
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: const Color(0xFFF3ECE5)),
                      ),
                      child: Row(
                        children: [
                          const Icon(
                            CupertinoIcons.checkmark_seal_fill,
                            color: ink,
                            size: 20,
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  item.amountXaf.format(locale: s.locale),
                                  style: type(15, weight: FontWeight.w700),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  item.receiptNumber,
                                  style: type(12, color: muted),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
                const SizedBox(height: 24),
                Text(
                  s.claimSectionTitle,
                  style: type(18, weight: FontWeight.w700),
                ),
                const SizedBox(height: 10),
                if (_claimReceipt != null)
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFFF0E4),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      '${s.receiptPrefix} : ${_claimReceipt!.reference} (${_claimReceipt!.status})',
                      style: type(14, weight: FontWeight.w700),
                    ),
                  )
                else ...[
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final reason in ClaimReason.values)
                        ChoiceChip(
                          label: Text(s.claimReasonName(reason)),
                          selected: _claimReason == reason,
                          onSelected: (_) =>
                              setState(() => _claimReason = reason),
                        ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    key: const Key('claim-details-field'),
                    controller: _claimDetailsController,
                    maxLines: 3,
                    enabled: !_claimPending,
                    decoration: InputDecoration(
                      labelText: s.claimDetailsLabel,
                      filled: true,
                      fillColor: Colors.white,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(18),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Primary(
                    s.submitClaimButton,
                    _submitClaim,
                    key: const Key('claim-submit-button'),
                    loading: _claimPending,
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
