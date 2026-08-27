import 'dart:async';
import 'dart:typed_data';

import 'package:postall/api/change_events.dart';
import 'package:postall/api/errors.dart';
import 'package:postall/api/generated/models.dart';
import 'package:postall/api/postall_api.dart';

/// widget test 用のバックエンド。
///
/// 実装は本物と同じ観測可能な振る舞い（昇順・keyset・論理削除の除外・
/// 同一階層での名前の一意性）だけを再現する。
class FakeApi implements PostAllApi, RealtimeStatusSource {
  FakeApi({
    List<Channel>? channels,
    List<Post>? posts,
    List<Emoji>? emojis,
    this.healthy = true,
  }) : channels = [...?channels],
       posts = [...?posts],
       emojis = [...?emojis];

  final List<Channel> channels;
  final List<Post> posts;
  final List<Emoji> emojis;
  bool healthy;

  /// Realtime が繋がっているか。false の間は合図を出さず、クライアントは
  /// `listEvents` による差分取得へ退避する（iOS のバックグラウンドを模す）。
  bool _streamConnected = true;

  bool get streamConnected => _streamConnected;

  set streamConnected(bool connected) {
    if (_streamConnected == connected) return;
    _streamConnected = connected;
    if (!_realtimeStatuses.isClosed) {
      _realtimeStatuses.add(connected);
    }
  }

  /// 発行したイベント。購読者へ合図を配り、`listEvents` でも返す。
  final _signals = StreamController<void>.broadcast();
  final _realtimeStatuses = StreamController<bool>.broadcast(sync: true);
  final _log = <ChangeEvent>[];
  var _nextEventId = 0;

  /// 呼び出しの記録。テストが「どう呼ばれたか」を確認するために使う。
  final calls = <String>[];

  List<String>? lastEditAttachmentIds;

  var _nextId = 1000;

  String _id() =>
      '00000000-0000-4000-8000-${(_nextId++).toString().padLeft(12, '0')}';

  void dispose() {
    _signals.close();
    _realtimeStatuses.close();
  }

  @override
  Future<Health> getHealth() async {
    calls.add('getHealth');
    if (!healthy) throw NetworkException('接続できません');
    return const Health(status: HealthStatus.ok, database: HealthDatabase.ok);
  }

  @override
  Future<List<Channel>> listChannels() async {
    calls.add('listChannels');
    if (!healthy) throw NetworkException('接続できません');
    return [...channels];
  }

  @override
  Future<Channel> createChannel({
    required String name,
    String? parentId,
  }) async {
    calls.add('createChannel:$name');
    if (channels.any((c) => c.parentId == parentId && c.name == name)) {
      throw ApiException(409, 'channel_name_conflict', '同じ階層に同名のチャネルがあります');
    }
    final now = DateTime.now();
    final channel = Channel(
      id: _id(),
      parentId: parentId,
      name: name,
      sortKey: 'z${channels.length}',
      createdAt: now,
      updatedAt: now,
    );
    channels.add(channel);
    emit('channel.created', channelId: channel.id);
    return channel;
  }

  @override
  Future<Channel> renameChannel(String id, String name) async {
    calls.add('renameChannel:$id:$name');
    final index = channels.indexWhere((c) => c.id == id);
    final current = channels[index];
    if (channels.any(
      (c) => c.id != id && c.parentId == current.parentId && c.name == name,
    )) {
      throw ApiException(409, 'channel_name_conflict', '同じ階層に同名のチャネルがあります');
    }
    final updated = _copyChannel(current, name: name);
    channels[index] = updated;
    return updated;
  }

  @override
  Future<void> deleteChannel(String id) async {
    calls.add('deleteChannel:$id');
    if (posts.any((p) => p.channelId == id && !p.deleted)) {
      throw ApiException(409, 'channel_not_empty', 'ポストを持つチャネルは削除できません');
    }
    channels.removeWhere((c) => c.id == id);
  }

  @override
  Future<Channel> moveChannel(
    String id, {
    String? parentId,
    String? beforeId,
    String? afterId,
  }) async {
    calls.add('moveChannel:$id:parent=$parentId:before=$beforeId');
    final index = channels.indexWhere((c) => c.id == id);
    final current = channels[index];
    if (channels.any(
      (c) => c.id != id && c.parentId == parentId && c.name == current.name,
    )) {
      throw ApiException(409, 'channel_name_conflict', '移動先に同じ名前のチャネルがあります');
    }
    final updated = _copyChannel(
      current,
      parentId: parentId,
      clearParent: parentId == null,
    );
    channels[index] = updated;
    return updated;
  }

