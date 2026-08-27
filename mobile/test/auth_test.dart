// authentication spec のうち、iOS クライアントが担う部分。
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:postall/auth/cognito.dart';
import 'package:postall/auth/pkce.dart';
import 'package:postall/auth/token_store.dart';
import 'package:postall/state/auth.dart';
import 'package:postall/state/providers.dart';
import 'package:postall/state/settings.dart';
import 'package:postall/ui/screens/sign_in_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'support/fake_api.dart';
import 'support/harness.dart';

/// 認可画面の代わりに、指定した結果を返す [SupabaseAuth]。
class FakeSupabaseAuth extends SupabaseAuth {
  FakeSupabaseAuth({required this.result})
    : super(supabaseUrl: 'https://auth.invalid', publishableKey: 'key');

  /// 認可コードつきのコールバック URL、または投げる例外。
  final Object result;

  var signInCalls = 0;
  var signOutCalls = 0;
  TokenSet? nextTokens;

  @override
  Future<TokenSet> signIn({
    Future<String> Function(Uri url)? authenticate,
  }) async {
    signInCalls += 1;
    final outcome = result;
    if (outcome is Exception) throw outcome;
    return nextTokens ?? signedInTokens();
  }

  @override
  Future<void> signOut({String? accessToken}) async {
    signOutCalls += 1;
  }
}

