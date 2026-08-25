import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';

import 'errors.dart';
import 'generated/models.dart';
import 'postall_api.dart';
import 'sse.dart';

/// アクセストークンを返す。未サインインなら null。
typedef TokenProvider = Future<String?> Function();

/// dio による [PostAllApi] の実装。
///
/// 生成モデル（lib/api/generated/models.dart）を境界の型として使う。
class HttpPostAllApi implements PostAllApi {
  HttpPostAllApi({
    required String Function() baseUrl,
    required TokenProvider token,
    Dio? dio,
  })  : _baseUrl = baseUrl,
        _token = token,
        _dio = dio ?? Dio() {
    _dio.options.validateStatus = (_) => true;
    _dio.options.receiveDataWhenStatusError = true;
  }

  final String Function() _baseUrl;
  final TokenProvider _token;
  final Dio _dio;

  String _url(String path) => '${_baseUrl().replaceAll(RegExp(r'/$'), '')}$path';

  Future<Options> _options({bool auth = true, ResponseType? responseType}) async {
    final headers = <String, String>{};
    if (auth) {
      final token = await _token();
      if (token != null) headers['Authorization'] = 'Bearer $token';
    }
    return Options(headers: headers, responseType: responseType);
  }

  /// 応答を検査し、2xx でなければ [ApiException] を投げる。
  T _check<T>(Response<dynamic> response, T Function(dynamic data) parse) {
    final status = response.statusCode ?? 0;
    if (status < 200 || status >= 300) {
      throw ApiException.fromBody(status, _asJson(response.data));
    }
    return parse(response.data);
  }

  static Object? _asJson(dynamic data) {
    if (data is String) {
      if (data.isEmpty) return null;
      try {
        return jsonDecode(data);
      } on FormatException {
        return null;
      }
    }
    return data;
  }

  /// dio の例外を、呼び出し側が扱える型へ寄せる。
  Future<Response<dynamic>> _send(Future<Response<dynamic>> Function() run) async {
    try {
      return await run();
    } on DioException catch (error) {
      if (error.response != null) return error.response!;
      throw NetworkException(error.message ?? 'バックエンドへ接続できません');
    }
  }

  @override
  Future<Health> getHealth() async {
    final response = await _send(
      () => _dio.getUri<dynamic>(Uri.parse(_url('/health')), options: Options(validateStatus: (_) => true)),
    );
    // /health は 503 でも本文に状態を返す。到達できたこと自体が結果になる。
    final body = _asJson(response.data);
    if (body is Map<String, Object?>) return Health.fromJson(body);
    throw ApiException(response.statusCode ?? 0, 'http_error', 'ヘルスチェックの応答を解釈できません');
  }

  @override
  Future<List<Channel>> listChannels() async {
    final response = await _send(() async => _dio.getUri<dynamic>(
          Uri.parse(_url('/v1/channels')),
          options: await _options(),
        ));
    return _check(response, (data) => ChannelList.fromJson(data as Map<String, Object?>).channels);
  }

  @override
  Future<Channel> createChannel({required String name, String? parentId}) async {
    final response = await _send(() async => _dio.postUri<dynamic>(
          Uri.parse(_url('/v1/channels')),
          data: CreateChannelRequest(name: name, parentId: parentId).toJson(),
          options: await _options(),
        ));
    return _check(response, (data) => Channel.fromJson(data as Map<String, Object?>));
  }

  @override
  Future<Channel> renameChannel(String id, String name) async {
    final response = await _send(() async => _dio.patchUri<dynamic>(
          Uri.parse(_url('/v1/channels/$id')),
          data: RenameChannelRequest(name: name).toJson(),
          options: await _options(),
        ));
    return _check(response, (data) => Channel.fromJson(data as Map<String, Object?>));
  }

  @override
  Future<void> deleteChannel(String id) async {
    final response = await _send(() async => _dio.deleteUri<dynamic>(
          Uri.parse(_url('/v1/channels/$id')),
          options: await _options(),
        ));
    _check(response, (_) => null);
  }

