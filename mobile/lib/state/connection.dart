import 'package:flutter_riverpod/flutter_riverpod.dart';

/// バックエンドとの接続状態。Flutter の ConnectionState と名前が衝突しないようにしてある。
///
/// - [online]: Realtime が繋がっている
/// - [degraded]: API へは届くが Realtime が切れている（復帰時の差分取得で追う）
/// - [offline]: API へ届かない。変更操作を止め、古いデータを最新として見せない
enum BackendConnection { online, degraded, offline }

class ConnectionNotifier extends Notifier<BackendConnection> {
  @override
  BackendConnection build() => BackendConnection.degraded;

  void set(BackendConnection value) {
    if (state != value) state = value;
  }
}

final connectionProvider =
    NotifierProvider<ConnectionNotifier, BackendConnection>(ConnectionNotifier.new);

/// 接続が切れている間は変更操作を受け付けない（sync-and-storage spec）。
class OfflineMutationException implements Exception {
  const OfflineMutationException();

  @override
  String toString() => 'バックエンドへ接続できないため、この操作は実行できません';
}
