import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/change_events.dart';
import '../api/generated/models.dart';
import 'auth.dart';
import 'channels.dart';
import 'connection.dart';
import 'providers.dart';
import 'thread.dart';
import 'timeline.dart';

const _firstReconnectDelay = Duration(seconds: 1);
const _maxReconnectDelay = Duration(seconds: 30);

/// SSE の購読と、切断中に発生した差分の取り込み（design.md D13）。
///
/// iOS はバックグラウンドで接続が切れるため、SSE を唯一の同期手段にしない。
/// 復帰時は `GET /v1/events?after=` でまとめて取り直す。
class ChangeSync {
  ChangeSync(this._ref) {
    _lifecycle = AppLifecycleListener(onResume: resume);
  }

  final Ref _ref;
  late final AppLifecycleListener _lifecycle;

  StreamSubscription<ChangeEvent>? _subscription;
  Timer? _reconnectTimer;
  Duration _reconnectDelay = _firstReconnectDelay;
  String? _lastEventId;
  bool _stopped = false;
  bool _recovering = false;

  /// 直近に取り込んだイベント ID。テストと表示のために公開する。
  String? get lastEventId => _lastEventId;

  void start() {
    _stopped = false;
    _connect();
  }

  /// 購読と再接続タイマーを止める。二重に呼んでも安全。
  void dispose() {
    if (_stopped) return;
    _stopped = true;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    unawaited(_subscription?.cancel());
    _subscription = null;
    _lifecycle.dispose();
  }

  /// バックグラウンドから戻ったとき、差分を取り込んでから購読し直す
  /// （mobile-shell spec「復帰時に差分を取得する」）。
  Future<void> resume() async {
    if (_stopped) return;
    await _subscription?.cancel();
    _subscription = null;
    final recovered = await _recover();
    if (recovered) _connect();
  }

  void _connect() {
    if (_stopped) return;
    _reconnectTimer?.cancel();
    final api = _ref.read(apiProvider);
    _subscription = api.streamEvents(lastEventId: _lastEventId).listen(
      (event) {
        _ref.read(connectionProvider.notifier).set(BackendConnection.online);
        _reconnectDelay = _firstReconnectDelay;
        _apply(event);
      },
      onError: (Object _) => _scheduleReconnect(),
      onDone: _scheduleReconnect,
      cancelOnError: true,
    );
  }

  void _scheduleReconnect() {
    if (_stopped) return;
    _subscription = null;
    _ref.read(connectionProvider.notifier).set(BackendConnection.degraded);
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(_reconnectDelay, () async {
      if (await _recover()) _connect();
    });
    final next = _reconnectDelay * 2;
    _reconnectDelay = next > _maxReconnectDelay ? _maxReconnectDelay : next;
  }

  /// 切断中の差分をまとめて取り込む。API へ届かなければ offline にする。
  Future<bool> _recover() async {
    if (_recovering || _stopped) return false;
    _recovering = true;
    try {
      final api = _ref.read(apiProvider);
      var cursor = _lastEventId ?? '0';
      while (!_stopped) {
        final page = await api.listEvents(after: cursor, limit: 200);
        for (final event in page.events) {
          _apply(event);
        }
        cursor = page.nextAfter;
        if (!page.hasMore) break;
      }
      _lastEventId = cursor;
      _ref.read(connectionProvider.notifier).set(BackendConnection.degraded);
      return true;
    } on Object {
      _ref.read(connectionProvider.notifier).set(BackendConnection.offline);
      return false;
    } finally {
      _recovering = false;
    }
  }

  /// イベントを表示中のデータへ反映する。ID は単調増加なので巻き戻しは捨てる。
  void _apply(ChangeEvent event) {
    final id = BigInt.tryParse(event.id);
    if (id == null) return;
    final seen = _lastEventId == null ? null : BigInt.tryParse(_lastEventId!);
    if (seen != null && id <= seen) return;
    _lastEventId = event.id;

    if (event.eventType.isChannelChange) {
      unawaited(_ref.read(channelsProvider.notifier).reload());
      return;
    }

    final channelId = event.channelId;
    if (channelId != null) {
      unawaited(_ref.read(timelineProvider(channelId).notifier).reload());
    }

    // 返信の増減は親の replyCount にも出るため、スレッドとタイムラインの両方を見る。
    final threadRootId = event.threadRootId ?? event.postId;
    if (threadRootId != null && _ref.read(openThreadProvider) == threadRootId) {
      unawaited(_ref.read(threadProvider(threadRootId).notifier).reload());
    }
  }
}

/// サインイン中だけ購読する。
final changeSyncProvider = Provider<ChangeSync?>((ref) {
  final signedIn = ref.watch(authControllerProvider.select((s) => s.value?.signedIn ?? false));
  if (!signedIn) return null;
  final sync = ChangeSync(ref)..start();
  ref.onDispose(sync.dispose);
  return sync;
});
