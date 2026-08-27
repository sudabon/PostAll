import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';

/// 認可コード + PKCE（design.md D20）の検証子と challenge。
class PkcePair {
  const PkcePair({required this.verifier, required this.challenge});

  final String verifier;
  final String challenge;
}

/// frontend/src/auth/pkce.ts と同じ手順で S256 の組を作る。
PkcePair generatePkce([Random? random]) {
  final source = random ?? Random.secure();
  final bytes = List<int>.generate(32, (_) => source.nextInt(256));
  final verifier = base64UrlEncodeNoPad(bytes);
  final challenge = base64UrlEncodeNoPad(sha256.convert(utf8.encode(verifier)).bytes);
  return PkcePair(verifier: verifier, challenge: challenge);
}

String base64UrlEncodeNoPad(List<int> bytes) =>
    base64Url.encode(bytes).replaceAll('=', '');

/// GoTrue のトークン応答。
class TokenSet {
  const TokenSet({
    required this.accessToken,
    required this.expiresAt,
    this.idToken,
    this.refreshToken,
  });

  factory TokenSet.fromTokenResponse(Map<String, Object?> json, {DateTime? now}) {
    final expiresIn = switch (json['expires_in']) {
      final int value => value,
      final String value => int.tryParse(value) ?? 3600,
      _ => 3600,
    };
    return TokenSet(
      accessToken: json['access_token'] as String? ?? '',
      idToken: json['id_token'] as String?,
      refreshToken: json['refresh_token'] as String?,
      expiresAt: (now ?? DateTime.now()).add(Duration(seconds: expiresIn)),
    );
  }

  factory TokenSet.fromJson(Map<String, Object?> json) => TokenSet(
        accessToken: json['accessToken'] as String? ?? '',
        idToken: json['idToken'] as String?,
        refreshToken: json['refreshToken'] as String?,
        expiresAt: DateTime.parse(json['expiresAt'] as String),
      );

  final String accessToken;
  final String? idToken;
  final String? refreshToken;
  final DateTime expiresAt;

  /// 失効の 60 秒前から更新の対象にする。
  bool isFresh({DateTime? now}) =>
      expiresAt.difference(now ?? DateTime.now()) > const Duration(seconds: 60);

  Map<String, Object?> toJson() => {
        'accessToken': accessToken,
        'idToken': idToken,
        'refreshToken': refreshToken,
        'expiresAt': expiresAt.toIso8601String(),
      };
}

String _trimBase(String supabaseUrl) => supabaseUrl.replaceAll(RegExp(r'/$'), '');

/// GoTrue の認可エンドポイント URL を組み立てる。
Uri authorizeUrl({
  required String supabaseUrl,
  required String redirectUri,
  required String challenge,
  String provider = 'github',
}) =>
    Uri.parse('${_trimBase(supabaseUrl)}/auth/v1/authorize').replace(
      queryParameters: {
        'provider': provider,
        'redirect_to': redirectUri,
        'code_challenge': challenge,
        'code_challenge_method': 'S256',
      },
    );
