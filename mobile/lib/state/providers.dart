import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/http_postall_api.dart';
import '../api/postall_api.dart';
import 'auth.dart';
import 'settings.dart';

/// アプリ全体が使う API クライアント。widget test はここをフェイクで override する。
final apiProvider = Provider<PostAllApi>((ref) {
  return HttpPostAllApi(
    baseUrl: () => ref.read(settingsProvider).apiBaseUrl,
    token: () => ref.read(authControllerProvider.notifier).accessToken(),
    supabaseUrl: () => ref.read(settingsProvider).supabaseUrl,
    publishableKey: () => ref.read(settingsProvider).supabasePublishableKey,
  );
});

/// プロバイダの失敗を自動で再試行しない。
///
/// Riverpod 3 の既定は `Error` 以外の失敗を最大 10 回まで指数バックオフで
/// 再試行する。API の失敗（[ApiException] / [NetworkException]）もその対象に
/// なるため、既定のままだと画面が読み込み中のまま留まり、
/// 「接続できない旨と再試行手段を表示する」という要件を満たせない。
/// 再試行は各画面の再試行ボタンに任せる。
const Duration? Function(int retryCount, Object error) noAutomaticRetry = _noRetry;

Duration? _noRetry(int retryCount, Object error) => null;
