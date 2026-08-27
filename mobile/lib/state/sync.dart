import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/change_events.dart';
import '../api/generated/models.dart';
import '../api/postall_api.dart';
import 'auth.dart';
import 'channels.dart';
import 'connection.dart';
import 'providers.dart';
import 'thread.dart';
import 'timeline.dart';

/// Realtime の合図と、切断中に発生した差分の取り込み（design.md D13）。
///
/// iOS はバックグラウンドで接続が切れるため、Realtime を唯一の同期手段にしない。
/// 復帰時は `GET /v1/events?after=` でまとめて取り直す。
class ChangeSync {
  ChangeSync(this._ref);

  final Ref _ref;
  AppLifecycleListener? _lifecycle;

  StreamSubscription<void>? _subscription;
  StreamSubscription<bool>? _statusSubscription;
  Timer? _reconnectTimer;
  bool? _realtimeSubscribed;
  int _connectionGeneration = 0;
  String? _lastEventId;
  bool _stopped = false;
  bool _recovering = false;
  bool _resuming = false;
  Duration _reconnectDelay = _reconnectDelayInitial;

  static const _reconnectDelayInitial = Duration(seconds: 1);
  static const _reconnectDelayMax = Duration(seconds: 30);

  /// 直近に取り込んだイベント ID。テストと表示のために公開する。
  String? get lastEventId => _lastEventId;

  void start() {
    _stopped = false;
    _lifecycle ??= AppLifecycleListener(
      onResume: () {
        if (_stopped) return;
        unawaited(resume());
      },
    );
    _connect();
    unawaited(_recover());
  }

  /// 購読とポーリングを止める。二重に呼んでも安全。
  void dispose() {
    if (_stopped) return;
    _stopped = true;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    _connectionGeneration++;
    unawaited(_subscription?.cancel());
    _subscription = null;
    unawaited(_statusSubscription?.cancel());
    _statusSubscription = null;
    _lifecycle?.dispose();
    _lifecycle = null;
  }

  /// バックグラウンドから戻ったとき、差分を取り込んでから購読し直す
  /// （mobile-shell spec「復帰時に差分を取得する」）。
  Future<void> resume() async {
    if (_stopped || _resuming) return;
    _resuming = true;
    try {
      await _recover();
    } finally {
      _resuming = false;
    }
  }

  void _connect() {
    if (_stopped) return;
    final generation = ++_connectionGeneration;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    unawaited(_subscription?.cancel());
    unawaited(_statusSubscription?.cancel());
    _realtimeSubscribed = null;
    final api = _ref.read(apiProvider);
    final statusSource = api is RealtimeStatusSource
        ? api as RealtimeStatusSource
        : null;
    if (statusSource != null) {
      _statusSubscription = statusSource.watchRealtimeStatus().listen(
        (subscribed) {
          if (_stopped || generation != _connectionGeneration) return;
          _realtimeSubscribed = subscribed;
          if (subscribed) {
            _reconnectDelay = _reconnectDelayInitial;
          }
          if (!subscribed &&
              _ref.read(connectionProvider) == BackendConnection.offline) {
            return;
          }
          _ref
              .read(connectionProvider.notifier)
              .set(
                subscribed
                    ? BackendConnection.online
                    : BackendConnection.degraded,
              );
        },
        onError: (Object _) {
          if (generation == _connectionGeneration) _onDisconnected();
        },
      );
    }
    _subscription = api.watchChangeSignals().listen(
      (_) {
        if (_stopped || generation != _connectionGeneration) return;
        if (_realtimeSubscribed != false) {
          _ref.read(connectionProvider.notifier).set(BackendConnection.online);
        }
        unawaited(_recover());
      },
      onError: (Object _) {
        if (generation == _connectionGeneration) _onDisconnected();
      },
      cancelOnError: true,
    );
  }

  void _onDisconnected() {
    if (_stopped) return;
    _connectionGeneration++;
    _subscription = null;
    unawaited(_statusSubscription?.cancel());
    _statusSubscription = null;
    _realtimeSubscribed = false;
    _ref.read(connectionProvider.notifier).set(BackendConnection.degraded);
    _reconnectTimer?.cancel();
    final delay = _reconnectDelay;
    final nextSeconds = (_reconnectDelay.inSeconds * 2).clamp(
      _reconnectDelayInitial.inSeconds,
      _reconnectDelayMax.inSeconds,
    );
    _reconnectDelay = Duration(seconds: nextSeconds);
    _reconnectTimer = Timer(delay, () {
      if (_stopped) return;
      unawaited(_recover());
      _connect();
    });
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
      _reconnectDelay = _reconnectDelayInitial;
      _ref
          .read(connectionProvider.notifier)
          .set(
            _realtimeSubscribed == true
                ? BackendConnection.online
                : BackendConnection.degraded,
          );
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

    if (event.isSyncWatermark) {
      unawaited(_ref.read(channelsProvider.notifier).reload());
      final selectedChannelId = _ref.read(selectedChannelProvider);
      if (selectedChannelId != null) {
        unawaited(
          _ref.read(timelineProvider(selectedChannelId).notifier).reload(),
        );
      }
      final openThreadId = _ref.read(openThreadProvider);
      if (openThreadId != null) {
        unawaited(_ref.read(threadProvider(openThreadId).notifier).reload());
      }
      return;
    }

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
  final signedIn = ref.watch(
    authControllerProvider.select((s) => s.value?.signedIn ?? false),
  );
  if (!signedIn) return null;
  final sync = ChangeSync(ref)..start();
  ref.onDispose(sync.dispose);
  return sync;
});
