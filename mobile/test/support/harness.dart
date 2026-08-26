import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:postall/api/generated/models.dart';
import 'package:postall/auth/pkce.dart';
import 'package:postall/auth/token_store.dart';
import 'package:postall/state/auth.dart';
import 'package:postall/state/providers.dart';
import 'package:postall/state/settings.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fake_api.dart';

/// テスト用の固定 ID。読みやすさのため UUID の形だけ守る。
String testId(int n) =>
    '00000000-0000-4000-8000-${n.toString().padLeft(12, '0')}';

Channel channel(int n, {String? name, String? parentId, String? sortKey}) =>
    Channel(
      id: testId(n),
      parentId: parentId,
      name: name ?? 'channel$n',
      sortKey: sortKey ?? 'm$n',
      createdAt: DateTime.utc(2026, 1, 1),
      updatedAt: DateTime.utc(2026, 1, 1),
    );

Post post(
  int n, {
  required String channelId,
  String? body,
  DateTime? createdAt,
  String? threadRootId,
  int replyCount = 0,
  bool deleted = false,
  List<Attachment>? attachments,
  List<Reaction>? reactions,
}) => Post(
  id: testId(n),
  channelId: channelId,
  threadRootId: threadRootId,
  authorId: 'author',
  body: body ?? 'post $n',
  createdAt: createdAt ?? DateTime.utc(2026, 3, 1, 9, n % 60),
  updatedAt: createdAt ?? DateTime.utc(2026, 3, 1, 9, n % 60),
  deleted: deleted,
  replyCount: replyCount,
  attachments: attachments,
  reactions: reactions,
);

Attachment attachment(int n, {required String fileName, String? postId}) =>
    Attachment(
      id: testId(n),
      postId: postId,
      fileName: fileName,
      contentType: 'image/png',
      sizeBytes: 1,
      checksum: 'checksum-$n',
      createdAt: DateTime.utc(2026, 3, 1),
    );

/// サインイン済みのトークン。
TokenSet signedInTokens() => TokenSet(
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: DateTime.now().add(const Duration(hours: 1)),
);

/// アプリの一部をテスト用の依存で包んで描画する。
///
/// [size] を変えることで、狭幅と広幅のレイアウトを切り替えられる。
Future<ProviderContainer> pumpApp(
  WidgetTester tester, {
  required Widget child,
  required FakeApi api,
  bool signedIn = true,
  Size size = const Size(390, 844),
  Map<String, Object> prefs = const {},
  List<Override> overrides = const [],
}) async {
  SharedPreferences.setMockInitialValues(prefs);
  final preferences = await SharedPreferences.getInstance();

  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  final container = ProviderContainer(
    // 本番と同じく自動再試行はしない。
    retry: noAutomaticRetry,
    overrides: [
      sharedPreferencesProvider.overrideWithValue(preferences),
      apiProvider.overrideWithValue(api),
      tokenStoreProvider.overrideWithValue(
        InMemoryTokenStore(signedIn ? signedInTokens() : null),
      ),
      ...overrides,
    ],
  );
  addTearDown(container.dispose);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(home: child),
    ),
  );
  // 不確定インジケータが残ると pumpAndSettle は終わらないので、固定回数だけ進める。
  for (var i = 0; i < 20; i++) {
    await tester.pump();
  }
  return container;
}

/// 設定が揃っている状態（サインインボタンを押せる）。
List<Override> withSupabaseSettings() => [
  settingsProvider.overrideWith(_ConfiguredSettings.new),
];

class _ConfiguredSettings extends SettingsNotifier {
  @override
  AppSettings build() => const AppSettings(
    apiBaseUrl: 'https://example.invalid',
    supabaseUrl: 'https://auth.example.invalid',
    supabasePublishableKey: 'publishable-key',
  );
}