Future<ProviderContainer> _authContainer(
  SupabaseAuth auth,
  TokenStore store,
) async {
  SharedPreferences.setMockInitialValues({});
  final prefs = await SharedPreferences.getInstance();
  final container = ProviderContainer(
    retry: noAutomaticRetry,
    overrides: [
      sharedPreferencesProvider.overrideWithValue(prefs),
      apiProvider.overrideWithValue(FakeApi()),
      tokenStoreProvider.overrideWithValue(store),
      supabaseAuthFactoryProvider.overrideWithValue((_) => auth),
      ...withSupabaseSettings(),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

void main() {
  group('Requirement: Supabase Auth によるサインイン', () {
    test('Scenario: サインインに成功する — トークンを Keychain へ保管する', () async {
      final store = InMemoryTokenStore();
      final auth = FakeSupabaseAuth(result: 'ok');
      final container = await _authContainer(auth, store);

      await container.read(authControllerProvider.future);
      await container.read(authControllerProvider.notifier).signIn();

      expect(container.read(authControllerProvider).value!.signedIn, isTrue);
      expect((await store.read())!.accessToken, 'access');
    });

    test('Scenario: サインインに失敗する — 理由を残し、サインインしない', () async {
      final store = InMemoryTokenStore();
      final auth = FakeSupabaseAuth(result: const SignInFailure('招待されていません'));
      final container = await _authContainer(auth, store);

      await container.read(authControllerProvider.future);
      await container.read(authControllerProvider.notifier).signIn();

      final state = container.read(authControllerProvider).value!;
      expect(state.signedIn, isFalse);
      expect(state.error, '招待されていません');
      expect(await store.read(), isNull);
    });

    test('Scenario: 中断は失敗として扱わない', () async {
      final store = InMemoryTokenStore();
      final auth = FakeSupabaseAuth(result: const SignInCancelled());
      final container = await _authContainer(auth, store);

      await container.read(authControllerProvider.future);
      await container.read(authControllerProvider.notifier).signIn();

      final state = container.read(authControllerProvider).value!;
      expect(state.signedIn, isFalse);
      expect(state.error, isNull);
    });

    test('Scenario: サインアウトする — 端末のトークンを破棄する', () async {
      final store = InMemoryTokenStore(signedInTokens());
      final auth = FakeSupabaseAuth(result: 'ok');
      final container = await _authContainer(auth, store);

      await container.read(authControllerProvider.future);
      await container.read(authControllerProvider.notifier).signOut();

      expect(container.read(authControllerProvider).value!.signedIn, isFalse);
      expect(await store.read(), isNull);
      expect(auth.signOutCalls, 1);
    });
  });

  group('Requirement: トークンの更新と失効', () {
    test('Scenario: トークンを更新する — refresh_token を引き継ぐ', () async {
      final expired = TokenSet(
        accessToken: 'old',
        refreshToken: 'refresh',
        expiresAt: DateTime.now().subtract(const Duration(minutes: 1)),
      );
      final store = InMemoryTokenStore(expired);
      final auth = _RefreshingAuth();
      final container = await _authContainer(auth, store);

      await container.read(authControllerProvider.future);
      final token = await container
          .read(authControllerProvider.notifier)
          .accessToken();

      expect(token, 'refreshed');
      // GoTrue は refresh_token を返さないことがあるため、手元の値を残す。
      expect((await store.read())!.refreshToken, 'refresh');
    });

    test('Scenario: 更新に失敗する — サインアウト扱いにする', () async {
      final expired = TokenSet(
        accessToken: 'old',
        refreshToken: 'refresh',
        expiresAt: DateTime.now().subtract(const Duration(minutes: 1)),
      );
      final store = InMemoryTokenStore(expired);
      final auth = _FailingRefreshAuth();
      final container = await _authContainer(auth, store);

      await container.read(authControllerProvider.future);
      final token = await container
          .read(authControllerProvider.notifier)
          .accessToken();

      expect(token, isNull);
      expect(await store.read(), isNull);
      expect(
        container.read(authControllerProvider).value!.error,
        contains('再度サインイン'),
      );
    });

    test('Scenario: 一時的な通信断ではサインアウトしない', () async {
      final expired = TokenSet(
        accessToken: 'old',
        refreshToken: 'refresh',
        expiresAt: DateTime.now().subtract(const Duration(minutes: 1)),
      );
      final store = InMemoryTokenStore(expired);
      final auth = _OfflineRefreshAuth();
      final container = await _authContainer(auth, store);

      await container.read(authControllerProvider.future);
      final token = await container
          .read(authControllerProvider.notifier)
          .accessToken();

      expect(token, isNull);
      // 通信断は失効ではない。リフレッシュトークンを捨てて再サインインを強いない。
      expect((await store.read())!.refreshToken, 'refresh');
    });

    test('有効なトークンは更新せずそのまま使う', () async {
      final store = InMemoryTokenStore(signedInTokens());
      final auth = _RefreshingAuth();
      final container = await _authContainer(auth, store);

      await container.read(authControllerProvider.future);
      final token = await container
          .read(authControllerProvider.notifier)
          .accessToken();

      expect(token, 'access');
      expect(auth.refreshCalls, 0);
    });
  });

  group('サインイン画面', () {
    testWidgets('接続設定が無いとサインインを押せない', (tester) async {
      final api = FakeApi();
      addTearDown(api.dispose);

      await pumpApp(
        tester,
        api: api,
        signedIn: false,
        child: const SignInScreen(),
      );

      final button = tester.widget<FilledButton>(
        find.byKey(const Key('sign-in-button')),
      );
      expect(button.onPressed, isNull);
      expect(find.text('Supabase の接続設定が未入力です'), findsOneWidget);
    });

    testWidgets('接続設定があればサインインを開始できる', (tester) async {
      final api = FakeApi();
      addTearDown(api.dispose);
      final auth = FakeSupabaseAuth(result: 'ok');

      await pumpApp(
        tester,
        api: api,
        signedIn: false,
        child: const SignInScreen(),
        overrides: [
          ...withSupabaseSettings(),
          supabaseAuthFactoryProvider.overrideWithValue((_) => auth),
        ],
      );

      await tester.tap(find.byKey(const Key('sign-in-button')));
      await tester.pumpAndSettle();

      expect(auth.signInCalls, 1);
    });
  });
}

class _RefreshingAuth extends SupabaseAuth {
  _RefreshingAuth()
    : super(supabaseUrl: 'https://auth.invalid', publishableKey: 'key');

  var refreshCalls = 0;

  @override
  Future<TokenSet> refresh(String refreshToken) async {
    refreshCalls += 1;
    return TokenSet(
      accessToken: 'refreshed',
      expiresAt: DateTime.now().add(const Duration(hours: 1)),
    );
  }
}

class _FailingRefreshAuth extends SupabaseAuth {
  _FailingRefreshAuth()
    : super(supabaseUrl: 'https://auth.invalid', publishableKey: 'key');

  @override
  Future<TokenSet> refresh(String refreshToken) async =>
      throw const TokenRequestFailure('refresh token が失効しています', status: 401);
}

class _OfflineRefreshAuth extends SupabaseAuth {
  _OfflineRefreshAuth()
    : super(supabaseUrl: 'https://auth.invalid', publishableKey: 'key');

  @override
  Future<TokenSet> refresh(String refreshToken) async =>
      throw const TokenRequestFailure('Supabase Auth へ接続できません', status: 0);
}
