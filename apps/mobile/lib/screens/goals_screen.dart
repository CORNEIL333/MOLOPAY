import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../core/app_state.dart';
import '../core/models.dart';
import '../core/problem.dart';
import '../l10n/strings.dart';
import '../ui/design.dart';

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
        else if (_loading)
          const Center(
            child: Padding(
              padding: EdgeInsets.symmetric(vertical: 36),
              child: CircularProgressIndicator(color: orange),
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
                  builder: (_) => GoalDetailScreen(
                    goal: goal,
                    state: widget.state,
                  ),
                ),
              ),
            ),
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
                    child: Text(title, style: type(17, weight: FontWeight.w700)),
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
                      style: type(11, color: orange, weight: FontWeight.w700),
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
                  color: orange,
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
                    style: type(13, color: orange, weight: FontWeight.w700),
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
  const GoalDetailScreen({
    super.key,
    required this.goal,
    required this.state,
  });

  final Goal goal;
  final AppState state;

  @override
  State<GoalDetailScreen> createState() => _GoalDetailScreenState();
}

class _GoalDetailScreenState extends State<GoalDetailScreen> {
  bool _loading = true;
  ContributionList? _contributions;
  ApiProblem? _problem;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _problem = null;
    });
    try {
      final result = await widget.state.api.listContributions(
        widget.goal.goalId,
      );
      if (!mounted) return;
      setState(() {
        _contributions = result;
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

  @override
  Widget build(BuildContext context) {
    final s = AppStrings.of(widget.state.locale);
    final goal = widget.goal;
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
                              color: orange,
                            ),
                            const SizedBox(width: 6),
                            Text(
                              s.lockedLabel,
                              style: type(12, color: orange, weight: FontWeight.w700),
                            ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: 22),
                Text(s.contributionsTitle, style: type(18, weight: FontWeight.w700)),
                const SizedBox(height: 12),
                if (_loading)
                  const Center(
                    child: Padding(
                      padding: EdgeInsets.symmetric(vertical: 24),
                      child: CircularProgressIndicator(color: orange),
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
                            color: orange,
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
              ],
            ),
          ),
        ),
      ),
    );
  }
}
