import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/generated/models.dart';
import '../../state/drafts.dart';
import '../../state/post_actions.dart';
import '../../state/thread.dart';
import '../../state/timeline.dart';
import '../widgets/attachment_picker.dart';
import '../widgets/composer.dart';
import '../widgets/post_tile.dart';
import '../widgets/reaction_bar.dart';
import '../widgets/timeline_list.dart';
import 'post_edit_dialog.dart';

/// 1 チャネルのタイムラインと入力フォーム。
///
/// 広幅では分割表示の右側、狭幅では独立した画面として使う。
class TimelineScreen extends ConsumerWidget {
  const TimelineScreen({
    required this.channel,
    this.showAppBar = true,
    this.attachmentPicker,
    super.key,
  });

  final Channel channel;
  final bool showAppBar;
  final AttachmentPicker? attachmentPicker;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final timeline = ref.watch(timelineProvider(channel.id));

    final body = Column(
      children: [
        Expanded(
          child: timeline.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (error, _) => Center(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text('ポストを取得できませんでした\n$error', textAlign: TextAlign.center),
                    const SizedBox(height: 8),
                    OutlinedButton(
                      onPressed: () => ref.read(timelineProvider(channel.id).notifier).reload(),
                      child: const Text('再試行'),
                    ),
                  ],
                ),
              ),
            ),
            data: (state) => TimelineList(
              posts: state.posts,
              loadingOlder: state.loadingOlder,
              atOldest: state.atOldest,
              onLoadOlder: ref.read(timelineProvider(channel.id).notifier).loadOlder,
              onAction: (post, action) => _handleAction(context, ref, post, action),
              onToggleReaction: (post, reaction) => _toggleReaction(context, ref, post, reaction),
            ),
          ),
        ),
        Composer(
          draftKey: DraftKey.channel(channel.id),
          hintText: '#${channel.name} へ投稿',
          picker: attachmentPicker,
          onSubmit: (submission) => _submit(context, ref, submission),
        ),
      ],
    );

    if (!showAppBar) return body;
    return Scaffold(appBar: AppBar(title: Text(channel.name)), body: body);
  }

  Future<bool> _submit(BuildContext context, WidgetRef ref, ComposerSubmission submission) async {
    try {
      await ref.read(postActionsProvider).createPost(
            channel.id,
            submission.body,
            submission.attachmentIds,
          );
      return true;
    } on Object catch (error) {
      // 入力は Composer 側に残る。
      if (context.mounted) _notify(context, '送信に失敗しました: $error');
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
      case PostAction.openThread:
        ref.read(openThreadProvider.notifier).open(post.id);
      case PostAction.edit:
        await editPostFlow(context, ref, post);
      case PostAction.delete:
        await deletePostFlow(context, ref, post);
      case PostAction.react:
        await addReactionFlow(context, ref, post);
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
      if (context.mounted) _notify(context, '$error');
    }
  }
}

/// 絵文字を選んでリアクションを付ける。
Future<void> addReactionFlow(BuildContext context, WidgetRef ref, Post post) async {
  final emoji = await showEmojiPicker(context);
  if (emoji == null) return;
  final already = (post.reactions ?? const <Reaction>[])
      .any((reaction) => reaction.emoji.id == emoji.id && reaction.reactedByMe);
  // 同じ絵文字を重ねて付けない（emoji-reactions spec「重複した付与を拒否する」）。
  if (already) return;
  try {
    await ref.read(postActionsProvider).toggleReaction(post, emoji, add: true);
  } on Object catch (error) {
    if (context.mounted) _notify(context, '$error');
  }
}

void _notify(BuildContext context, String message) =>
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(message)));
