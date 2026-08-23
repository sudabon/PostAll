import 'package:dio/dio.dart';
import 'package:flutter_web_auth_2/flutter_web_auth_2.dart';

import 'pkce.dart';

/// サインインを中断した、または Hosted UI がエラーを返した。
class SignInCancelled implements Exception {
  const SignInCancelled([this.message = 'サインインが中断されました']);

  final String message;

  @override
  String toString() => message;
}

class SignInFailure implements Exception {
  const SignInFailure(this.message);

  final String message;

  @override
  String toString() => message;
}

/// Cognito Hosted UI との受け渡し（design.md D20）。
///
/// iOS は `ASWebAuthenticationSession` でカスタムスキームのコールバックを受ける。
class CognitoAuth {
  CognitoAuth({required this.domain, required this.clientId, Dio? dio})
      : _dio = dio ?? Dio();

  static const callbackScheme = 'postall';
  static const redirectUri = '$callbackScheme://auth/callback';
  static const logoutUri = '$callbackScheme://auth/logout';

  final String domain;
  final String clientId;
  final Dio _dio;

  /// Hosted UI を開き、返ってきた認可コードをトークンへ交換する。
  Future<TokenSet> signIn({Future<String> Function(Uri url)? authenticate}) async {
    final pkce = generatePkce();
    final url = authorizeUrl(
      domain: domain,
      clientId: clientId,
      redirectUri: redirectUri,
      challenge: pkce.challenge,
    );

    final String result;
    try {
      result = await (authenticate ?? _authenticate)(url);
    } on Exception catch (error) {
      throw SignInCancelled(error.toString());
    }

    final callback = Uri.parse(result);
    final error = callback.queryParameters['error'];
    if (error != null) {
      throw SignInFailure(callback.queryParameters['error_description'] ?? error);
    }
    final code = callback.queryParameters['code'];
    if (code == null || code.isEmpty) {
      throw const SignInFailure('認可コードを受け取れませんでした');
    }

    return _token({
      'grant_type': 'authorization_code',
      'client_id': clientId,
      'redirect_uri': redirectUri,
      'code': code,
      'code_verifier': pkce.verifier,
    });
  }

  Future<TokenSet> refresh(String refreshToken) => _token({
        'grant_type': 'refresh_token',
        'client_id': clientId,
        'refresh_token': refreshToken,
      });

  /// Hosted UI 側のセッションも落とす。失敗しても端末側の破棄は続行する。
  Future<void> signOut({Future<String> Function(Uri url)? authenticate}) async {
    final url = logoutUrl(domain: domain, clientId: clientId, logoutUri: logoutUri);
    try {
      await (authenticate ?? _authenticate)(url);
    } on Exception {
      // 中断されても、呼び出し側が端末のトークンを破棄する。
    }
  }

  Future<String> _authenticate(Uri url) => FlutterWebAuth2.authenticate(
        url: url.toString(),
        callbackUrlScheme: callbackScheme,
      );

  Future<TokenSet> _token(Map<String, String> body) async {
    final Response<dynamic> response;
    try {
      response = await _dio.postUri<dynamic>(
        Uri.https(domain, '/oauth2/token'),
        data: body,
        options: Options(
          contentType: Headers.formUrlEncodedContentType,
          validateStatus: (_) => true,
        ),
      );
    } on DioException catch (error) {
      throw SignInFailure(error.message ?? 'Cognito へ接続できません');
    }

    final data = response.data;
    final json = data is Map ? data.cast<String, Object?>() : const <String, Object?>{};
    final status = response.statusCode ?? 0;
    if (status < 200 || status >= 300) {
      throw SignInFailure(
        (json['error_description'] ?? json['error'] ?? 'トークンの取得に失敗しました').toString(),
      );
    }
    return TokenSet.fromTokenResponse(json);
  }
}
