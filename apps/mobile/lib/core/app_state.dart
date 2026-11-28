import 'dart:async';

import 'package:flutter/foundation.dart';

import 'api_client.dart';
import 'device_key.dart';
import 'models.dart';
import 'money.dart';

final class FavoriteDelta {
  const FavoriteDelta({required this.isDown, required this.amount});
  final bool isDown;
  final MoneyXaf amount;
}

/// État applicatif léger (session en mémoire, langue FR/EN, accessibilité, ville).
class AppState extends ChangeNotifier {
  AppState({required this.api, this.deviceKeys, String initialLocale = 'fr'})
    : _locale = initialLocale {
    api.onUpgradeRequired = _markUpgradeRequired;
  }

  final MoloPayApiClient api;

  /// Clé d'appareil de la plateforme (D71, D90) ; `null` : inscription et connexion indisponibles.
  final DeviceKeyProvider? deviceKeys;

  String _locale;
  bool _reduceMotion = false;
  bool _soberEffects = false;
  City? _selectedCity;
  SessionSummary? _session;
  bool _upgradeRequired = false;
  final Map<String, MoneyXaf> _favorites = <String, MoneyXaf>{};

  bool isFavorite(String offerId) => _favorites.containsKey(offerId);
  Iterable<String> get favoriteOfferIds => _favorites.keys;

  void toggleFavorite(Offer offer) {
    if (_favorites.containsKey(offer.offerId)) { _favorites.remove(offer.offerId); }
    else { _favorites[offer.offerId] = offer.priceXaf; }
    notifyListeners();
  }

  FavoriteDelta? favoritePriceDelta(Offer live) {
    final added = _favorites[live.offerId];
    if (added == null || added == live.priceXaf) return null;
    final diff = live.priceXaf.amount < added.amount ? added.amount - live.priceXaf.amount : live.priceXaf.amount - added.amount;
    return FavoriteDelta(isDown: live.priceXaf.amount < added.amount, amount: MoneyXaf.fromBigInt(diff));
  }

  /// SEC-MOB-005 : le serveur refuse cette version ; l'application n'offre plus que la mise à jour.
  bool get upgradeRequired => _upgradeRequired;

  void _markUpgradeRequired() {
    _session = null;
    if (_upgradeRequired) return;
    _upgradeRequired = true;
    notifyListeners();
  }

  String get locale => _locale;
  bool get reduceMotion => _reduceMotion;
  bool get soberEffects => _soberEffects;
  City? get selectedCity => _selectedCity;
  SessionSummary? get session => _session;
  bool get isAuthenticated => _session != null && api.hasSession;

  void setLocale(String locale) {
    if (locale != 'fr' && locale != 'en') return;
    if (_locale == locale) return;
    _locale = locale;
    if (isAuthenticated) { unawaited(api.declareLanguage(locale).catchError((_) {})); }
    notifyListeners();
  }

  void setReduceMotion(bool value) {
    if (_reduceMotion == value) return;
    _reduceMotion = value;
    notifyListeners();
  }

  void setSoberEffects(bool value) {
    if (_soberEffects == value) return;
    _soberEffects = value;
    notifyListeners();
  }

  void setCity(City? city) {
    if (_selectedCity == city) return;
    _selectedCity = city;
    notifyListeners();
  }

  /// Connexion D71 : défi de l'appareil enrôlé, signé par sa clé, puis PIN.
  /// Sans clé d'appareil enrôlée : [StateError] (l'écran l'affiche sans rien envoyer).
  Future<SessionSummary> signInWithDevice({required String pin}) async {
    final key = await deviceKeys?.enrolled();
    if (key == null) {
      throw StateError('DEVICE_KEY_MISSING');
    }
    final challenge = await api.requestDeviceChallenge(deviceId: key.deviceId);
    final message = deviceChallengeMessage(
      DeviceChallengePurpose.login,
      challenge.challengeId,
      key.deviceId,
      challenge.challenge,
    );
    final result = await api.signInWithDevice(
      challengeId: challenge.challengeId,
      deviceId: key.deviceId,
      signature: await key.sign(message),
      pin: pin,
    );
    final summary = SessionSummary.fromLogin(result, locale: _locale);
    _session = summary;
    unawaited(api.declareLanguage(_locale).catchError((_) {}));
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
