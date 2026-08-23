import 'generated/models.dart';

/// API がエラー応答を返したときに投げる。
///
/// バックエンドは全てのエラーを `Error`（code / message / details）で返す
/// （api/openapi.yaml の components.responses.Error）。
class ApiException implements Exception {
  ApiException(this.statusCode, this.code, this.message, {this.details});

  factory ApiException.fromBody(int statusCode, Object? body) {
    if (body is Map<String, Object?> && body['code'] is String && body['message'] is String) {
      final error = Error.fromJson(body);
      return ApiException(
        statusCode,
        error.code,
        error.message,
        details: error.details,
      );
    }
    return ApiException(statusCode, 'http_error', 'HTTP $statusCode');
  }

  final int statusCode;
  final String code;
  final String message;
  final Map<String, dynamic>? details;

  /// 認証が切れている（再サインインが必要）。
  bool get isUnauthorized => statusCode == 401;

  /// 同一階層での名前衝突。チャネルの作成・リネーム・移動で使う。
  bool get isConflict => statusCode == 409;

  @override
  String toString() => 'ApiException($statusCode, $code): $message';
}

/// バックエンドへ到達できない（オフライン、DNS 失敗、タイムアウト）。
class NetworkException implements Exception {
  NetworkException(this.message);

  final String message;

  @override
  String toString() => 'NetworkException: $message';
}
