import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/app_state.dart';
import '../core/problem.dart';
import '../l10n/strings.dart';
import '../ui/design.dart';
import 'signup_screen.dart';

/// Écran de connexion client (`POST /v1/auth/sessions`).
/// Zéro simulation : si la route est fermée (503/404), affiche le code RFC 9457 exact.
class LoginScreen extends StatefulWidget {
  const LoginScreen({
    super.key,
    required this.state,
    this.onSuccess,
  });

  final AppState state;
  final VoidCallback? onSuccess;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  static final RegExp _phonePattern = RegExp(r'^\+[1-9][0-9]{7,14}$');
  static final RegExp _pinPattern = RegExp(r'^[0-9]{6}$');

  final TextEditingController _phoneController = TextEditingController();
  final TextEditingController _pinController = TextEditingController();

  String? _phoneError;
  String? _pinError;
  ApiProblem? _problem;
  bool _pending = false;

  @override
  void dispose() {
    _phoneController.dispose();
    _pinController.clear();
    _pinController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_pending) return;
    final s = AppStrings.of(widget.state.locale);
    final phone = _phoneController.text.trim();
    final pin = _pinController.text;

    final phoneOk = _phonePattern.hasMatch(phone);
    final pinOk = _pinPattern.hasMatch(pin);
    setState(() {
      _phoneError = phoneOk ? null : s.invalidPhone;
      _pinError = pinOk ? null : s.invalidPin;
      _problem = null;
    });
    if (!phoneOk || !pinOk) return;

    setState(() => _pending = true);
    try {
      await widget.state.signIn(phone: phone, pin: pin);
      _pinController.clear();
      if (!mounted) return;
      if (widget.onSuccess != null) {
        widget.onSuccess!();
      } else {
        Navigator.of(context).pop(true);
      }
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
        title: Text(s.loginTitle, style: type(18, weight: FontWeight.w700)),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 460),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(s.loginTitle, style: type(34, weight: FontWeight.w800)),
                const SizedBox(height: 8),
                Text(s.loginCaption, style: type(14, color: muted)),
                const SizedBox(height: 22),
                if (_problem != null) ...[
                  ProblemBanner(problem: _problem!, strings: s),
                  const SizedBox(height: 18),
                ],
                Text(
                  s.phoneLabel,
                  style: type(13, color: muted, weight: FontWeight.w600),
                ),
                const SizedBox(height: 8),
                TextField(
                  key: const Key('login-phone-field'),
                  controller: _phoneController,
                  enabled: !_pending,
                  keyboardType: TextInputType.phone,
                  autofillHints: const [AutofillHints.telephoneNumber],
                  decoration: InputDecoration(
                    hintText: s.phoneHint,
                    errorText: _phoneError,
                    prefixIcon: const Icon(CupertinoIcons.phone, color: muted),
                    filled: true,
                    fillColor: Colors.white,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(18),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  s.pinLabel,
                  style: type(13, color: muted, weight: FontWeight.w600),
                ),
                const SizedBox(height: 8),
                TextField(
                  key: const Key('login-pin-field'),
                  controller: _pinController,
                  enabled: !_pending,
                  obscureText: true,
                  enableSuggestions: false,
                  autocorrect: false,
                  keyboardType: TextInputType.number,
                  maxLength: 6,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: InputDecoration(
                    errorText: _pinError,
                    counterText: '',
                    prefixIcon: const Icon(CupertinoIcons.lock, color: muted),
                    filled: true,
                    fillColor: Colors.white,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(18),
                    ),
                  ),
                  onSubmitted: (_) => _submit(),
                ),
                const SizedBox(height: 22),
                Primary(
                  s.signInButton,
                  _submit,
                  key: const Key('login-submit-button'),
                  loading: _pending,
                ),
                const SizedBox(height: 14),
                Center(
                  child: TextButton(
                    onPressed: _pending
                        ? null
                        : () => Navigator.of(context).push(
                            CupertinoPageRoute<void>(
                              builder: (_) => SignupScreen(state: widget.state),
                            ),
                          ),
                    child: Text(
                      s.isEn ? 'Create an account' : 'Créer un compte',
                      style: type(14, color: orange, weight: FontWeight.w700),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
