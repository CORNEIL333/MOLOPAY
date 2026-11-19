import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;

import 'models.dart';
import 'money.dart';
import 'problem.dart';

/// Client HTTP réel vers l'API MoloPay (zéro simulation).
///
/// - Envoie `Origin` et `Idempotency-Key` sur les méthodes mutantes (`POST`).
/// - Conserve le cookie `client_session` uniquement en mémoire (jamais en clair sur disque).
/// - Ne journalise jamais le PIN, l'OTP ni les jetons de session.
class MoloPayApiClient {
  MoloPayApiClient({
    required String baseUrl,
    required this.origin,
    http.Client? httpClient,
  }) : baseUrl = baseUrl.endsWith('/')
           ? baseUrl.substring(0, baseUrl.length - 1)
           : baseUrl,
       _http = httpClient ?? http.Client();

  static const String defaultBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://127.0.0.1:3000',
  );

  static const String defaultOrigin = String.fromEnvironment(
    'API_ORIGIN',
    defaultValue: 'http://127.0.0.1:3000',
  );

  final String baseUrl;
  final String origin;
  final http.Client _http;
  final Random _random = Random.secure();

  String? _sessionCookie;

  bool get hasSession => _sessionCookie != null;

  void clearSession() {
    _sessionCookie = null;
  }

  /// Vérifie la disponibilité de l'API (`GET /health`).
  Future<bool> checkHealth() async {
    final response = await _sendGet('/health');
    return response.statusCode == 200;
  }

  /// Liste les offres publiées (`GET /v1/offers`).
  Future<OfferList> listOffers({
    Universe? universe,
    City? city,
    OfferModel? model,
    MoneyXaf? maxPriceXaf,
    String? partnerId,
  }) async {
    final query = <String, String>{};
    if (universe != null) query['universe'] = universe.apiValue;
    if (city != null) query['city'] = city.apiValue;
    if (model != null) query['model'] = model.apiValue;
    if (maxPriceXaf != null) query['maxPriceXaf'] = maxPriceXaf.toApiString();
    if (partnerId != null && partnerId.isNotEmpty) {
      query['partnerId'] = partnerId;
    }

    final response = await _sendGet('/v1/offers', queryParameters: query);
    return OfferList.fromJson(_decodeJsonObject(response));
  }

  /// Détail d'une offre (`GET /v1/offers/{offerId}`).
  Future<Offer> getOffer(String offerId) async {
    final response = await _sendGet(
      '/v1/offers/${Uri.encodeComponent(offerId)}',
    );
    return Offer.fromJson(_decodeJsonObject(response));
  }

  /// Plans de paiement approuvés (`GET /v1/plans`).
  Future<List<PaymentPlan>> listPlans() async {
    final response = await _sendGet('/v1/plans');
    final map = _decodeJsonObject(response);
    final raw = map['plans'];
    if (raw is! List<Object?>) {
      throw const FormatException('Champ plans attendu.');
    }
    return raw.map((item) {
      if (item is Map<Object?, Object?>) {
        return PaymentPlan.fromJson(
          item.map((k, v) => MapEntry(k.toString(), v)),
        );
      }
      throw const FormatException('Objet plan attendu.');
    }).toList();
  }

  /// Connexion client (`POST /v1/auth/sessions`).
  /// Si la route est fermée (503 / 404 / 501), lève [ApiProblemException] sans simuler de session.
  Future<SessionSummary> signIn({
    required String phone,
    required String pin,
  }) async {
    final response = await _sendPost(
      '/v1/auth/sessions',
      body: {'phone': phone, 'pin': pin},
    );
    _captureSessionCookie(response.headers);
    return SessionSummary.fromJson(_decodeJsonObject(response));
  }

  /// Déconnexion client (`POST /v1/auth/signouts`).
  Future<void> signOut() async {
    try {
      await _sendPost('/v1/auth/signouts', body: const <String, Object?>{});
    } finally {
      clearSession();
    }
  }

  /// Liste les objectifs du client connecté (`GET /v1/goals`).
  Future<GoalList> listGoals() async {
    final response = await _sendGet('/v1/goals', authenticated: true);
    return GoalList.fromJson(_decodeJsonObject(response));
  }

  /// Suivi d'un objectif (`GET /v1/goals/{goalId}`).
  Future<Goal> getGoal(String goalId) async {
    final response = await _sendGet(
      '/v1/goals/${Uri.encodeComponent(goalId)}',
      authenticated: true,
    );
    return Goal.fromJson(_decodeJsonObject(response));
  }

  /// Historique des versements confirmés (`GET /v1/goals/{goalId}/contributions`).
  Future<ContributionList> listContributions(String goalId) async {
    final response = await _sendGet(
      '/v1/goals/${Uri.encodeComponent(goalId)}/contributions',
      authenticated: true,
    );
    return ContributionList.fromJson(_decodeJsonObject(response));
  }

  Future<http.Response> _sendGet(
    String path, {
    Map<String, String>? queryParameters,
    bool authenticated = false,
  }) async {
    final uri = _buildUri(path, queryParameters);
    final headers = <String, String>{
      'accept': 'application/json',
      if (authenticated) 'cache-control': 'no-store',
      'cookie': ?_sessionCookie,
    };
    try {
      final response = await _http.get(uri, headers: headers);
      _ensureSuccess(response);
      return response;
    } on ApiProblemException {
      rethrow;
    } on http.ClientException catch (error) {
      throw ApiProblemException(ApiProblem.network(detail: error.message));
    } catch (_) {
      throw ApiProblemException(ApiProblem.network());
    }
  }

  Future<http.Response> _sendPost(
    String path, {
    required Map<String, Object?> body,
  }) async {
    final uri = _buildUri(path, null);
    final headers = <String, String>{
      'accept': 'application/json',
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'origin': origin,
      'idempotency-key': _generateUuidV4(),
      'cookie': ?_sessionCookie,
    };
    try {
      final response = await _http.post(
        uri,
        headers: headers,
        body: jsonEncode(body),
      );
      _ensureSuccess(response);
      return response;
    } on ApiProblemException {
      rethrow;
    } on http.ClientException catch (error) {
      throw ApiProblemException(ApiProblem.network(detail: error.message));
    } catch (_) {
      throw ApiProblemException(ApiProblem.network());
    }
  }

  Uri _buildUri(String path, Map<String, String>? queryParameters) {
    final parsed = Uri.parse('$baseUrl$path');
    if (queryParameters == null || queryParameters.isEmpty) {
      return parsed;
    }
    return parsed.replace(queryParameters: queryParameters);
  }

  void _ensureSuccess(http.Response response) {
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return;
    }
    if (response.statusCode == 401) {
      clearSession();
    }
    throw ApiProblemException(_parseProblem(response));
  }

  ApiProblem _parseProblem(http.Response response) {
    if (response.body.isNotEmpty) {
      try {
        final decoded = jsonDecode(response.body);
        if (decoded is Map<Object?, Object?>) {
          return ApiProblem.fromJson(
            decoded.map((k, v) => MapEntry(k.toString(), v)),
            fallbackStatus: response.statusCode,
          );
        }
      } on FormatException {
        // Réponse non JSON : on renvoie le statut HTTP brut.
      }
    }
    return ApiProblem.fromHttpStatus(response.statusCode);
  }

  Map<String, Object?> _decodeJsonObject(http.Response response) {
    final decoded = jsonDecode(response.body);
    if (decoded is Map<Object?, Object?>) {
      return decoded.map((k, v) => MapEntry(k.toString(), v));
    }
    throw ApiProblemException(
      ApiProblem.fromHttpStatus(
        response.statusCode,
        detail: 'Réponse JSON inattendue.',
      ),
    );
  }

  void _captureSessionCookie(Map<String, String> headers) {
    final rawSetCookie = headers['set-cookie'];
    if (rawSetCookie == null || rawSetCookie.isEmpty) return;
    final match = RegExp(r'client_session=([^;,\s]+)').firstMatch(rawSetCookie);
    if (match != null) {
      _sessionCookie = 'client_session=${match.group(1)}';
    }
  }

  String _generateUuidV4() {
    final bytes = List<int>.generate(16, (_) => _random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
    return '${hex.substring(0, 8)}-'
        '${hex.substring(8, 12)}-'
        '${hex.substring(12, 16)}-'
        '${hex.substring(16, 20)}-'
        '${hex.substring(20, 32)}';
  }

  void dispose() {
    _http.close();
  }
}
