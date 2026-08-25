import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/generated/models.dart';
import '../util/attachment_limits.dart';
import 'providers.dart';

/// 入力フォームに載っている添付の 1 件。
///
/// 送信前に確認・除去できるよう、確定済み・アップロード中・失敗を区別する
/// （post-composer spec「添付の追加」、attachments spec「アップロードの進捗と失敗処理」）。
class PendingAttachment {
  const PendingAttachment({
    required this.localId,
    required this.fileName,
    required this.contentType,
    required this.bytes,
    this.attachmentId,
    this.progress = 0,
    this.error,
  });

  final String localId;
  final String fileName;
  final String contentType;
  final Uint8List bytes;

  /// 確定済みなら添付 ID を持つ。
  final String? attachmentId;
  final double progress;
  final String? error;

  bool get uploaded => attachmentId != null;
  bool get failed => error != null;
  int get sizeBytes => bytes.length;
  bool get isImage => isImageType(contentType);

  PendingAttachment copyWith({
    String? attachmentId,
    double? progress,
    String? error,
    bool clearError = false,
  }) =>
      PendingAttachment(
        localId: localId,
        fileName: fileName,
        contentType: contentType,
        bytes: bytes,
        attachmentId: attachmentId ?? this.attachmentId,
        progress: progress ?? this.progress,
        error: clearError ? null : (error ?? this.error),
      );
}

/// 添付のアップロード。署名付き URL へ直接送り、完了を API へ通知する（D11）。
class AttachmentUploader {
  AttachmentUploader(this._ref);

  final Ref _ref;

  Future<PendingAttachment> upload(
    PendingAttachment attachment, {
    void Function(double progress)? onProgress,
  }) async {
    final api = _ref.read(apiProvider);
    final checksum = sha256.convert(attachment.bytes).toString();
    final started = await api.startUpload(
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      sizeBytes: attachment.sizeBytes,
      checksum: checksum,
    );
    await api.uploadBytes(
      started,
      attachment.bytes,
      onProgress: (sent, total) => onProgress?.call(total <= 0 ? 0 : sent / total),
    );
    final completed = await api.completeUpload(started.id);
    return attachment.copyWith(attachmentId: completed.id, progress: 1, clearError: true);
  }
}

final attachmentUploaderProvider = Provider<AttachmentUploader>(AttachmentUploader.new);

/// 添付の実体を取りに行くための署名付き URL。
final attachmentDownloadProvider =
    FutureProvider.family<DownloadUrlResponse, String>((ref, attachmentId) async {
  return ref.read(apiProvider).getDownloadUrl(attachmentId);
});

/// base64 は使わないが、テストが決定的なチェックサムを組み立てられるよう公開する。
String checksumOf(List<int> bytes) => sha256.convert(bytes).toString();

/// 画像プレビュー用のデータ URI（WebView へ渡すときに使う）。
String dataUri(String contentType, Uint8List bytes) =>
    'data:$contentType;base64,${base64Encode(bytes)}';