  @override
  Future<Channel> moveChannel(String id, {String? parentId, String? beforeId, String? afterId}) async {
    // parentId は「ルートへ移す」を null で表すため、常に本文へ含める。
    final body = <String, Object?>{'parentId': parentId};
    if (beforeId != null) body['beforeId'] = beforeId;
    if (afterId != null) body['afterId'] = afterId;
    final response = await _send(() async => _dio.postUri<dynamic>(
          Uri.parse(_url('/v1/channels/$id/move')),
          data: body,
          options: await _options(),
        ));
    return _check(response, (data) => Channel.fromJson(data as Map<String, Object?>));
  }

  @override
  Future<PostList> listPosts(String channelId, {int limit = 10, String? before, String? around}) async {
    final query = <String, String>{'limit': '$limit'};
    if (before != null) query['before'] = before;
    if (around != null) query['around'] = around;
    final response = await _send(() async => _dio.getUri<dynamic>(
          Uri.parse(_url('/v1/channels/$channelId/posts')).replace(queryParameters: query),
          options: await _options(),
        ));
    return _check(response, (data) => PostList.fromJson(data as Map<String, Object?>));
  }

  @override
  Future<Post> createPost(String channelId, String body, {List<String>? attachmentIds}) async {
    final response = await _send(() async => _dio.postUri<dynamic>(
          Uri.parse(_url('/v1/channels/$channelId/posts')),
          data: CreatePostRequest(body: body, attachmentIds: attachmentIds).toJson(),
          options: await _options(),
        ));
    return _check(response, (data) => Post.fromJson(data as Map<String, Object?>));
  }

  @override
  Future<Post> editPost(String id, String body, {List<String>? attachmentIds}) async {
    final response = await _send(() async => _dio.patchUri<dynamic>(
          Uri.parse(_url('/v1/posts/$id')),
          data: EditPostRequest(body: body, attachmentIds: attachmentIds).toJson(),
          options: await _options(),
        ));
    return _check(response, (data) => Post.fromJson(data as Map<String, Object?>));
  }

  @override
  Future<void> deletePost(String id) async {
    final response = await _send(() async => _dio.deleteUri<dynamic>(
          Uri.parse(_url('/v1/posts/$id')),
          options: await _options(),
        ));
    _check(response, (_) => null);
  }

  @override
  Future<Thread> getThread(String postId) async {
    final response = await _send(() async => _dio.getUri<dynamic>(
          Uri.parse(_url('/v1/posts/$postId/thread')),
          options: await _options(),
        ));
    return _check(response, (data) => Thread.fromJson(data as Map<String, Object?>));
  }

  @override
  Future<Post> createReply(String postId, String body, {List<String>? attachmentIds}) async {
    final response = await _send(() async => _dio.postUri<dynamic>(
          Uri.parse(_url('/v1/posts/$postId/replies')),
          data: CreatePostRequest(body: body, attachmentIds: attachmentIds).toJson(),
          options: await _options(),
        ));
    return _check(response, (data) => Post.fromJson(data as Map<String, Object?>));
  }

  @override
  Future<List<Emoji>> listEmojis() async {
    final response = await _send(() async => _dio.getUri<dynamic>(
          Uri.parse(_url('/v1/emojis')),
          options: await _options(),
        ));
    return _check(response, (data) => EmojiList.fromJson(data as Map<String, Object?>).emojis);
  }

  @override
  Future<Uint8List> getEmojiImage(String shortcode) async {
    final response = await _send(() async => _dio.getUri<dynamic>(
          Uri.parse(_url('/v1/emojis/${Uri.encodeComponent(shortcode)}/image')),
          options: await _options(responseType: ResponseType.bytes),
        ));
    final status = response.statusCode ?? 0;
    if (status < 200 || status >= 300) {
      throw ApiException(status, 'http_error', '絵文字画像を取得できません');
    }
    return Uint8List.fromList(response.data as List<int>);
  }

  @override
  Future<Reaction> addReaction(String postId, String emojiId) async {
    final response = await _send(() async => _dio.putUri<dynamic>(
          Uri.parse(_url('/v1/posts/$postId/reactions/$emojiId')),
          options: await _options(),
        ));
    return _check(response, (data) => Reaction.fromJson(data as Map<String, Object?>));
  }

