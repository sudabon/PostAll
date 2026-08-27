import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/cognito.dart';
import '../auth/pkce.dart';
import '../auth/token_store.dart';
import 'settings.dart';

class AuthState {
  const AuthState({this.tokens, this.busy = false, this.error});

  final TokenSet? tokens;
  final bool busy;
  final String? error;

  bool get signedIn => (tokens?.accessToken ?? '').isNotEmpty;

  AuthState copyWith({
    TokenSet? tokens,
    bool? busy,
    String? error,
    bool clearTokens = false,
    bool clearError = false,
  }) =>
      AuthState(
        tokens: clearTokens ? null : (tokens ?? this.tokens),
        busy: busy ?? this.busy,
        error: clearError ? null : (error ?? this.error),
      );
}

/// サインイン状態と、API 呼び出しへ渡すアクセストークンの供給元。
class AuthController extends AsyncNotifier<AuthState> {
  @override
  Future<AuthState> build() async {
    final tokens = await ref.watch(tokenStoreProvider).read();
    return AuthState(tokens: tokens);
  }

  SupabaseAuth _auth() {
    final settings = ref.read(settingsProvider);
    return ref.read(supabaseAuthFactoryProvider)(settings);
  }

  Future<void> signIn() async {
    final settings = ref.read(settingsProvider);
    if (!settings.canSignIn) {
      state = AsyncData(_value.copyWith(error: 'Supabase の接続設定が未入力です'));
      return;
    }
    state = AsyncData(_value.copyWith(busy: true, clearError: true));
    try {
      final tokens = await _auth().signIn();
      await ref.read(tokenStoreProvider).write(tokens);
      state = AsyncData(AuthState(tokens: tokens));
    } on SignInCancelled {
      state = AsyncData(_value.copyWith(busy: false, clearError: true));
    } on Exception catch (error) {
      state = AsyncData(_value.copyWith(busy: false, error: _message(error)));
    }
  }

  Future<void> signOut() async {
    final settings = ref.read(settingsProvider);
    state = AsyncData(_value.copyWith(busy: true, clearError: true));
    if (settings.canSignIn) {
      await _auth().signOut(accessToken: _value.tokens?.accessToken);
    }
    await ref.read(tokenStoreProvider).clear();
    state = const AsyncData(AuthState());
  }

  /// 有効なアクセストークンを返す。失効していれば更新し、更新できなければ
  /// サインアウト扱いにする（authentication spec「更新に失敗する」）。
  Future<String?> accessToken() async {
    final current = _value.tokens;
    if (current == null) return null;
    if (current.isFresh()) return current.accessToken;

    final settings = ref.read(settingsProvider);
    final refreshToken = current.refreshToken;
    if (refreshToken == null || !settings.canSignIn) {
      await _forgetTokens();
      return null;
    }
    try {
      final refreshed = await _auth().refresh(refreshToken);
      // GoTrue は refresh_token を返さないことがあるため、手元の値を残す。
      final merged = TokenSet(
        accessToken: refreshed.accessToken,
        idToken: refreshed.idToken ?? current.idToken,
        refreshToken: refreshed.refreshToken ?? refreshToken,
        expiresAt: refreshed.expiresAt,
      );
      await ref.read(tokenStoreProvider).write(merged);
      state = AsyncData(_value.copyWith(tokens: merged));
      return merged.accessToken;
    } on TokenRequestFailure catch (error) {
      if (error.status == 400 || error.status == 401) {
        await _forgetTokens();
      }
      return null;
    } on Exception {
      return null;
    }
  }

  /// 401 を受けたときに呼ぶ。未送信の入力は UI 側が保持する。
  Future<void> handleUnauthorized() => _forgetTokens();

  Future<void> _forgetTokens() async {
    await ref.read(tokenStoreProvider).clear();
    state = const AsyncData(AuthState(error: 'サインインの有効期限が切れました。再度サインインしてください'));
  }

  AuthState get _value => state.value ?? const AuthState();

  static String _message(Exception error) => switch (error) {
        SignInFailure(:final message) => message,
        _ => 'サインインに失敗しました',
      };
}

final authControllerProvider =
    AsyncNotifierProvider<AuthController, AuthState>(AuthController.new);

final tokenStoreProvider = Provider<TokenStore>((ref) => KeychainTokenStore());

/// テストで認可画面を差し替えられるようにする。
final supabaseAuthFactoryProvider = Provider<SupabaseAuth Function(AppSettings)>(
  (ref) => (settings) => SupabaseAuth(
        supabaseUrl: settings.supabaseUrl,
        publishableKey: settings.supabasePublishableKey,
      ),
);
