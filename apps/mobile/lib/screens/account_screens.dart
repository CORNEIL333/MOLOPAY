import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

import '../core/app_state.dart';
import '../core/models.dart';
import '../core/problem.dart';
import '../l10n/strings.dart';
import '../ui/design.dart';

class AccountSecurityScreen extends StatefulWidget {
  const AccountSecurityScreen({super.key, required this.state});

  final AppState state;

  @override
  State<AccountSecurityScreen> createState() => _AccountSecurityScreenState();
}

class _AccountSecurityScreenState extends State<AccountSecurityScreen> {
  bool _loading = true;
  AccountSecurity? _security;
  ApiProblem? _problem;
  String? _statusMessage;

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
      final data = await widget.state.api.getAccountSecurity();
      if (!mounted) return;
      setState(() {
        _security = data;
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

  Future<void> _revokeOthers() async {
    try {
      await widget.state.api.revokeOtherSessions();
      if (!mounted) return;
      setState(() => _statusMessage = 'Autres sessions fermées.');
      await _load();
    } on ApiProblemException catch (error) {
      if (!mounted) return;
      setState(() => _problem = error.problem);
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
        title: Text(s.securityTitle, style: type(17, weight: FontWeight.w700)),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (_statusMessage != null) ...[
                  Text(_statusMessage!, style: type(14, color: orange, weight: FontWeight.w700)),
                  const SizedBox(height: 12),
                ],
                if (_problem != null) ...[
                  ProblemBanner(problem: _problem!, strings: s, onRetry: _load),
                  const SizedBox(height: 16),
                ],
                if (_loading)
                  const Center(child: CircularProgressIndicator(color: orange))
                else if (_security != null) ...[
                  Text(s.dataAsOf(_security!.asOf), style: type(12, color: muted)),
                  const SizedBox(height: 12),
                  for (final device in _security!.devices)
                    Tile(
                      CupertinoIcons.device_phone_portrait,
                      device.name,
                      '${device.status}${device.current ? ' · actuel' : ''}',
                      () {},
                    ),
                  const SizedBox(height: 16),
                  Primary(
                    s.isEn ? 'Revoke other sessions' : 'Fermer les autres sessions',
                    _revokeOthers,
                    dark: true,
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

class DataRightsScreen extends StatefulWidget {
  const DataRightsScreen({super.key, required this.state});

  final AppState state;

  @override
  State<DataRightsScreen> createState() => _DataRightsScreenState();
}

class _DataRightsScreenState extends State<DataRightsScreen> {
  bool _loading = true;
  DataRightHistory? _history;
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
      final data = await widget.state.api.listDataRights();
      if (!mounted) return;
      setState(() {
        _history = data;
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

  Future<void> _submit(DataRightKind kind) async {
    try {
      await widget.state.api.submitDataRight(kind);
      await _load();
    } on ApiProblemException catch (error) {
      if (!mounted) return;
      setState(() => _problem = error.problem);
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
        title: Text(s.dataRightsTitle, style: type(17, weight: FontWeight.w700)),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 560),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (_problem != null) ...[
                  ProblemBanner(problem: _problem!, strings: s, onRetry: _load),
                  const SizedBox(height: 16),
                ],
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final kind in DataRightKind.values)
                      OutlinedButton(
                        onPressed: () => _submit(kind),
                        child: Text(s.dataRightName(kind)),
                      ),
                  ],
                ),
                const SizedBox(height: 20),
                if (_loading)
                  const Center(child: CircularProgressIndicator(color: orange))
                else if (_history != null) ...[
                  Text(s.dataAsOf(_history!.asOf), style: type(12, color: muted)),
                  const SizedBox(height: 12),
                  for (final item in _history!.items)
                    Tile(
                      CupertinoIcons.doc_text,
                      s.dataRightName(item.kind),
                      item.status,
                      () {},
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

class LegalNameScreen extends StatefulWidget {
  const LegalNameScreen({super.key, required this.state});

  final AppState state;

  @override
  State<LegalNameScreen> createState() => _LegalNameScreenState();
}

class _LegalNameScreenState extends State<LegalNameScreen> {
  final TextEditingController _nameController = TextEditingController();
  bool _pending = false;
  bool _received = false;
  ApiProblem? _problem;

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final name = _nameController.text.trim();
    if (name.length < 2 || _pending) return;
    setState(() {
      _pending = true;
      _problem = null;
    });
    try {
      final res = await widget.state.api.declareLegalName(name);
      if (!mounted) return;
      setState(() => _received = res.verification == 'RECEIVED');
    } on ApiProblemException catch (error) {
      if (!mounted) return;
      setState(() => _problem = error.problem);
    } finally {
      if (mounted) {
        setState(() => _pending = false);
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
        title: Text(s.legalNameTitle, style: type(17, weight: FontWeight.w700)),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (_problem != null) ...[
                  ProblemBanner(problem: _problem!, strings: s),
                  const SizedBox(height: 16),
                ],
                if (_received)
                  Blank(
                    CupertinoIcons.checkmark_shield,
                    s.legalNameTitle,
                    s.legalNameReceived,
                  )
                else ...[
                  TextField(
                    key: const Key('legal-name-field'),
                    controller: _nameController,
                    enabled: !_pending,
                    decoration: InputDecoration(
                      labelText: s.legalNameTitle,
                      filled: true,
                      fillColor: Colors.white,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(18),
                      ),
                    ),
                  ),
                  const SizedBox(height: 18),
                  Primary(
                    s.legalNameTitle,
                    _submit,
                    loading: _pending,
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
