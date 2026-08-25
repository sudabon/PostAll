import 'package:flutter/material.dart';

/// 1 行ないし複数行のテキストを尋ねるダイアログ。取り消したら null を返す。
///
/// [TextEditingController] はこのウィジェットが所有する。呼び出し側で作って
/// `showDialog` の直後に破棄すると、閉じるアニメーションの最中に
/// TextField が破棄済みのコントローラへ触れてしまう。
Future<String?> promptForText(
  BuildContext context, {
  required String title,
  String initialValue = '',
  String? label,
  String confirmLabel = '保存',
  bool multiline = false,
  Key? fieldKey,
  Key? confirmKey,
}) {
  return showDialog<String>(
    context: context,
    builder: (context) => _TextPromptDialog(
      title: title,
      initialValue: initialValue,
      label: label,
      confirmLabel: confirmLabel,
      multiline: multiline,
      fieldKey: fieldKey,
      confirmKey: confirmKey,
    ),
  );
}

class _TextPromptDialog extends StatefulWidget {
  const _TextPromptDialog({
    required this.title,
    required this.initialValue,
    required this.label,
    required this.confirmLabel,
    required this.multiline,
    required this.fieldKey,
    required this.confirmKey,
  });

  final String title;
  final String initialValue;
  final String? label;
  final String confirmLabel;
  final bool multiline;
  final Key? fieldKey;
  final Key? confirmKey;

  @override
  State<_TextPromptDialog> createState() => _TextPromptDialogState();
}

class _TextPromptDialogState extends State<_TextPromptDialog> {
  late final TextEditingController _controller =
      TextEditingController(text: widget.initialValue);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.title),
      content: TextField(
        key: widget.fieldKey,
        controller: _controller,
        autofocus: true,
        maxLines: widget.multiline ? null : 1,
        decoration: InputDecoration(
          labelText: widget.label,
          border: widget.multiline ? const OutlineInputBorder() : null,
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取り消す'),
        ),
        TextButton(
          key: widget.confirmKey,
          onPressed: () => Navigator.of(context).pop(_controller.text),
          child: Text(widget.confirmLabel),
        ),
      ],
    );
  }
}

/// はい／いいえを尋ねる。承認したら true。
Future<bool> confirm(
  BuildContext context, {
  required String title,
  required String message,
  String confirmLabel = 'OK',
  Key? confirmKey,
}) async {
  final answer = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('取り消す'),
        ),
        TextButton(
          key: confirmKey,
          onPressed: () => Navigator.of(context).pop(true),
          child: Text(confirmLabel),
        ),
      ],
    ),
  );
  return answer ?? false;
}
