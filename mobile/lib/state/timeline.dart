import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/generated/models.dart';
import 'auth.dart';
import 'providers.dart';

/// チャネルのタイムライン。古い順に並べ、上方向へ遡って読み足す。
class TimelineState {
  const TimelineState({
    this.posts = const [],
    this.nextBefore,
    this.loadingOlder = false,
  });

  /// 作成日時の昇順。同時刻はポスト ID で安定させる（post-timeline spec）。
  final List<Post> posts;

  /// より古いポストを取るカーソル。null なら履歴の先頭に達している。
  final String? nextBefore;
  final bool loadingOlder;

  bool get atOldest => nextBefore == null;

  TimelineState copyWith({
    List<Post>? posts,
    String? nextBefore,
    bool? loadingOlder,
    bool clearNextBefore = false,
  }) =>
      TimelineState(
        posts: posts ?? this.posts,
        nextBefore: clearNextBefore ? null : (nextBefore ?? this.nextBefore),
        loadingOlder: loadingOlder ?? this.loadingOlder,
      );
}

/// 初期表示は最新 10 件（post-timeline spec）。
const int timelinePageSize = 10;

class TimelineNotifier extends AsyncNotifier<TimelineState> {
  TimelineNotifier(this.channelId);

  final String channelId;

  /// 検索結果から移動するとき、このポストを含む範囲を最初に読む。
  String? _around;

  @override
  Future<TimelineState> build() async {
    final signedIn = ref.watch(authControllerProvider.select((s) => s.value?.signedIn ?? false));
    if (!signedIn) return const TimelineState();
    return _fetch();
  }

  /// 実際の取得。[build] の外から呼ぶため、ここでは [Ref.watch] を使わない。
  ///
  /// build を直接呼び直すと、その中の watch が依存の再登録として扱われて
  /// 再ビルドを誘発するため、取得だけを切り出してある。
  Future<TimelineState> _fetch() async {
    final page = await ref.read(apiProvider).listPosts(
          channelId,
          limit: timelinePageSize,
          around: _around,
        );
    return TimelineState(posts: sortPosts(page.posts), nextBefore: page.nextBefore);
  }

  /// 検索結果のポストが見える位置から読み直す（full-text-search spec）。
  Future<void> focusAround(String postId) async {
    _around = postId;
    try {
      state = await AsyncValue.guard(_fetch);
    } finally {
      _around = null;
    }
  }

  /// 変更通知やポスト操作のあとに、今の範囲を取り直す。
  Future<void> reload() async {
    state = await AsyncValue.guard(_fetch);
  }

  /// 上端に近づいたときに、より古いポストを先頭へ足す。
  ///
  /// 進行中は [TimelineState.loadingOlder] を立てて多重要求を防ぐ
  /// （post-timeline spec「連続したスクロールで多重要求しない」）。
  Future<void> loadOlder() async {
    final current = state.value;
    if (current == null || current.loadingOlder || current.nextBefore == null) return;

    state = AsyncData(current.copyWith(loadingOlder: true));
    try {
      final page = await ref.read(apiProvider).listPosts(
            channelId,
            limit: timelinePageSize,
            before: current.nextBefore,
          );
      state = AsyncData(
        TimelineState(
          posts: mergePosts(current.posts, page.posts),
          nextBefore: page.nextBefore,
        ),
      );
    } on Object {
      state = AsyncData(current.copyWith(loadingOlder: false));
      rethrow;
    }
  }

  /// 投稿直後に末尾へ足す（post-timeline spec「自分の投稿が末尾に追加される」）。
  void appendLocally(Post post) {
    final current = state.value;
    if (current == null || post.channelId != channelId) return;
    state = AsyncData(current.copyWith(posts: mergePosts(current.posts, [post])));
  }

  void replaceLocally(Post post) {
    final current = state.value;
    if (current == null) return;
    state = AsyncData(
      current.copyWith(
        posts: [
          for (final existing in current.posts)
            if (existing.id == post.id) post else existing,
        ],
      ),
    );
  }

  void removeLocally(String postId) {
    final current = state.value;
    if (current == null) return;
    state = AsyncData(
      current.copyWith(posts: current.posts.where((post) => post.id != postId).toList()),
    );
  }
}

final timelineProvider =
    AsyncNotifierProvider.family<TimelineNotifier, TimelineState, String>(TimelineNotifier.new);

/// 作成日時の昇順。同時刻はポスト ID で決める。
List<Post> sortPosts(List<Post> posts) {
  return [...posts]..sort((a, b) {
      final byTime = a.createdAt.compareTo(b.createdAt);
      return byTime != 0 ? byTime : a.id.compareTo(b.id);
    });
}

/// 同じポストを重複させずに束ねる。後から来た内容を優先する。
List<Post> mergePosts(List<Post> existing, List<Post> incoming) {
  final byId = <String, Post>{for (final post in existing) post.id: post};
  for (final post in incoming) {
    byId[post.id] = post;
  }
  return sortPosts(byId.values.toList());
}
