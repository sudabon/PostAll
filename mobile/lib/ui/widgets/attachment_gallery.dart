import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../api/generated/models.dart';
import '../../state/attachments.dart';
import '../../util/attachment_limits.dart';

/// 確定済みの添付の表示。画像はインライン、それ以外はファイルカード
/// （attachments spec、mobile-shell 9.15）。
class AttachmentGallery extends StatelessWidget {
  const AttachmentGallery({required this.attachments, super.key});

  final List<Attachment> attachments;

  @override
  Widget build(BuildContext context) {
    if (attachments.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          for (final attachment in attachments)
            isImageType(attachment.contentType)
                ? _InlineImage(attachment: attachment)
                : _FileCard(attachment: attachment),
        ],
      ),
    );
  }
}

class _InlineImage extends ConsumerWidget {
  const _InlineImage({required this.attachment});

  final Attachment attachment;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final download = ref.watch(attachmentDownloadProvider(attachment.id));
    return download.when(
      loading: () => const _AttachmentBox(child: Center(child: CircularProgressIndicator(strokeWidth: 2))),
      // 取得できない画像は代替表示にする（attachments spec「画像が取得できない」）。
      error: (_, __) => _AttachmentBox(
        child: Center(
          child: Text('画像を表示できません', style: Theme.of(context).textTheme.bodySmall),
        ),
      ),
      data: (url) => GestureDetector(
        onTap: () => _openViewer(context, url.url, attachment.fileName),
        child: _AttachmentBox(
          child: Image.network(
            url.url,
            fit: BoxFit.cover,
            errorBuilder: (context, _, __) => Center(
              child: Text('画像を表示できません', style: Theme.of(context).textTheme.bodySmall),
            ),
          ),
        ),
      ),
    );
  }

  void _openViewer(BuildContext context, String url, String fileName) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (context) => Scaffold(
          appBar: AppBar(title: Text(fileName)),
          backgroundColor: Colors.black,
          body: Center(child: InteractiveViewer(child: Image.network(url))),
        ),
      ),
    );
  }
}

class _AttachmentBox extends StatelessWidget {
  const _AttachmentBox({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => ClipRRect(
        borderRadius: BorderRadius.circular(6),
        child: SizedBox(width: 160, height: 120, child: child),
      );
}

class _FileCard extends ConsumerWidget {
  const _FileCard({required this.attachment});

  final Attachment attachment;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return OutlinedButton.icon(
      onPressed: () async {
        final url = await ref.read(attachmentDownloadProvider(attachment.id).future);
        await launchUrl(Uri.parse(url.url), mode: LaunchMode.externalApplication);
      },
      icon: const Icon(Icons.insert_drive_file_outlined, size: 18),
      label: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(attachment.fileName, overflow: TextOverflow.ellipsis),
          Text(formatBytes(attachment.sizeBytes), style: Theme.of(context).textTheme.labelSmall),
        ],
      ),
    );
  }
}

/// 送信前の添付プレビュー。除去とアップロード進捗を出す。
class PendingAttachmentStrip extends StatelessWidget {
  const PendingAttachmentStrip({
    required this.attachments,
    required this.onRemove,
    required this.onRetry,
    super.key,
  });

  final List<PendingAttachment> attachments;
  final void Function(String localId) onRemove;
  final void Function(String localId) onRetry;

  @override
  Widget build(BuildContext context) {
    if (attachments.isEmpty) return const SizedBox.shrink();
    return SizedBox(
      height: 78,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        itemCount: attachments.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final attachment = attachments[index];
          return Stack(
            children: [
              Container(
                width: 120,
                padding: const EdgeInsets.all(6),
                decoration: BoxDecoration(
                  border: Border.all(
                    color: attachment.failed
                        ? Theme.of(context).colorScheme.error
                        : Theme.of(context).dividerColor,
                  ),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(
                        attachment.fileName,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.labelSmall,
                      ),
                    ),
                    if (attachment.failed)
                      GestureDetector(
                        onTap: () => onRetry(attachment.localId),
                        child: Text(
                          '再試行',
                          style: Theme.of(context)
                              .textTheme
                              .labelSmall
                              ?.copyWith(color: Theme.of(context).colorScheme.error),
                        ),
                      )
                    else if (!attachment.uploaded)
                      LinearProgressIndicator(value: attachment.progress)
                    else
                      Text(formatBytes(attachment.sizeBytes),
                          style: Theme.of(context).textTheme.labelSmall),
                  ],
                ),
              ),
              Positioned(
                top: -8,
                right: -8,
                child: IconButton(
                  iconSize: 16,
                  tooltip: '添付を外す',
                  icon: const Icon(Icons.cancel),
                  onPressed: () => onRemove(attachment.localId),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
