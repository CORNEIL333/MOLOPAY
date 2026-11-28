/// Représentation d'une erreur RFC 9457 (`application/problem+json`) renvoyée par l'API
/// ou d'une indisponibilité réseau lisible côté interface.
final class ApiProblem {
  const ApiProblem({
    required this.type,
    required this.title,
    required this.status,
    required this.code,
    this.detail,
    this.instance,
    this.isNetworkError = false,
  });

  final String type;
  final String title;
  final int status;
  final String code;
  final String? detail;
  final String? instance;
  final bool isNetworkError;

  factory ApiProblem.network({String? detail}) {
    return ApiProblem(
      type: 'about:blank',
      title: 'Connexion impossible',
      status: 0,
      code: 'NETWORK_UNAVAILABLE',
      detail: detail,
      isNetworkError: true,
    );
  }

  factory ApiProblem.fromJson(
    Map<String, Object?> json, {
    required int fallbackStatus,
  }) {
    final rawStatus = json['status'];
    final status = rawStatus is int ? rawStatus : fallbackStatus;
    final rawCode = json['code'];
    final code = rawCode is String && rawCode.isNotEmpty
        ? rawCode
        : _defaultCodeForStatus(status);
    final rawTitle = json['title'];
    final title = rawTitle is String && rawTitle.isNotEmpty
        ? rawTitle
        : _defaultTitleForStatus(status);
    final rawType = json['type'];
    final type = rawType is String && rawType.isNotEmpty
        ? rawType
        : 'about:blank';
    final rawDetail = json['detail'];
    final detail = rawDetail is String && rawDetail.isNotEmpty
        ? rawDetail
        : null;
    final rawInstance = json['instance'];
    final instance = rawInstance is String && rawInstance.isNotEmpty
        ? rawInstance
        : null;

    return ApiProblem(
      type: type,
      title: title,
      status: status,
      code: code,
      detail: detail,
      instance: instance,
    );
  }

  factory ApiProblem.fromHttpStatus(int status, {String? detail}) {
    return ApiProblem(
      type: 'about:blank',
      title: _defaultTitleForStatus(status),
      status: status,
      code: _defaultCodeForStatus(status),
      detail: detail,
    );
  }

  static String _defaultCodeForStatus(int status) {
    return switch (status) {
      400 => 'BAD_REQUEST',
      401 => 'UNAUTHORIZED',
      403 => 'FORBIDDEN',
      404 => 'NOT_FOUND',
      409 => 'CONFLICT',
      422 => 'UNPROCESSABLE_ENTITY',
      426 => 'CLIENT_UPGRADE_REQUIRED',
      429 => 'RATE_LIMITED',
      501 => 'NOT_IMPLEMENTED',
      503 => 'SERVICE_UNAVAILABLE',
      _ => 'HTTP_$status',
    };
  }

  static String _defaultTitleForStatus(int status) {
    return switch (status) {
      401 => 'Authentification requise',
      403 => 'Accès refusé',
      404 => 'Ressource indisponible',
      426 => 'Mise à jour requise',
      429 => 'Trop de tentatives',
      501 || 503 => 'Service indisponible',
      _ => 'Erreur serveur ($status)',
    };
  }

  bool get isUnauthorized => status == 401 || code == 'UNAUTHORIZED';

  /// SEC-MOB-005 : application trop ancienne, mise à jour exigée par le serveur.
  bool get isUpgradeRequired =>
      status == 426 || code == 'CLIENT_UPGRADE_REQUIRED';

  bool get isServiceUnavailable =>
      status == 503 || status == 501 || code == 'SERVICE_UNAVAILABLE';
}

final class ApiProblemException implements Exception {
  const ApiProblemException(this.problem);

  final ApiProblem problem;

  @override
  String toString() =>
      'ApiProblemException(${problem.status} ${problem.code}): ${problem.title}';
}
