import 'package:flutter/material.dart';

import '../../api/generated/models.dart';
import '../../util/dates.dart';
import 'attachment_gallery.dart';
import 'markdown_body.dart';
import 'reaction_bar.dart';

/// ポストに対して実行できる操作（post-timeline spec「モバイルでの長押し操作」）。
enum PostAction { edit, delete, openThread, react }

/// タイムラインとスレッドで共通のポスト表示。
class PostTile extends StatelessWidget {
  const PostTile({
    required this.post,
    required this.onAction,
    required this.onToggleReaction,
    this.showThreadSummary = true,
    super.key,
  });

  final Post post;
  final void Function(PostAction action) onAction;
  final Future<void> Function(Reaction reaction) onToggleReaction;

  /// スレッド画面では返信件数の導線を出さない。
  final bool showThreadSummary;

  @override
  Widget build(BuildContext context) {
    final reactions = post.reactions ?? const <Reaction>[];
    final attachments = post.attachments ?? const <Attachment>[];

    return InkWell(
      onLongPress: () => _showActions(context),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(formatTime(post.createdAt), style: Theme.of(context).textTheme.labelSmall),
                if (post.editedAt != null) ...[
                  const SizedBox(width: 6),
                  Text('編集済み', style: Theme.of(context).textTheme.labelSmall),
                ],
              ],
            ),
            const SizedBox(height: 2),
            PostMarkdown(body: post.body),
            AttachmentGallery(attachments: attachments),
            // リアクションが 0 件でも、付与の導線としてバーを出す。
            ReactionBar(
              reactions: reactions,
              onToggle: onToggleReaction,
              onAdd: () => onAction(PostAction.react),
            ),
            if (showThreadSummary && post.replyCount > 0)
              TextButton(
                onPressed: () => onAction(PostAction.openThread),
                child: Text(
                  '${post.replyCount} 件の返信'
                  '${post.lastReplyAt == null ? '' : ' · 最終 ${formatTime(post.lastReplyAt!)}'}',
                ),
              )
            else if (showThreadSummary)
              TextButton(
                onPressed: () => onAction(PostAction.openThread),
                child: const Text('スレッドで返信'),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _showActions(BuildContext context) async {
    final action = await showModalBottomSheet<PostAction>(
      context: context,
      builder: (context) => SafeArea(
        child: Wrap(
          children: [
            ListTile(
              leading: const Icon(Icons.add_reaction_outlined),
              title: const Text('リアクションを付ける'),
              onTap: () => Navigator.of(context).pop(PostAction.react),
            ),
            if (showThreadSummary)
              ListTile(
                leading: const Icon(Icons.forum_outlined),
                title: const Text('スレッドを開く'),
                onTap: () => Navigator.of(context).pop(PostAction.openThread),
              ),
            ListTile(
              leading: const Icon(Icons.edit_outlined),
              title: const Text('編集'),
              onTap: () => Navigator.of(context).pop(PostAction.edit),
            ),
            ListTile(
              leading: const Icon(Icons.delete_outline),
              title: const Text('削除'),
              onTap: () => Navigator.of(context).pop(PostAction.delete),
            ),
          ],
        ),
      ),
    );
    if (action != null) onAction(action);
  }
}

/// 日付が変わる箇所に入れるセパレータ（post-timeline spec）。
class DateSeparator extends StatelessWidget {
  const DateSeparator({required this.date, super.key});

  final DateTime date;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 12),
      child: Row(
        children: [
          const Expanded(child: Divider()),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8),
            child: Text(formatDateLabel(date), style: Theme.of(context).textTheme.labelSmall),
          ),
          const Expanded(child: Divider()),
        ],
      ),
    );
  }
}

/// 論理削除されたスレッド親のプレースホルダ（design.md D23）。
class DeletedPostPlaceholder extends StatelessWidget {
  const DeletedPostPlaceholder({super.key});

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
        child: Text(
          'このポストは削除されました',
          style: Theme.of(context).textTheme.bodySmall,
        ),
      );
}
