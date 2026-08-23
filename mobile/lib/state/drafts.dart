import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'settings.dart';

/// 下書きの持ち主。チャネルとスレッドで別々に持つ
/// （post-composer spec「下書きが混ざらない」）。
class DraftKey {
  const DraftKey.channel(this.id) : isThread = false;
  const DraftKey.thread(this.id) : isThread = true;

  final String id;
  final bool isThread;

  String get storageKey => 'draft.${isThread ? 'thread' : 'channel'}.$id';

  @override
  bool operator ==(Object other) =>
      other is DraftKey && other.id == id && other.isThread == isThread;

  @override
  int get hashCode => Object.hash(id, isThread);
}

/// 未送信の入力。アプリ再起動をまたいで復元する。
class DraftsNotifier extends Notifier<Map<DraftKey, String>> {
  @override
  Map<DraftKey, String> build() => const {};

  String read(DraftKey key) {
    final cached = state[key];
    if (cached != null) return cached;
    return ref.read(sharedPreferencesProvider).getString(key.storageKey) ?? '';
  }

  void write(DraftKey key, String value) {
    state = {...state, key: value};
    final prefs = ref.read(sharedPreferencesProvider);
    if (value.isEmpty) {
      prefs.remove(key.storageKey);
    } else {
      prefs.setString(key.storageKey, value);
    }
  }

  /// 送信が成功したら消す。
  void clear(DraftKey key) => write(key, '');
}

final draftsProvider =
    NotifierProvider<DraftsNotifier, Map<DraftKey, String>>(DraftsNotifier.new);