  @override
  Future<void> removeReaction(String postId, String emojiId) async {
    final response = await _send(() async => _dio.deleteUri<dynamic>(
          Uri.parse(_url('/v1/posts/$postId/reactions/$emojiId')),
          options: await _options(),
        ));
    _check(response, (_) => null);
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
    final params = <String, String>{'q': query};
    if (channelId != null) params['channelId'] = channelId;
    if (createdFrom != null) params['createdFrom'] = createdFrom.toUtc().toIso8601String();
    if (createdTo != null) params['createdTo'] = createdTo.toUtc().toIso8601String();
    if (limit != null) params['limit'] = '$limit';
    if (cursor != null) params['cursor'] = cursor;
    final response = await _send(() async => _dio.getUri<dynamic>(
          Uri.parse(_url('/v1/search')).replace(queryParameters: params),
          options: await _options(),
        ));
    return _check(response, (data) => SearchResultPage.fromJson(data as Map<String, Object?>));
  }

  @override
  Future<ChangeEventPage> listEvents({String after = '0', int limit = 200}) async {
    final response = await _send(() async => _dio.getUri<dynamic>(
          Uri.parse(_url('/v1/events')).replace(queryParameters: {'after': after, 'limit': '$limit'}),
          options: await _options(),
        ));
    return _check(response, (data) => ChangeEventPage.fromJson(data as Map<String, Object?>));
  }

  @override
  Stream<ChangeEvent> streamEvents({String? lastEventId}) async* {
    final options = await _options(responseType: ResponseType.stream);
    options.headers!['Accept'] = 'text/event-stream';
    if (lastEventId != null) options.headers!['Last-Event-ID'] = lastEventId;

    final Response<dynamic> response;
    try {
      response = await _dio.getUri<dynamic>(Uri.parse(_url('/v1/events/stream')), options: options);
    } on DioException catch (error) {
      throw NetworkException(error.message ?? 'イベントストリームへ接続できません');
    }
    final status = response.statusCode ?? 0;
    if (status < 200 || status >= 300) {
      throw ApiException(status, 'http_error', 'イベントストリームへ接続できません');
    }

    final body = response.data as ResponseBody;
    await for (final message in parseSseStream(body.stream)) {
      final decoded = _asJson(message.data);
      if (decoded is Map<String, Object?>) yield ChangeEvent.fromJson(decoded);
    }
  }

  @override
  Future<StartUploadResponse> startUpload({
    required String fileName,
    required String contentType,
    required int sizeBytes,
    required String checksum,
  }) async {
    final response = await _send(() async => _dio.postUri<dynamic>(
          Uri.parse(_url('/v1/attachments/uploads')),
          data: StartUploadRequest(
            fileName: fileName,
            contentType: contentType,
            sizeBytes: sizeBytes,
            checksum: checksum,
          ).toJson(),
          options: await _options(),
        ));
    return _check(response, (data) => StartUploadResponse.fromJson(data as Map<String, Object?>));
  }

  @override
  Future<void> uploadBytes(
    StartUploadResponse upload,
    Uint8List bytes, {
    void Function(int sent, int total)? onProgress,
  }) async {
    // 署名付き URL は S3 を直接指すため、Authorization は付けない。
    final response = await _send(() => _dio.putUri<dynamic>(
          Uri.parse(upload.uploadUrl),
          data: Stream.value(bytes),
          onSendProgress: onProgress,
          options: Options(
            headers: {...upload.headers, Headers.contentLengthHeader: bytes.length},
            validateStatus: (_) => true,
          ),
        ));
    final status = response.statusCode ?? 0;
    if (status < 200 || status >= 300) {
      throw ApiException(status, 'upload_failed', '添付のアップロードに失敗しました');
    }
  }

  @override
  Future<Attachment> completeUpload(String id) async {
    final response = await _send(() async => _dio.postUri<dynamic>(
          Uri.parse(_url('/v1/attachments/$id/complete')),
          options: await _options(),
        ));
    return _check(response, (data) => Attachment.fromJson(data as Map<String, Object?>));
  }

  @override
  Future<DownloadUrlResponse> getDownloadUrl(String id) async {
    final response = await _send(() async => _dio.getUri<dynamic>(
          Uri.parse(_url('/v1/attachments/$id/download')),
          options: await _options(),
        ));
    return _check(response, (data) => DownloadUrlResponse.fromJson(data as Map<String, Object?>));
  }
}
