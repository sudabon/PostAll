import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'connection.dart';
import 'providers.dart';

/// 起動時のバックエンド到達確認。
///
/// 接続できない場合は、古いデータを最新であるかのように出さないために
/// チャネルもポストも表示しない（mobile-shell spec「バックエンドへ接続できない」）。
final backendReachableProvider = FutureProvider<bool>((ref) async {
  try {
    await ref.read(apiProvider).getHealth();
    ref.read(connectionProvider.notifier).set(BackendConnection.degraded);
    return true;
  } on Object {
    ref.read(connectionProvider.notifier).set(BackendConnection.offline);
    return false;
  }
});