  @override
  Future<PostList> listPosts(
    String channelId, {
    int limit = 10,
    String? before,
    String? around,
  }) async {
    calls.add(
      'listPosts:$channelId:limit=$limit:before=$before:around=$around',
    );
    if (!healthy) throw NetworkException('接続できません');

    // タイムラインはチャネル直下のみ。論理削除は返さない。
    final all =
        posts
            .where(
              (p) =>
                  p.channelId == channelId &&
                  p.threadRootId == null &&
                  !p.deleted,
            )
            .toList()
          ..sort((a, b) {
            final byTime = a.createdAt.compareTo(b.createdAt);
            return byTime != 0 ? byTime : a.id.compareTo(b.id);
          });

    var end = all.length;
    if (before != null) {
      final at = all.indexWhere((p) => p.id == before);
      if (at >= 0) end = at;
    } else if (around != null) {
      final at = all.indexWhere((p) => p.id == around);
      if (at >= 0) end = (at + 1).clamp(0, all.length);
    }
    final start = (end - limit).clamp(0, end);
    final page = all.sublist(start, end);
    return PostList(posts: page, nextBefore: start > 0 ? page.first.id : null);
  }

  @override
  Future<Post> createPost(
    String channelId,
    String body, {
    List<String>? attachmentIds,
  }) async {
    calls.add('createPost:$channelId');
    final post = Post(
      id: _id(),
      channelId: channelId,
      authorId: 'author',
      body: body,
      createdAt: DateTime.now(),
      updatedAt: DateTime.now(),
      deleted: false,
      replyCount: 0,
    );
    posts.add(post);
    emit('post.created', channelId: channelId, postId: post.id);
    return post;
  }

  @override
  Future<Post> editPost(
    String id,
    String body, {
    List<String>? attachmentIds,
  }) async {
    calls.add('editPost:$id');
    lastEditAttachmentIds = attachmentIds == null ? null : [...attachmentIds];
    final index = posts.indexWhere((p) => p.id == id);
    final current = posts[index];
    final attachments = attachmentIds == null
        ? current.attachments
        : current.attachments
              ?.where((attachment) => attachmentIds.contains(attachment.id))
              .toList();
    final updated = _copyPost(
      current,
      body: body,
      editedAt: DateTime.now(),
      attachments: attachments,
    );
    posts[index] = updated;
    emit(
      updated.threadRootId == null ? 'post.updated' : 'reply.updated',
      channelId: updated.channelId,
      postId: updated.id,
      threadRootId: updated.threadRootId,
    );
    return updated;
  }

  @override
  Future<void> deletePost(String id) async {
    calls.add('deletePost:$id');
    final index = posts.indexWhere((p) => p.id == id);
    final removed = _copyPost(posts[index], deleted: true);
    posts[index] = removed;
    emit(
      removed.threadRootId == null ? 'post.deleted' : 'reply.deleted',
      channelId: removed.channelId,
      postId: removed.id,
      threadRootId: removed.threadRootId,
    );
  }

  @override
  Future<Thread> getThread(String postId) async {
    calls.add('getThread:$postId');
    final root = posts.firstWhere((p) => p.id == postId);
    final replies = posts
        .where((p) => p.threadRootId == postId && !p.deleted)
        .toList();
    return Thread(root: root, replies: replies);
  }

  @override
  Future<Post> createReply(
    String postId,
    String body, {
    List<String>? attachmentIds,
  }) async {
    calls.add('createReply:$postId');
    final root = posts.firstWhere((p) => p.id == postId);
    final reply = Post(
      id: _id(),
      channelId: root.channelId,
      threadRootId: postId,
      authorId: 'author',
      body: body,
      createdAt: DateTime.now(),
      updatedAt: DateTime.now(),
      deleted: false,
      replyCount: 0,
    );
    posts.add(reply);
    final index = posts.indexWhere((p) => p.id == postId);
    posts[index] = _copyPost(
      posts[index],
      replyCount: posts[index].replyCount + 1,
    );
    emit(
      'reply.created',
      channelId: reply.channelId,
      postId: reply.id,
      threadRootId: postId,
    );
    return reply;
  }

  @override
  Future<List<Emoji>> listEmojis() async => [...emojis];

  @override
  Future<Uint8List> getEmojiImage(String shortcode) async =>
      throw ApiException(404, 'not_found', '画像がありません');

  @override
  Future<Reaction> addReaction(String postId, String emojiId) async {
    calls.add('addReaction:$postId:$emojiId');
    final emoji = emojis.firstWhere((e) => e.id == emojiId);
    final index = posts.indexWhere((p) => p.id == postId);
    final reaction = Reaction(
      emoji: emoji,
      count: 1,
      reactedByMe: true,
      reactorIds: const ['me'],
    );
    posts[index] = _copyPost(
      posts[index],
      reactions: [...?posts[index].reactions, reaction],
    );
    emit(
      'reaction.updated',
      channelId: posts[index].channelId,
      postId: postId,
      threadRootId: posts[index].threadRootId,
    );
    return reaction;
  }

  @override
  Future<void> removeReaction(String postId, String emojiId) async {
    calls.add('removeReaction:$postId:$emojiId');
    final index = posts.indexWhere((p) => p.id == postId);
    posts[index] = _copyPost(
      posts[index],
      reactions: (posts[index].reactions ?? const <Reaction>[])
          .where((r) => r.emoji.id != emojiId)
          .toList(),
    );
    emit(
      'reaction.updated',
      channelId: posts[index].channelId,
      postId: postId,
      threadRootId: posts[index].threadRootId,
    );
  }

