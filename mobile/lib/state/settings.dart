import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// 接続先の設定。
///
/// 既定値は `--dart-define` で差し替えられる。実行中の変更は端末に保存する。
class AppSettings {
  const AppSettings({
    required this.apiBaseUrl,
    required this.cognitoDomain,
    required this.cognitoClientId,
  });

  static const defaults = AppSettings(
    apiBaseUrl: String.fromEnvironment('POSTALL_API_BASE_URL', defaultValue: 'https://memo.sudabon.com'),
    cognitoDomain: String.fromEnvironment('POSTALL_COGNITO_DOMAIN'),
    cognitoClientId: String.fromEnvironment('POSTALL_COGNITO_CLIENT_ID'),
  );

  final String apiBaseUrl;
  final String cognitoDomain;
  final String cognitoClientId;

  /// Hosted UI へ遷移できるだけの設定が揃っているか（design.md D20）。
  bool get canSignIn => cognitoDomain.isNotEmpty && cognitoClientId.isNotEmpty;

  AppSettings copyWith({String? apiBaseUrl, String? cognitoDomain, String? cognitoClientId}) =>
      AppSettings(
        apiBaseUrl: apiBaseUrl ?? this.apiBaseUrl,
        cognitoDomain: cognitoDomain ?? this.cognitoDomain,
        cognitoClientId: cognitoClientId ?? this.cognitoClientId,
      );
}

const _apiBaseUrlKey = 'settings.apiBaseUrl';
const _cognitoDomainKey = 'settings.cognitoDomain';
const _cognitoClientIdKey = 'settings.cognitoClientId';

class SettingsNotifier extends Notifier<AppSettings> {
  @override
  AppSettings build() {
    final prefs = ref.watch(sharedPreferencesProvider);
    return AppSettings(
      apiBaseUrl: prefs.getString(_apiBaseUrlKey) ?? AppSettings.defaults.apiBaseUrl,
      cognitoDomain: prefs.getString(_cognitoDomainKey) ?? AppSettings.defaults.cognitoDomain,
      cognitoClientId: prefs.getString(_cognitoClientIdKey) ?? AppSettings.defaults.cognitoClientId,
    );
  }

  Future<void> update({String? apiBaseUrl, String? cognitoDomain, String? cognitoClientId}) async {
    final next = state.copyWith(
      apiBaseUrl: apiBaseUrl,
      cognitoDomain: cognitoDomain,
      cognitoClientId: cognitoClientId,
    );
    state = next;
    final prefs = ref.read(sharedPreferencesProvider);
    await prefs.setString(_apiBaseUrlKey, next.apiBaseUrl);
    await prefs.setString(_cognitoDomainKey, next.cognitoDomain);
    await prefs.setString(_cognitoClientIdKey, next.cognitoClientId);
  }
}

final settingsProvider = NotifierProvider<SettingsNotifier, AppSettings>(SettingsNotifier.new);

/// main() で実体を読み込んで override する。テストは fake を差し込む。
final sharedPreferencesProvider = Provider<SharedPreferences>(
  (ref) => throw UnimplementedError('sharedPreferencesProvider を override してください'),
);
