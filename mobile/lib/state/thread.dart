import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/generated/models.dart';
import 'auth.dart';
import 'providers.dart';

/// スレッド画面のデータ。
///
/// 親が論理削除されている場合も返信は残す。UI は親の位置へプレースホルダを出す
/// （design.md D23）。
class ThreadNotifier extends AsyncNotifier<Thread> {
  ThreadNotifier(this.rootPostId);

  final String rootPostId;

  @override
  Future<Thread> build() async {
    final signedIn = ref.watch(authControllerProvider.select((s) => s.value?.signedIn ?? false));
    if (!signedIn) {
      throw StateError('サインインしていません');
    }
    return _fetch();
  }

  /// 取得だけを切り出す。[build] を直接呼ぶと watch が再ビルドを誘発する。
  Future<Thread> _fetch() => ref.read(apiProvider).getThread(rootPostId);

  Future<void> reload() async {
    state = await AsyncValue.guard(_fetch);
  }

  void appendLocally(Post reply) {
    final current = state.value;
    if (current == null) return;
    state = AsyncData(Thread(root: current.root, replies: [...current.replies, reply]));
  }

  void replaceLocally(Post post) {
    final current = state.value;
    if (current == null) return;
    state = AsyncData(
      Thread(
        root: current.root.id == post.id ? post : current.root,
        replies: [
          for (final reply in current.replies)
            if (reply.id == post.id) post else reply,
        ],
      ),
    );
  }

  /// スレッド内の返信が削除されたらプレースホルダを出さずに取り除く（D23）。
  void removeReplyLocally(String postId) {
    final current = state.value;
    if (current == null) return;
    state = AsyncData(
      Thread(
        root: current.root,
        replies: current.replies.where((reply) => reply.id != postId).toList(),
      ),
    );
  }
}

final threadProvider =
    AsyncNotifierProvider.family<ThreadNotifier, Thread, String>(ThreadNotifier.new);

/// 表示中のスレッド。null ならスレッド画面を出さない。
final openThreadProvider = NotifierProvider<OpenThreadNotifier, String?>(OpenThreadNotifier.new);

class OpenThreadNotifier extends Notifier<String?> {
  @override
  String? build() => null;

  void open(String rootPostId) => state = rootPostId;

  void close() => state = null;
}
