import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/generated/models.dart';
import 'connection.dart';
import 'providers.dart';
import 'thread.dart';
import 'timeline.dart';

/// ポストとリアクションの変更操作。
///
/// 接続が切れている間は実行しない（sync-and-storage spec「変更操作の抑止」）。
class PostActions {
  PostActions(this._ref);

  final Ref _ref;

  void _requireConnection() {
    if (_ref.read(connectionProvider) == BackendConnection.offline) {
      throw const OfflineMutationException();
    }
  }

  Future<Post> createPost(
    String channelId,
    String body,
    List<String> attachmentIds,
  ) async {
    _requireConnection();
    final post = await _ref
        .read(apiProvider)
        .createPost(
          channelId,
          body,
          attachmentIds: attachmentIds.isEmpty ? null : attachmentIds,
        );
    _ref.read(timelineProvider(channelId).notifier).appendLocally(post);
    return post;
  }

  Future<Post> createReply(
    String rootPostId,
    String body,
    List<String> attachmentIds,
  ) async {
    _requireConnection();
    final reply = await _ref
        .read(apiProvider)
        .createReply(
          rootPostId,
          body,
          attachmentIds: attachmentIds.isEmpty ? null : attachmentIds,
        );
    _ref.read(threadProvider(rootPostId).notifier).appendLocally(reply);
    // 親の返信件数が変わるため、タイムラインも取り直す。
    await _ref.read(timelineProvider(reply.channelId).notifier).reload();
    return reply;
  }

  Future<Post> editPost(
    Post post,
    String body, {
    List<String>? attachmentIds,
  }) async {
    _requireConnection();
    final updated = await _ref
        .read(apiProvider)
        .editPost(post.id, body, attachmentIds: attachmentIds);
    if (post.threadRootId == null) {
      _ref
          .read(timelineProvider(post.channelId).notifier)
          .replaceLocally(updated);
    } else {
      _ref
          .read(threadProvider(post.threadRootId!).notifier)
          .replaceLocally(updated);
    }
    return updated;
  }

  Future<void> deletePost(Post post) async {
    _requireConnection();
    await _ref.read(apiProvider).deletePost(post.id);
    if (post.threadRootId == null) {
      _ref
          .read(timelineProvider(post.channelId).notifier)
          .removeLocally(post.id);
    } else {
      _ref
          .read(threadProvider(post.threadRootId!).notifier)
          .removeReplyLocally(post.id);
    }
  }

  /// リアクションを付ける／外す。失敗したらサーバの状態へ戻す
  /// （emoji-reactions spec「リアクションの失敗時の巻き戻し」）。
  Future<void> toggleReaction(
    Post post,
    Emoji emoji, {
    required bool add,
  }) async {
    _requireConnection();
    final api = _ref.read(apiProvider);
    try {
      if (add) {
        await api.addReaction(post.id, emoji.id);
      } else {
        await api.removeReaction(post.id, emoji.id);
      }
    } finally {
      await _refresh(post);
    }
  }

  Future<void> _refresh(Post post) async {
    final threadRootId = post.threadRootId;
    if (threadRootId != null) {
      await _ref.read(threadProvider(threadRootId).notifier).reload();
    } else if (_ref.read(openThreadProvider) == post.id) {
      await _ref.read(threadProvider(post.id).notifier).reload();
    }
    await _ref.read(timelineProvider(post.channelId).notifier).reload();
  }
}

final postActionsProvider = Provider<PostActions>(PostActions.new);
