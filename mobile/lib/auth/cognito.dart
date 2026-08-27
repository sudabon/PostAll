import 'dart:developer' as developer;

import 'package:dio/dio.dart';
import 'package:flutter_web_auth_2/flutter_web_auth_2.dart';

import 'pkce.dart';

/// サインインを中断した、または認可画面がエラーを返した。
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

class TokenRequestFailure implements Exception {
  const TokenRequestFailure(this.message, {this.status = 0});

  final String message;
  final int status;

  @override
  String toString() => message;
}

/// Supabase Auth（GoTrue）との受け渡し（design.md D20）。
///
/// iOS は `ASWebAuthenticationSession` でカスタムスキームのコールバックを受ける。
class SupabaseAuth {
  SupabaseAuth({
    required this.supabaseUrl,
    required this.publishableKey,
    Dio? dio,
  }) : _dio = dio ?? Dio();

  static const callbackScheme = 'postall';
  static const redirectUri = '$callbackScheme://auth/callback';

  final String supabaseUrl;
  final String publishableKey;
  final Dio _dio;

  /// 認可画面を開き、返ってきた認可コードをトークンへ交換する。
  Future<TokenSet> signIn({Future<String> Function(Uri url)? authenticate}) async {
    final pkce = generatePkce();
    final url = authorizeUrl(
      supabaseUrl: supabaseUrl,
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

    return _token(
      grantType: 'pkce',
      body: {
        'auth_code': code,
        'code_verifier': pkce.verifier,
      },
    );
  }

  Future<TokenSet> refresh(String refreshToken) => _token(
        grantType: 'refresh_token',
        body: {'refresh_token': refreshToken},
      );

  /// サーバ側セッションも落とす。失敗しても端末側の破棄は続行する。
  Future<void> signOut({String? accessToken}) async {
    try {
      final response = await _dio.postUri<dynamic>(
        Uri.parse('${_base()}/auth/v1/logout'),
        options: Options(
          headers: {
            'apikey': publishableKey,
            if (accessToken != null && accessToken.isNotEmpty) 'Authorization': 'Bearer $accessToken',
          },
        ),
      );
      final status = response.statusCode ?? 0;
      if (status < 200 || status >= 300) {
        developer.log('signOut HTTP $status', name: 'SupabaseAuth');
      }
    } on Exception catch (error) {
      developer.log('signOut failed: $error', name: 'SupabaseAuth');
    }
  }

  Future<String> _authenticate(Uri url) => FlutterWebAuth2.authenticate(
        url: url.toString(),
        callbackUrlScheme: callbackScheme,
      );

  Future<TokenSet> _token({
    required String grantType,
    required Map<String, String> body,
  }) async {
    final Response<dynamic> response;
    try {
      response = await _dio.postUri<dynamic>(
        Uri.parse('${_base()}/auth/v1/token?grant_type=$grantType'),
        data: body,
        options: Options(
          contentType: Headers.jsonContentType,
          headers: {'apikey': publishableKey},
          validateStatus: (_) => true,
        ),
      );
    } on DioException catch (error) {
      throw TokenRequestFailure(error.message ?? 'Supabase Auth へ接続できません', status: error.response?.statusCode ?? 0);
    }

    final data = response.data;
    final json = data is Map ? data.cast<String, Object?>() : const <String, Object?>{};
    final status = response.statusCode ?? 0;
    if (status < 200 || status >= 300) {
      throw TokenRequestFailure(
        (json['error_description'] ?? json['error'] ?? json['msg'] ?? 'トークンの取得に失敗しました').toString(),
        status: status,
      );
    }
    final tokens = TokenSet.fromTokenResponse(json);
    if (tokens.accessToken.isEmpty) {
      throw TokenRequestFailure('access_token が空です', status: status);
    }
    return tokens;
  }

  String _base() => supabaseUrl.replaceAll(RegExp(r'/$'), '');
}
