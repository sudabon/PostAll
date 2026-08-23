import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/generated/models.dart';
import '../../state/drafts.dart';
import '../../state/post_actions.dart';
import '../../state/thread.dart';
import '../widgets/attachment_picker.dart';
import '../widgets/composer.dart';
import '../widgets/post_tile.dart';
import 'post_edit_dialog.dart';
import 'timeline_screen.dart';

/// スレッドを独立した画面として表示する（mobile-shell spec「スレッドを開く」）。
class ThreadScreen extends ConsumerWidget {
  const ThreadScreen({required this.rootPostId, this.attachmentPicker, super.key});

  final String rootPostId;
  final AttachmentPicker? attachmentPicker;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final thread = ref.watch(threadProvider(rootPostId));

    return Scaffold(
      appBar: AppBar(title: const Text('スレッド')),
      body: thread.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Text('スレッドを取得できませんでした\n$error', textAlign: TextAlign.center),
          ),
        ),
        data: (data) => Column(
          children: [
            Expanded(
              child: ListView(
                children: [
                  // 親が削除されていてもスレッドは開ける（design.md D23）。
                  if (data.root.deleted)
                    const DeletedPostPlaceholder()
                  else
                    PostTile(
                      key: ValueKey(data.root.id),
                      post: data.root,
                      showThreadSummary: false,
                      onAction: (action) => _handleAction(context, ref, data.root, action),
                      onToggleReaction: (reaction) =>
                          _toggleReaction(context, ref, data.root, reaction),
                    ),
                  const Divider(),
                  for (final reply in data.replies)
                    PostTile(
                      key: ValueKey(reply.id),
                      post: reply,
                      showThreadSummary: false,
                      onAction: (action) => _handleAction(context, ref, reply, action),
                      onToggleReaction: (reaction) => _toggleReaction(context, ref, reply, reaction),
                    ),
                ],
              ),
            ),
            Composer(
              // チャネルの下書きと混ざらないよう、スレッド専用のキーを使う。
              draftKey: DraftKey.thread(rootPostId),
              hintText: 'スレッドへ返信',
              picker: attachmentPicker,
              onSubmit: (submission) => _submit(context, ref, submission),
            ),
          ],
        ),
      ),
    );
  }

  Future<bool> _submit(BuildContext context, WidgetRef ref, ComposerSubmission submission) async {
    try {
      await ref.read(postActionsProvider).createReply(
            rootPostId,
            submission.body,
            submission.attachmentIds,
          );
      return true;
    } on Object catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.maybeOf(context)
            ?.showSnackBar(SnackBar(content: Text('返信に失敗しました: $error')));
      }
      return false;
    }
  }

  Future<void> _handleAction(
    BuildContext context,
    WidgetRef ref,
    Post post,
    PostAction action,
  ) async {
    switch (action) {
      case PostAction.edit:
        await editPostFlow(context, ref, post);
      case PostAction.delete:
        await deletePostFlow(context, ref, post);
      case PostAction.react:
        await addReactionFlow(context, ref, post);
      case PostAction.openThread:
        break;
    }
  }

  Future<void> _toggleReaction(
    BuildContext context,
    WidgetRef ref,
    Post post,
    Reaction reaction,
  ) async {
    try {
      await ref
          .read(postActionsProvider)
          .toggleReaction(post, reaction.emoji, add: !reaction.reactedByMe);
    } on Object catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text('$error')));
      }
    }
  }
}
