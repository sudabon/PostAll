import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'pkce.dart';

/// トークンの保管先。iOS では Keychain を使う（design.md D5、authentication spec）。
abstract class TokenStore {
  Future<TokenSet?> read();
  Future<void> write(TokenSet tokens);
  Future<void> clear();
}

class KeychainTokenStore implements TokenStore {
  KeychainTokenStore({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
              iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock_this_device),
            );

  static const _key = 'auth.tokens';

  final FlutterSecureStorage _storage;

  @override
  Future<TokenSet?> read() async {
    final raw = await _storage.read(key: _key);
    if (raw == null || raw.isEmpty) return null;
    try {
      return TokenSet.fromJson(jsonDecode(raw) as Map<String, Object?>);
    } on FormatException {
      // 壊れた値を持ち回らない。再サインインさせる。
      await clear();
      return null;
    }
  }

  @override
  Future<void> write(TokenSet tokens) => _storage.write(key: _key, value: jsonEncode(tokens.toJson()));

  @override
  Future<void> clear() => _storage.delete(key: _key);
}

/// テストと、Keychain を持たない実行環境向け。
class InMemoryTokenStore implements TokenStore {
  InMemoryTokenStore([this._tokens]);

  TokenSet? _tokens;

  @override
  Future<TokenSet?> read() async => _tokens;

  @override
  Future<void> write(TokenSet tokens) async => _tokens = tokens;

  @override
  Future<void> clear() async => _tokens = null;
}
