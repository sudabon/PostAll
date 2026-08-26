import 'dart:async';

import 'package:supabase/supabase.dart';

/// `postall:events` の private broadcast を購読する。
///
/// 通知は合図だけなので、受信したら `GET /v1/events?after=` で差分を取る。
class PostallRealtime {
  PostallRealtime({
    required this.supabaseUrl,
    required this.publishableKey,
    required this.accessToken,
    required this.onSignal,
    required this.onStatus,
  });

  final String supabaseUrl;
  final String publishableKey;
  final String accessToken;
  final void Function() onSignal;
  final void Function(bool subscribed) onStatus;

  SupabaseClient? _client;
  RealtimeChannel? _channel;

  void connect() {
    if (supabaseUrl.isEmpty || publishableKey.isEmpty || accessToken.isEmpty) {
      onStatus(false);
      return;
    }
    final client = SupabaseClient(
      supabaseUrl,
      publishableKey,
      authOptions: const AuthClientOptions(autoRefreshToken: false),
      accessToken: () async => accessToken,
    );
    _client = client;
    unawaited(client.realtime.setAuth(accessToken));
    final channel = client.channel(
      'postall:events',
      opts: const RealtimeChannelConfig(private: true),
    );
    channel.onBroadcast(
      event: 'change',
      callback: (_) => onSignal(),
    );
    channel.subscribe((status, [_]) {
      onStatus(status == RealtimeSubscribeStatus.subscribed);
    });
    _channel = channel;
  }

  Future<void> disconnect() async {
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
