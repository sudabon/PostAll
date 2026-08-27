import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// 接続先の設定。
///
/// 既定値は `--dart-define` で差し替えられる。実行中の変更は端末に保存する。
class AppSettings {
  const AppSettings({
    required this.apiBaseUrl,
    required this.supabaseUrl,
    required this.supabasePublishableKey,
  });

  static const defaults = AppSettings(
    apiBaseUrl: String.fromEnvironment('POSTALL_API_BASE_URL', defaultValue: 'https://memo.sudabon.com'),
    supabaseUrl: String.fromEnvironment('POSTALL_SUPABASE_URL'),
    supabasePublishableKey: String.fromEnvironment('POSTALL_SUPABASE_PUBLISHABLE_KEY'),
  );

  final String apiBaseUrl;
  final String supabaseUrl;
  final String supabasePublishableKey;

  /// 認可画面へ遷移できるだけの設定が揃っているか（design.md D20）。
  bool get canSignIn => supabaseUrl.isNotEmpty && supabasePublishableKey.isNotEmpty;

  AppSettings copyWith({
    String? apiBaseUrl,
    String? supabaseUrl,
    String? supabasePublishableKey,
  }) =>
      AppSettings(
        apiBaseUrl: apiBaseUrl ?? this.apiBaseUrl,
        supabaseUrl: supabaseUrl ?? this.supabaseUrl,
        supabasePublishableKey: supabasePublishableKey ?? this.supabasePublishableKey,
      );
}

const _apiBaseUrlKey = 'settings.apiBaseUrl';
const _supabaseUrlKey = 'settings.supabaseUrl';
const _supabasePublishableKeyKey = 'settings.supabasePublishableKey';

class SettingsNotifier extends Notifier<AppSettings> {
  @override
  AppSettings build() {
    final prefs = ref.watch(sharedPreferencesProvider);
    return AppSettings(
      apiBaseUrl: prefs.getString(_apiBaseUrlKey) ?? AppSettings.defaults.apiBaseUrl,
      supabaseUrl: prefs.getString(_supabaseUrlKey) ?? AppSettings.defaults.supabaseUrl,
      supabasePublishableKey:
          prefs.getString(_supabasePublishableKeyKey) ?? AppSettings.defaults.supabasePublishableKey,
    );
  }

  Future<void> update({
    String? apiBaseUrl,
    String? supabaseUrl,
    String? supabasePublishableKey,
  }) async {
    final next = state.copyWith(
      apiBaseUrl: apiBaseUrl,
      supabaseUrl: supabaseUrl,
      supabasePublishableKey: supabasePublishableKey,
    );
    state = next;
    final prefs = ref.read(sharedPreferencesProvider);
    await prefs.setString(_apiBaseUrlKey, next.apiBaseUrl);
    await prefs.setString(_supabaseUrlKey, next.supabaseUrl);
    await prefs.setString(_supabasePublishableKeyKey, next.supabasePublishableKey);
  }
}

final settingsProvider = NotifierProvider<SettingsNotifier, AppSettings>(SettingsNotifier.new);

/// main() で実体を読み込んで override する。テストは fake を差し込む。
final sharedPreferencesProvider = Provider<SharedPreferences>(
  (ref) => throw UnimplementedError('sharedPreferencesProvider を override してください'),
);
