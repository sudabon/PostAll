import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../state/attachments.dart';
import '../../state/connection.dart';
import '../../state/drafts.dart';
import '../../util/attachment_limits.dart';
import 'attachment_gallery.dart';
import 'attachment_picker.dart';

/// 送信内容。
class ComposerSubmission {
  const ComposerSubmission({required this.body, required this.attachmentIds});

  final String body;
  final List<String> attachmentIds;
}

/// タイムライン／スレッドの入力フォーム。
///
/// 画面最下部に固定し、ソフトキーボードの直上へ留まる。セーフエリア内に収める
/// （mobile-shell spec「ソフトキーボードと入力フォームの共存」）。
class Composer extends ConsumerStatefulWidget {
  const Composer({
    required this.draftKey,
    required this.onSubmit,
    this.hintText = 'メッセージを入力',
    this.enabled = true,
    this.disabledMessage,
    this.picker,
    super.key,
  });

  final DraftKey draftKey;

  /// 成功したら true を返す。false なら下書きを消さない。
  final Future<bool> Function(ComposerSubmission submission) onSubmit;
  final String hintText;
  final bool enabled;
  final String? disabledMessage;

  /// テストで差し替えるための注入口。
  final AttachmentPicker? picker;

  @override
  ConsumerState<Composer> createState() => _ComposerState();
}

class _ComposerState extends ConsumerState<Composer> {
  late final TextEditingController _controller;
  final _focusNode = FocusNode();
  final _attachments = <PendingAttachment>[];
  var _sending = false;
  var _nextLocalId = 0;

