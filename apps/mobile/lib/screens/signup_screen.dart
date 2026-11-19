import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/app_state.dart';
import '../core/models.dart';
import '../core/problem.dart';
import '../l10n/strings.dart';
import '../ui/design.dart';

/// Inscription client par OTP SMS + PIN + clé publique Ed25519 (Contrat 0.34.0, D71).
/// Zéro simulation : si la route OTP est fermée (503 sans prestataire SMS), affiche l'erreur RFC 9457.
class SignupScreen extends StatefulWidget {
  const SignupScreen({
    super.key,
    required this.state,
    this.provideDevicePublicKey,
  });

  static const String termsVersion = '2026-10-26-v1';

  final AppState state;

  /// Fournisseur de clé publique Ed25519 (SPKI DER base64) issue du Keystore / Secure Enclave.
  /// S'il est absent, l'interface indique honnêtement l'indisponibilité de la clé d'appareil.
  final Future<String> Function()? provideDevicePublicKey;

  @override
  State<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends State<SignupScreen> {
  static final RegExp _phonePattern = RegExp(r'^\+[1-9][0-9]{7,14}$');
  static final RegExp _sixDigits = RegExp(r'^[0-9]{6}$');

  final TextEditingController _phoneController = TextEditingController();
  final TextEditingController _codeController = TextEditingController();
  final TextEditingController _pinController = TextEditingController();
  final TextEditingController _deviceNameController = TextEditingController(
    text: 'MoloPay Mobile',
  );

  OtpChallenge? _challenge;
  bool _acceptedTerms = false;
  bool _pending = false;
  String? _phoneError;
  String? _formError;
  ApiProblem? _problem;
  SignupResult? _result;

  @override
  void dispose() {
    _phoneController.dispose();
    _codeController.dispose();
    _pinController.clear();
    _pinController.dispose();
    _deviceNameController.dispose();
    super.dispose();
  }

  Future<void> _requestOtp() async {
    if (_pending) return;
    final s = AppStrings.of(widget.state.locale);
    final phone = _phoneController.text.trim();
    if (!_phonePattern.hasMatch(phone)) {
      setState(() => _phoneError = s.invalidPhone);
      return;
    }
    setState(() {
      _phoneError = null;
      _problem = null;
      _pending = true;
    });
    try {
      final challenge = await widget.state.api.requestOtpChallenge(phone: phone);
      if (!mounted) return;
      setState(() => _challenge = challenge);
    } on ApiProblemException catch (error) {
      if (!mounted) return;
      setState(() => _problem = error.problem);
    } finally {
      if (mounted) {
        setState(() => _pending = false);
      }
    }
  }

  Future<void> _completeSignup() async {
    final challenge = _challenge;
    if (challenge == null || _pending) return;
    final s = AppStrings.of(widget.state.locale);
    final code = _codeController.text.trim();
    final pin = _pinController.text;
    final deviceName = _deviceNameController.text.trim();

    if (!_sixDigits.hasMatch(code) || !_sixDigits.hasMatch(pin) || deviceName.isEmpty) {
      setState(() => _formError = s.invalidPin);
      return;
    }
    if (!_acceptedTerms) {
      setState(() => _formError = s.termsRequired);
      return;
    }
    if (widget.provideDevicePublicKey == null) {
      setState(() => _formError = s.signedActionUnavailable);
      return;
    }

    setState(() {
      _formError = null;
      _problem = null;
      _pending = true;
    });
    try {
      final pubKey = await widget.provideDevicePublicKey!();
      final res = await widget.state.api.signUp(
        challengeId: challenge.challengeId,
        code: code,
        pin: pin,
        devicePublicKey: pubKey,
        deviceName: deviceName,
        acceptTermsVersion: SignupScreen.termsVersion,
      );
      _pinController.clear();
      if (!mounted) return;
      setState(() => _result = res);
    } on ApiProblemException catch (error) {
      _pinController.clear();
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
    final title = s.isEn ? 'Create an account' : 'Créer un compte';

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
            constraints: const BoxConstraints(maxWidth: 460),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (_problem != null) ...[
                  ProblemBanner(problem: _problem!, strings: s),
                  const SizedBox(height: 16),
                ],
                if (_result != null)
                  Blank(
                    CupertinoIcons.checkmark_seal,
                    title,
                    '${_result!.accountId} · ${_result!.deviceId}',
                  )
                else if (_challenge == null) ...[
                  Text(s.phoneLabel, style: type(13, color: muted, weight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  TextField(
                    key: const Key('signup-phone-field'),
                    controller: _phoneController,
                    enabled: !_pending,
                    keyboardType: TextInputType.phone,
                    decoration: InputDecoration(
                      hintText: s.phoneHint,
                      errorText: _phoneError,
                      filled: true,
                      fillColor: Colors.white,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(18),
                      ),
                    ),
                  ),
                  const SizedBox(height: 18),
                  Primary(
                    s.isEn ? 'Send SMS code' : 'Recevoir un code SMS',
                    _requestOtp,
                    key: const Key('signup-otp-button'),
                    loading: _pending,
                  ),
                ] else ...[
                  TextField(
                    key: const Key('signup-code-field'),
                    controller: _codeController,
                    enabled: !_pending,
                    keyboardType: TextInputType.number,
                    maxLength: 6,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    decoration: InputDecoration(
                      labelText: s.isEn ? 'SMS code (6 digits)' : 'Code SMS (6 chiffres)',
                      counterText: '',
                      filled: true,
                      fillColor: Colors.white,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(18),
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    key: const Key('signup-pin-field'),
                    controller: _pinController,
                    enabled: !_pending,
                    obscureText: true,
                    keyboardType: TextInputType.number,
                    maxLength: 6,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    decoration: InputDecoration(
                      labelText: s.pinLabel,
                      counterText: '',
                      filled: true,
                      fillColor: Colors.white,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(18),
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    key: const Key('signup-device-field'),
                    controller: _deviceNameController,
                    enabled: !_pending,
                    decoration: InputDecoration(
                      labelText: s.isEn ? 'Device name' : 'Nom de l’appareil',
                      filled: true,
                      fillColor: Colors.white,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(18),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Checkbox(
                        key: const Key('signup-terms-checkbox'),
                        value: _acceptedTerms,
                        activeColor: orange,
                        onChanged: _pending
                            ? null
                            : (v) => setState(() => _acceptedTerms = v ?? false),
                      ),
                      Expanded(child: Text(s.termsAcceptLabel, style: type(13))),
                    ],
                  ),
                  if (_formError != null) ...[
                    Text(_formError!, style: type(12, color: dangerInk)),
                    const SizedBox(height: 8),
                  ],
                  const SizedBox(height: 12),
                  Primary(
                    title,
                    _completeSignup,
                    key: const Key('signup-submit-button'),
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
