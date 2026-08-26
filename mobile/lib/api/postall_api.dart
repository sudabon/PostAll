import 'dart:typed_data';

import 'generated/models.dart';

/// PostAll バックエンドの抽象。
///
/// メソッド構成は frontend/src/api/client.ts と揃えてある。widget test では
/// この抽象を実装したフェイクを [apiProvider] へ差し込む。
abstract class PostAllApi {
  Future<Health> getHealth();

  Future<List<Channel>> listChannels();
  Future<Channel> createChannel({required String name, String? parentId});
  Future<Channel> renameChannel(String id, String name);
  Future<void> deleteChannel(String id);
  Future<Channel> moveChannel(
    String id, {
    String? parentId,
    String? beforeId,
    String? afterId,
  });

  /// チャネル直下のポストを昇順で返す。
  ///
  /// [before] は [PostList.nextBefore] の値。[around] を渡すと、そのポストを
  /// 含む範囲を返す（検索結果からの移動で使う）。
  Future<PostList> listPosts(
    String channelId, {
    int limit = 10,
    String? before,
    String? around,
  });
  Future<Post> createPost(String channelId, String body, {List<String>? attachmentIds});
  Future<Post> editPost(String id, String body, {List<String>? attachmentIds});
  Future<void> deletePost(String id);

  Future<Thread> getThread(String postId);
  Future<Post> createReply(String postId, String body, {List<String>? attachmentIds});

  Future<List<Emoji>> listEmojis();
  Future<Uint8List> getEmojiImage(String shortcode);
  Future<Reaction> addReaction(String postId, String emojiId);
  Future<void> removeReaction(String postId, String emojiId);

  Future<SearchResultPage> searchPosts({
    required String query,
    String? channelId,
    DateTime? createdFrom,
    DateTime? createdTo,
    int? limit,
    String? cursor,
  });

  Future<ChangeEventPage> listEvents({String after = '0', int limit = 200});

  /// Realtime の合図。受信したら [listEvents] で差分を取る。
  Stream<void> watchChangeSignals();

  Future<StartUploadResponse> startUpload({
    required String fileName,
    required String contentType,
    required int sizeBytes,
    required String checksum,
  });

  /// 署名付き URL へ実体を直接送る（design.md D11）。
  Future<void> uploadBytes(
    StartUploadResponse upload,
    Uint8List bytes, {
    void Function(int sent, int total)? onProgress,
  });
  Future<Attachment> completeUpload(String id);
  Future<DownloadUrlResponse> getDownloadUrl(String id);
}