  AttachmentPicker get _picker => widget.picker ?? AttachmentPicker();

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: ref.read(draftsProvider.notifier).read(widget.draftKey));
    _controller.addListener(_persistDraft);
  }

  @override
  void didUpdateWidget(Composer oldWidget) {
    super.didUpdateWidget(oldWidget);
    // チャネルやスレッドが切り替わったら、その相手の下書きへ入れ替える。
    if (oldWidget.draftKey != widget.draftKey) {
      _controller.removeListener(_persistDraft);
      _controller.text = ref.read(draftsProvider.notifier).read(widget.draftKey);
      _controller.addListener(_persistDraft);
      setState(_attachments.clear);
    }
  }

  @override
  void dispose() {
    _controller.removeListener(_persistDraft);
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  void _persistDraft() =>
      ref.read(draftsProvider.notifier).write(widget.draftKey, _controller.text);

  bool get _canSubmit =>
      widget.enabled &&
      !_sending &&
      (_controller.text.trim().isNotEmpty || _attachments.any((a) => a.uploaded));

  Future<void> _submit() async {
    if (!_canSubmit) return;
    // 送信中の再操作で重複したポストを作らない（post-composer spec）。
    setState(() => _sending = true);
    try {
      final ok = await widget.onSubmit(
        ComposerSubmission(
          body: _controller.text.trim(),
          attachmentIds: [
            for (final attachment in _attachments)
              if (attachment.attachmentId != null) attachment.attachmentId!,
          ],
        ),
      );
      if (!ok || !mounted) return;
      // 失敗時は入力を残す（post-composer spec「送信に失敗しても入力を失わない」）。
      _controller.clear();
      ref.read(draftsProvider.notifier).clear(widget.draftKey);
      setState(_attachments.clear);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  /// コードブロックの雛形を挿入し、言語指定位置へカーソルを置く。
  void _insertCodeFence() {
    final value = _controller.value;
    final selection = value.selection;
    final start = selection.start < 0 ? value.text.length : selection.start;
    final end = selection.end < 0 ? value.text.length : selection.end;
    final selected = value.text.substring(start, end);
    final inner = selected.isEmpty ? '\n' : '${selected.replaceFirst(RegExp(r'\n?$'), '')}\n';
    final inserted = '```$inner```';
    _controller.value = TextEditingValue(
      text: value.text.substring(0, start) + inserted + value.text.substring(end),
      selection: TextSelection.collapsed(offset: start + 3),
    );
  }

  Future<void> _addAttachments() async {
    final source = await showAttachmentSourceSheet(context);
    if (source == null || !mounted) return;

    final List<PickedFile> picked;
    try {
      picked = switch (source) {
        AttachmentSource.library => [?await _picker.pickFromLibrary()],
        AttachmentSource.camera => [?await _picker.pickFromCamera()],
        AttachmentSource.files => await _picker.pickFiles(),
      };
    } on PermissionDeniedException catch (error) {
      if (mounted) await showPermissionDialog(context, error.message);
      return;
    }

    for (final file in picked) {
      final rejection = attachmentRejection(
        contentType: file.contentType,
        sizeBytes: file.bytes.length,
        alreadyAttached: _attachments.length,
      );
      if (rejection != null) {
        _showMessage(rejection);
        continue;
      }
      final pending = PendingAttachment(
        localId: 'local-${_nextLocalId++}',
        fileName: file.fileName,
        contentType: file.contentType,
        bytes: file.bytes,
      );
      setState(() => _attachments.add(pending));
      await _upload(pending.localId);
    }
  }

  Future<void> _upload(String localId) async {
    final index = _attachments.indexWhere((a) => a.localId == localId);
    if (index < 0) return;
    setState(() => _attachments[index] = _attachments[index].copyWith(progress: 0, clearError: true));
    try {
      final uploaded = await ref.read(attachmentUploaderProvider).upload(
            _attachments[index],
            onProgress: (progress) {
              final at = _attachments.indexWhere((a) => a.localId == localId);
              if (at < 0 || !mounted) return;
              setState(() => _attachments[at] = _attachments[at].copyWith(progress: progress));
            },
          );
      final at = _attachments.indexWhere((a) => a.localId == localId);
      if (at < 0 || !mounted) return;
      setState(() => _attachments[at] = uploaded);
    } on Object catch (error) {
      final at = _attachments.indexWhere((a) => a.localId == localId);
      if (at < 0 || !mounted) return;
      setState(() => _attachments[at] = _attachments[at].copyWith(error: '$error'));
    }
  }

  void _showMessage(String message) =>
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(message)));

  @override
  Widget build(BuildContext context) {
    final offline = ref.watch(connectionProvider) == BackendConnection.offline;
    final enabled = widget.enabled && !offline;

    return Material(
      elevation: 4,
      child: SafeArea(
        top: false,
        child: Padding(
          // キーボードの直上へ留める。
          padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (!enabled)
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
                  child: Text(
                    offline
                        ? 'バックエンドへ接続できないため投稿できません'
                        : (widget.disabledMessage ?? 'チャネルを選択してください'),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
              PendingAttachmentStrip(
                attachments: _attachments,
                onRemove: (localId) =>
                    setState(() => _attachments.removeWhere((a) => a.localId == localId)),
                onRetry: _upload,
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(8, 6, 8, 8),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    IconButton(
                      tooltip: '添付を追加',
                      icon: const Icon(Icons.add_circle_outline),
                      onPressed: enabled ? _addAttachments : null,
                    ),
                    IconButton(
                      tooltip: 'コードブロックを挿入',
                      icon: const Icon(Icons.code),
                      onPressed: enabled ? _insertCodeFence : null,
                    ),
                    Expanded(
                      child: ConstrainedBox(
                        // 上限まで伸ばし、それ以上は入力欄の中でスクロールさせる。
                        constraints: const BoxConstraints(maxHeight: 140),
                        child: TextField(
                          key: const Key('composer-input'),
                          controller: _controller,
                          focusNode: _focusNode,
                          enabled: enabled,
                          maxLines: null,
                          keyboardType: TextInputType.multiline,
                          textInputAction: TextInputAction.newline,
                          decoration: InputDecoration(
                            hintText: widget.hintText,
                            border: const OutlineInputBorder(),
                            isDense: true,
                          ),
                          onChanged: (_) => setState(() {}),
                        ),
                      ),
                    ),
                    IconButton(
                      key: const Key('composer-send'),
                      tooltip: '送信',
                      icon: _sending
                          ? const SizedBox.square(
                              dimension: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.send),
                      onPressed: _canSubmit && enabled ? _submit : null,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
