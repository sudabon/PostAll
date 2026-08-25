import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_highlight/flutter_highlight.dart';
import 'package:flutter_highlight/themes/atom-one-dark.dart';
import 'package:flutter_highlight/themes/atom-one-light.dart';
import 'package:highlight/languages/all.dart' show allLanguages;

/// シンタックスハイライト付きのコードブロック。
///
/// 横幅を超える行はブロック内で横スクロールさせ、画面全体は横スクロールしない
/// （mobile-shell spec「コードブロックを表示する」）。
class CodeBlock extends StatelessWidget {
  const CodeBlock({required this.source, this.language, super.key});

  final String source;
  final String? language;

  /// highlight が知らない言語は素のテキストとして描く
  /// （rich-content-rendering spec「未対応言語の指定」）。
  String? get _resolvedLanguage {
    final value = language?.trim().toLowerCase();
    if (value == null || value.isEmpty) return null;
    return allLanguages.containsKey(value) ? value : null;
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final resolved = _resolvedLanguage;

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      decoration: BoxDecoration(
        color: dark ? const Color(0xFF23272E) : const Color(0xFFF6F7F9),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: Theme.of(context).dividerColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              if (resolved != null)
                Padding(
                  padding: const EdgeInsets.only(left: 10),
                  child: Text(resolved, style: Theme.of(context).textTheme.labelSmall),
                ),
              const Spacer(),
              IconButton(
                icon: const Icon(Icons.copy, size: 16),
                tooltip: 'コードをコピー',
                onPressed: () async {
                  await Clipboard.setData(ClipboardData(text: source));
                  if (!context.mounted) return;
                  ScaffoldMessenger.maybeOf(context)?.showSnackBar(
                    const SnackBar(content: Text('コードをコピーしました')),
                  );
                },
              ),
            ],
          ),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.fromLTRB(10, 0, 10, 10),
            child: HighlightView(
              source,
              language: resolved ?? 'plaintext',
              theme: dark ? atomOneDarkTheme : atomOneLightTheme,
              padding: EdgeInsets.zero,
              textStyle: const TextStyle(fontFamily: 'Menlo', fontSize: 12.5),
            ),
          ),
        ],
      ),
    );
  }
}
