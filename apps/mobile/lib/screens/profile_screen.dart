import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../core/app_state.dart';
import '../core/problem.dart';
import '../l10n/strings.dart';
import '../ui/design.dart';
import 'account_screens.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({
    super.key,
    required this.state,
    required this.onOpenLogin,
  });

  final AppState state;
  final VoidCallback onOpenLogin;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  bool? _apiHealthy;
  bool _checkingHealth = false;
  ApiProblem? _signOutProblem;

  Future<void> _checkHealth() async {
    setState(() => _checkingHealth = true);
    try {
      final ok = await widget.state.api.checkHealth();
      if (!mounted) return;
      setState(() {
        _apiHealthy = ok;
        _checkingHealth = false;
      });
    } on ApiProblemException {
      if (!mounted) return;
      setState(() {
        _apiHealthy = false;
        _checkingHealth = false;
      });
    }
  }

  Future<void> _signOut() async {
    setState(() => _signOutProblem = null);
    try {
      await widget.state.signOut();
    } on ApiProblemException catch (error) {
      if (!mounted) return;
      setState(() => _signOutProblem = error.problem);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = AppStrings.of(widget.state.locale);
    final session = widget.state.session;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(s.profileTitle, style: type(34, weight: FontWeight.w800)),
        const SizedBox(height: 8),
        Text(s.profileCaption, style: type(14, color: muted)),
        const SizedBox(height: 20),
        if (_signOutProblem != null) ...[
          ProblemBanner(problem: _signOutProblem!, strings: s),
          const SizedBox(height: 16),
        ],
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: const Color(0xFFF3ECE5)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                session != null ? s.signedInAs : s.notSignedIn,
                style: type(12, color: muted, weight: FontWeight.w600),
              ),
              const SizedBox(height: 6),
              Text(
                session?.displayName ?? s.notSignedIn,
                style: type(20, weight: FontWeight.w700),
              ),
              const SizedBox(height: 16),
              if (session != null)
                Primary(s.signOutButton, _signOut, dark: true)
              else
                Primary(s.signInButton, widget.onOpenLogin),
            ],
          ),
        ),
        const SizedBox(height: 16),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: const Color(0xFFF3ECE5)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(s.languageLabel, style: type(15, weight: FontWeight.w700)),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: Press(
                      key: const Key('locale-toggle-fr'),
                      label: 'Français',
                      onTap: () => widget.state.setLocale('fr'),
                      child: Container(
                        constraints: const BoxConstraints(minHeight: 44),
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: widget.state.locale == 'fr'
                              ? ink
                              : const Color(0xFFF7F2EC),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: Text(
                          'Français',
                          style: type(
                            14,
                            color: widget.state.locale == 'fr'
                                ? Colors.white
                                : ink,
                            weight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Press(
                      key: const Key('locale-toggle-en'),
                      label: 'English',
                      onTap: () => widget.state.setLocale('en'),
                      child: Container(
                        constraints: const BoxConstraints(minHeight: 44),
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: widget.state.locale == 'en'
                              ? ink
                              : const Color(0xFFF7F2EC),
                          borderRadius: BorderRadius.circular(16),
                        ),
                        child: Text(
                          'English',
                          style: type(
                            14,
                            color: widget.state.locale == 'en'
                                ? Colors.white
                                : ink,
                            weight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: Text(
                      s.reduceMotionLabel,
                      style: type(14, weight: FontWeight.w600),
                    ),
                  ),
                  Switch.adaptive(
                    value: widget.state.reduceMotion,
                    activeTrackColor: orange,
                    onChanged: widget.state.setReduceMotion,
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        if (session != null) ...[
          Tile(
            CupertinoIcons.shield,
            s.securityTitle,
            '',
            () => Navigator.of(context).push(
              CupertinoPageRoute<void>(
                builder: (_) => AccountSecurityScreen(state: widget.state),
              ),
            ),
          ),
          Tile(
            CupertinoIcons.doc_plaintext,
            s.dataRightsTitle,
            '',
            () => Navigator.of(context).push(
              CupertinoPageRoute<void>(
                builder: (_) => DataRightsScreen(state: widget.state),
              ),
            ),
          ),
          Tile(
            CupertinoIcons.person_badge_plus,
            s.legalNameTitle,
            '',
            () => Navigator.of(context).push(
              CupertinoPageRoute<void>(
                builder: (_) => LegalNameScreen(state: widget.state),
              ),
            ),
          ),
        ],
        Tile(
          CupertinoIcons.antenna_radiowaves_left_right,
          s.apiStatusLabel,
          _checkingHealth
              ? s.loading
              : _apiHealthy == null
              ? s.checkApi
              : (_apiHealthy! ? s.apiOnline : s.apiOffline),
          _checkHealth,
        ),
      ],
    );
  }
}
