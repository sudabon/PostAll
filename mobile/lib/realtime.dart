import 'dart:async';
import 'dart:developer' as developer;

import 'package:supabase/supabase.dart';

abstract interface class RealtimeConnection {
  void connect();
  Future<void> disconnect();
}

/// `postall:events` の private broadcast を購読する。
///
/// 通知は合図だけなので、受信したら `GET /v1/events?after=` で差分を取る。
class PostallRealtime implements RealtimeConnection {
  PostallRealtime({
    required this.supabaseUrl,
    required this.publishableKey,
    this.accessToken = '',
    Future<String?> Function()? accessTokenProvider,
    required this.onSignal,
    required this.onStatus,
  }) : _accessTokenProvider = accessTokenProvider ?? (() async => accessToken);

  final String supabaseUrl;
  final String publishableKey;
  final String accessToken;
  final Future<String?> Function() _accessTokenProvider;
  final void Function() onSignal;
  final void Function(bool subscribed) onStatus;

  SupabaseClient? _client;
  RealtimeChannel? _channel;
  int _generation = 0;

  @override
  void connect() {
    final generation = ++_generation;
    unawaited(_connect(generation));
  }

  Future<void> _connect(int generation) async {
    try {
      if (supabaseUrl.isEmpty || publishableKey.isEmpty) {
        onStatus(false);
        return;
      }
      final String? initialToken;
      try {
        initialToken = await _accessTokenProvider();
      } on Object {
        if (generation == _generation) onStatus(false);
        return;
      }
      if (generation != _generation) return;
      if (initialToken == null || initialToken.isEmpty) {
        onStatus(false);
        return;
      }
      final client = SupabaseClient(
        supabaseUrl,
        publishableKey,
        authOptions: const AuthClientOptions(autoRefreshToken: false),
        accessToken: _accessTokenProvider,
      );
      if (generation != _generation) {
        await client.dispose();
        return;
      }
      _client = client;
      if (generation != _generation) {
        await client.dispose();
        return;
      }
      final channel = client.channel(
        'postall:events',
        opts: const RealtimeChannelConfig(private: true),
      );
      channel.onBroadcast(
        event: 'change',
        callback: (_) {
          if (generation == _generation) onSignal();
        },
      );
      channel.subscribe((status, [_]) {
        if (generation == _generation) {
          onStatus(status == RealtimeSubscribeStatus.subscribed);
        }
      });
      _channel = channel;
    } on Object catch (error, stack) {
      if (generation == _generation) {
        onStatus(false);
        developer.log(
          'postall realtime connect failed: $error',
          name: 'PostallRealtime',
          error: error,
          stackTrace: stack,
        );
      }
    }
  }

  @override
  Future<void> disconnect() async {
    _generation++;
    final client = _client;
    final channel = _channel;
    _channel = null;
    _client = null;
    if (client == null) return;
    if (channel != null) {
      await client.removeChannel(channel);
    }
    await client.dispose();
  }
}
