import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/generated/models.dart';
import '../../state/post_actions.dart';
import '../widgets/text_prompt.dart';

/// 本文を編集して保存する。取り消すと変更を捨てる（post-timeline spec）。
Future<void> editPostFlow(BuildContext context, WidgetRef ref, Post post) async {
  final input = await promptForText(
    context,
    title: 'ポストを編集',
    initialValue: post.body,
    multiline: true,
    fieldKey: const Key('post-edit-input'),
    confirmKey: const Key('post-edit-save'),
  );
  if (input == null || !context.mounted) return;

  final body = input.trim();
  // 添付を持たないポストは本文を空にできない。
  if (body.isEmpty && (post.attachments ?? const <Attachment>[]).isEmpty) {
    _notify(context, '本文または添付のいずれかが必要です');
    return;
  }

  try {
    await ref.read(postActionsProvider).editPost(post, body);
  } on Object catch (error) {
    if (context.mounted) _notify(context, '保存に失敗しました: $error');
  }
}

/// 削除は実行前に確認を求める（post-timeline spec）。
Future<void> deletePostFlow(BuildContext context, WidgetRef ref, Post post) async {
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

void _notify(BuildContext context, String message) =>
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(message)));
