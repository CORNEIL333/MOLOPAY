import 'package:flutter/foundation.dart';

import 'api_client.dart';
import 'models.dart';

/// État applicatif léger (session en mémoire, langue FR/EN, accessibilité, ville).
class AppState extends ChangeNotifier {
  AppState({required this.api, String initialLocale = 'fr'})
    : _locale = initialLocale;

  final MoloPayApiClient api;

  String _locale;
  bool _reduceMotion = false;
  City? _selectedCity;
  SessionSummary? _session;

  String get locale => _locale;
  bool get reduceMotion => _reduceMotion;
  City? get selectedCity => _selectedCity;
  SessionSummary? get session => _session;
  bool get isAuthenticated => _session != null && api.hasSession;

  void setLocale(String locale) {
    if (locale != 'fr' && locale != 'en') return;
    if (_locale == locale) return;
    _locale = locale;
    notifyListeners();
  }

  void setReduceMotion(bool value) {
    if (_reduceMotion == value) return;
    _reduceMotion = value;
    notifyListeners();
  }

  void setCity(City? city) {
    if (_selectedCity == city) return;
    _selectedCity = city;
    notifyListeners();
  }

  Future<SessionSummary> signIn({
    required String phone,
    required String pin,
  }) async {
    final summary = await api.signIn(phone: phone, pin: pin);
    _session = summary;
    if (summary.locale == 'fr' || summary.locale == 'en') {
      _locale = summary.locale;
    }
    notifyListeners();
    return summary;
  }

  Future<void> signOut() async {
    try {
      await api.signOut();
    } finally {
      _session = null;
      notifyListeners();
    }
  }

  void handleUnauthorized() {
    api.clearSession();
    if (_session != null) {
      _session = null;
      notifyListeners();
    }
  }
}
