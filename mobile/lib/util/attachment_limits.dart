/// 添付の上限（design.md D22）。サーバと同じ値をクライアントでも検証する。
const int maxAttachmentBytes = 25 * 1024 * 1024;
const int maxAttachmentsPerPost = 10;

const Set<String> allowedAttachmentTypes = {
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/// 拡張子から MIME type を引く。iOS のファイル選択は type を返さないことがある。
String contentTypeForFileName(String fileName) {
  final dot = fileName.lastIndexOf('.');
  final extension = dot < 0 ? '' : fileName.substring(dot + 1).toLowerCase();
  return switch (extension) {
    'jpg' || 'jpeg' => 'image/jpeg',
    'png' => 'image/png',
    'gif' => 'image/gif',
    'webp' => 'image/webp',
    'pdf' => 'application/pdf',
    'txt' => 'text/plain',
    'md' || 'markdown' => 'text/markdown',
    'zip' => 'application/zip',
    'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'pptx' => 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    _ => 'application/octet-stream',
  };
}

bool isImageType(String contentType) => contentType.startsWith('image/');

/// 添付として受け付けられない理由。受け付けられるなら null。
String? attachmentRejection({
  required String contentType,
  required int sizeBytes,
  required int alreadyAttached,
}) {
  if (alreadyAttached >= maxAttachmentsPerPost) {
    return '添付は 1 ポストにつき $maxAttachmentsPerPost 件までです';
  }
  if (sizeBytes > maxAttachmentBytes) {
    return 'ファイルサイズの上限は 25 MiB です';
  }
  if (!allowedAttachmentTypes.contains(contentType)) {
    return 'この形式のファイルは添付できません';
  }
  return null;
}

String formatBytes(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
  return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
}
