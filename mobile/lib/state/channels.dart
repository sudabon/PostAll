import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/generated/models.dart';
import '../util/tree.dart';
import 'auth.dart';
import 'providers.dart';
import 'settings.dart';

/// チャネル階層。SSE の channel.* イベントで再取得する。
class ChannelsNotifier extends AsyncNotifier<List<Channel>> {
  @override
  Future<List<Channel>> build() async {
    final signedIn = ref.watch(authControllerProvider.select((s) => s.value?.signedIn ?? false));
    if (!signedIn) return const [];
    return _fetch();
  }

  /// 取得だけを切り出す。[build] を直接呼ぶと watch が再ビルドを誘発する。
  Future<List<Channel>> _fetch() => ref.read(apiProvider).listChannels();

  Future<void> reload() async {
    state = await AsyncValue.guard(_fetch);
  }

  Future<Channel> create({required String name, String? parentId}) async {
    final channel = await ref.read(apiProvider).createChannel(name: name, parentId: parentId);
    await reload();
    return channel;
  }

  Future<void> rename(String id, String name) async {
    await ref.read(apiProvider).renameChannel(id, name);
    await reload();
  }

  Future<void> remove(String id) async {
    await ref.read(apiProvider).deleteChannel(id);
    await reload();
  }

  /// 親の付け替えと並び替え。楽観的に手元を書き換え、失敗したら取り直す。
  ///
  /// 元へ戻す責務をここへ寄せておくことで、呼び出し側は例外を表示するだけでよい
  /// （mobile-shell spec「無効な移動を拒否する」「名前が衝突する移動を拒否する」）。
  Future<void> move(
    String id, {
    String? parentId,
    String? beforeId,
    String? afterId,
    List<Channel>? optimistic,
  }) async {
    final previous = state.value;
    if (optimistic != null) state = AsyncData(optimistic);
    try {
      await ref.read(apiProvider).moveChannel(
            id,
            parentId: parentId,
            beforeId: beforeId,
            afterId: afterId,
          );
      await reload();
    } on Object {
      if (previous != null) state = AsyncData(previous);
      rethrow;
    }
  }
}

final channelsProvider =
    AsyncNotifierProvider<ChannelsNotifier, List<Channel>>(ChannelsNotifier.new);

/// 木に畳んだチャネル階層。
final channelForestProvider = Provider<List<ChannelNode>>((ref) {
  final channels = ref.watch(channelsProvider).value ?? const <Channel>[];
  return buildForest(channels);
});

final channelByIdProvider = Provider.family<Channel?, String>((ref, id) {
  final channels = ref.watch(channelsProvider).value ?? const <Channel>[];
  for (final channel in channels) {
    if (channel.id == id) return channel;
  }
  return null;
});

/// 展開中のチャネル。端末に保存し、再起動しても畳み方を保つ。
class ExpandedChannelsNotifier extends Notifier<Set<String>> {
  static const _key = 'channels.expanded';

  @override
  Set<String> build() =>
      ref.watch(sharedPreferencesProvider).getStringList(_key)?.toSet() ?? <String>{};

  void toggle(String id) {
    final next = {...state};
    if (!next.remove(id)) next.add(id);
    state = next;
    unawaitedSave(next);
  }

  void expand(String id) {
    if (state.contains(id)) return;
    final next = {...state, id};
    state = next;
    unawaitedSave(next);
  }

  void unawaitedSave(Set<String> value) {
    ref.read(sharedPreferencesProvider).setStringList(_key, value.toList());
  }
}

final expandedChannelsProvider =
    NotifierProvider<ExpandedChannelsNotifier, Set<String>>(ExpandedChannelsNotifier.new);

/// 選択中のチャネル。前回開いていたチャネルを起動時に復元する
/// （mobile-shell spec「アプリを起動する」）。
class SelectedChannelNotifier extends Notifier<String?> {
  static const _key = 'channels.selected';

  @override
  String? build() => ref.watch(sharedPreferencesProvider).getString(_key);

  void select(String? id) {
    state = id;
    final prefs = ref.read(sharedPreferencesProvider);
    if (id == null) {
      prefs.remove(_key);
    } else {
      prefs.setString(_key, id);
    }
  }
}

final selectedChannelProvider =
    NotifierProvider<SelectedChannelNotifier, String?>(SelectedChannelNotifier.new);

/// 選択中のチャネルが消えていたら選択を外す（channel-hierarchy spec）。
final resolvedSelectedChannelProvider = Provider<Channel?>((ref) {
  final id = ref.watch(selectedChannelProvider);
  if (id == null) return null;
  return ref.watch(channelByIdProvider(id));
});

/// 狭幅でタイムライン画面をスタックに積んでいるか。
///
/// 「戻る」で閉じても選択自体は残す。選択を消してしまうと、チャネル一覧へ
/// 戻ったときに直前のチャネルを強調表示できない
/// （mobile-shell spec「チャネル一覧へ戻る」）。
class TimelineOpenNotifier extends Notifier<bool> {
  @override
  bool build() => ref.watch(selectedChannelProvider) != null;

  void open() => state = true;

  void close() => state = false;
}

final timelineOpenProvider =
    NotifierProvider<TimelineOpenNotifier, bool>(TimelineOpenNotifier.new);
