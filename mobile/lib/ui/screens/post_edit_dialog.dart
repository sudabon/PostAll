import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/generated/models.dart';
import '../../state/post_actions.dart';
import '../widgets/text_prompt.dart';

/// 本文と添付を編集して保存する。取り消すと変更を捨てる（post-timeline spec）。
Future<void> editPostFlow(
  BuildContext context,
  WidgetRef ref,
  Post post,
) async {
  final attachments = post.attachments ?? const <Attachment>[];
  final input = await showDialog<_PostEditInput>(
    context: context,
    builder: (context) =>
        _PostEditDialog(body: post.body, attachments: attachments),
  );
  if (input == null || !context.mounted) return;

  final body = input.body.trim();
  if (body.isEmpty && input.attachmentIds.isEmpty) {
    _notify(context, '本文または添付のいずれかが必要です');
    return;
  }

  try {
    await ref
        .read(postActionsProvider)
        .editPost(
          post,
          body,
          attachmentIds: attachments.isEmpty ? null : input.attachmentIds,
        );
  } on Object catch (error) {
    if (context.mounted) _notify(context, '保存に失敗しました: $error');
  }
}

class _PostEditInput {
  const _PostEditInput(this.body, this.attachmentIds);

  final String body;
  final List<String> attachmentIds;
}

class _PostEditDialog extends StatefulWidget {
  const _PostEditDialog({required this.body, required this.attachments});

  final String body;
  final List<Attachment> attachments;

  @override
  State<_PostEditDialog> createState() => _PostEditDialogState();
}

class _PostEditDialogState extends State<_PostEditDialog> {
  late final TextEditingController _controller = TextEditingController(
    text: widget.body,
  );
  late final Set<String> _selectedAttachmentIds = {
    for (final attachment in widget.attachments) attachment.id,
  };

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _save() {
    Navigator.of(context).pop(
      _PostEditInput(_controller.text, [
        for (final attachment in widget.attachments)
          if (_selectedAttachmentIds.contains(attachment.id)) attachment.id,
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('ポストを編集'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              key: const Key('post-edit-input'),
              controller: _controller,
              autofocus: true,
              maxLines: null,
              decoration: const InputDecoration(border: OutlineInputBorder()),
            ),
            if (widget.attachments.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text('添付ファイル', style: Theme.of(context).textTheme.titleSmall),
              const Text('削除する添付のチェックを外してください'),
              for (final attachment in widget.attachments)
                CheckboxListTile(
                  key: Key('post-edit-attachment-${attachment.id}'),
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  dense: true,
                  value: _selectedAttachmentIds.contains(attachment.id),
                  title: Text(attachment.fileName),
                  onChanged: (selected) {
                    setState(() {
                      if (selected ?? false) {
                        _selectedAttachmentIds.add(attachment.id);
                      } else {
                        _selectedAttachmentIds.remove(attachment.id);
                      }
                    });
                  },
                ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取り消す'),
        ),
        TextButton(
          key: const Key('post-edit-save'),
          onPressed: _save,
          child: const Text('保存'),
        ),
      ],
    );
  }
}

/// 削除は実行前に確認を求める（post-timeline spec）。
Future<void> deletePostFlow(
  BuildContext context,
  WidgetRef ref,
  Post post,
) async {
  final confirmed = await confirm(
    context,
    title: 'ポストを削除しますか',
    message: '削除するとタイムラインから見えなくなります。',
    confirmLabel: '削除',
    confirmKey: const Key('post-delete-confirm'),
  );
  if (!confirmed) return;

  try {
    await ref.read(postActionsProvider).deletePost(post);
  } on Object catch (error) {
    if (context.mounted) _notify(context, '削除に失敗しました: $error');
  }
}

void _notify(BuildContext context, String message) => ScaffoldMessenger.maybeOf(
  context,
)?.showSnackBar(SnackBar(content: Text(message)));
