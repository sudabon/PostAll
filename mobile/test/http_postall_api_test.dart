import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:postall/api/http_postall_api.dart';
import 'package:postall/realtime.dart';

void main() {
  test('Realtime reconnect obtains a fresh token', () async {
    final tokens = <String>[];
    final statuses = <bool>[];
    var tokenNumber = 0;
    var connections = 0;
    final reconnected = Completer<void>();
    final api = HttpPostAllApi(
      baseUrl: () => 'https://api.example.invalid',
      token: () async => 'token-${++tokenNumber}',
      supabaseUrl: () => 'https://auth.example.invalid',
      publishableKey: () => 'publishable-key',
      realtimeRetryDelay: (_) => Duration.zero,
      realtimeFactory:
          ({
            required accessTokenProvider,
            required onSignal,
            required onStatus,
          }) {
            final connectionNumber = ++connections;
            return _FakeRealtimeConnection(() async {
              tokens.add((await accessTokenProvider())!);
              onStatus(connectionNumber > 1);
              if (connectionNumber > 1 && !reconnected.isCompleted) {
                reconnected.complete();
              }
            });
          },
    );

    final statusSubscription = api.watchRealtimeStatus().listen(statuses.add);
    final signalSubscription = api.watchChangeSignals().listen((_) {});
    await reconnected.future.timeout(const Duration(seconds: 1));

    expect(tokens, ['token-1', 'token-2']);
    expect(statuses, containsAllInOrder([false, true]));

    await signalSubscription.cancel();
    await statusSubscription.cancel();
  });
}

class _FakeRealtimeConnection implements RealtimeConnection {
  _FakeRealtimeConnection(this._onConnect);

  final Future<void> Function() _onConnect;

  @override
  void connect() {
    unawaited(_onConnect());
  }

  @override
  Future<void> disconnect() async {}
}