  @override
  Future<SearchResultPage> searchPosts({
    required String query,
    String? channelId,
    DateTime? createdFrom,
    DateTime? createdTo,
    int? limit,
    String? cursor,
  }) async {
    calls.add('searchPosts:$query');
    final results = posts
        .where(
          (p) =>
              !p.deleted && p.body.toLowerCase().contains(query.toLowerCase()),
        )
        .map(
          (p) => SearchResult(
            postId: p.id,
            timelinePostId: p.threadRootId ?? p.id,
            channelId: p.channelId,
            channelName: channels.firstWhere((c) => c.id == p.channelId).name,
            threadRootId: p.threadRootId,
            body: p.body,
            createdAt: p.createdAt,
          ),
        )
        .toList();
    return SearchResultPage(results: results);
  }

  @override
  Future<ChangeEventPage> listEvents({
    String after = '0',
    int limit = 200,
  }) async {
    calls.add('listEvents:after=$after');
    if (!healthy) throw NetworkException('接続できません');
    final since = BigInt.parse(after);
    final pending = _log
        .where((e) => BigInt.parse(e.id) > since)
        .take(limit)
        .toList();
    return ChangeEventPage(
      events: pending,
      nextAfter: pending.isEmpty ? after : pending.last.id,
      hasMore: false,
    );
  }

  @override
  Stream<bool> watchRealtimeStatus() => Stream<bool>.multi((controller) {
    controller.add(streamConnected);
    final subscription = _realtimeStatuses.stream.listen(
      controller.add,
      onError: controller.addError,
      onDone: controller.close,
    );
    controller.onCancel = subscription.cancel;
  });

  @override
  Stream<void> watchChangeSignals() {
    calls.add('watchChangeSignals');
    return _signals.stream;
  }

  /// Realtime ではなくフォールバックのポーリングから届く合図を再現する。
  void emitPollingSignal() {
    if (!_signals.isClosed) _signals.add(null);
  }

  /// サーバ発の変更を記録し、購読中のクライアントへ合図を送る。
  ///
  /// 切断中に起きた変更も [listEvents] から取り出せるよう、常に記録する。
  ChangeEvent emit(
    String type, {
    String? channelId,
    String? postId,
    String? threadRootId,
  }) {
    final event = ChangeEvent(
      id: '${++_nextEventId}',
      eventType: changeEventType(type),
      channelId: channelId,
      postId: postId,
      threadRootId: threadRootId,
      createdAt: DateTime.now(),
    );
    _log.add(event);
    if (streamConnected) _signals.add(null);
    return event;
  }

  @override
  Future<StartUploadResponse> startUpload({
    required String fileName,
    required String contentType,
    required int sizeBytes,
    required String checksum,
  }) async {
    calls.add('startUpload:$fileName');
    return StartUploadResponse(
      id: _id(),
      uploadUrl: 'https://example.invalid/upload',
      headers: const {},
    );
  }

  @override
  Future<void> uploadBytes(
    StartUploadResponse upload,
    Uint8List bytes, {
    void Function(int sent, int total)? onProgress,
  }) async {
    onProgress?.call(bytes.length, bytes.length);
  }

  @override
  Future<Attachment> completeUpload(String id) async => Attachment(
    id: id,
    fileName: 'file',
    contentType: 'image/png',
    sizeBytes: 1,
    checksum: 'x',
    createdAt: DateTime.now(),
  );

  @override
  Future<DownloadUrlResponse> getDownloadUrl(String id) async =>
      DownloadUrlResponse(
        url: 'https://example.invalid/download/$id',
        expiresAt: DateTime.now().add(const Duration(minutes: 5)),
      );

  static Channel _copyChannel(
    Channel channel, {
    String? name,
    String? parentId,
    bool clearParent = false,
  }) => Channel(
    id: channel.id,
    parentId: clearParent ? null : (parentId ?? channel.parentId),
    name: name ?? channel.name,
    sortKey: channel.sortKey,
    createdAt: channel.createdAt,
    updatedAt: DateTime.now(),
  );

  static Post _copyPost(
    Post post, {
    String? body,
    DateTime? editedAt,
    bool? deleted,
    int? replyCount,
    List<Attachment>? attachments,
    List<Reaction>? reactions,
  }) => Post(
    id: post.id,
    channelId: post.channelId,
    threadRootId: post.threadRootId,
    authorId: post.authorId,
    body: body ?? post.body,
    createdAt: post.createdAt,
    updatedAt: DateTime.now(),
    editedAt: editedAt ?? post.editedAt,
    deleted: deleted ?? post.deleted,
    replyCount: replyCount ?? post.replyCount,
    lastReplyAt: post.lastReplyAt,
    attachments: attachments ?? post.attachments,
    reactions: reactions ?? post.reactions,
  );
}
