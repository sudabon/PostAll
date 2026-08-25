import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:markdown/markdown.dart' as md;
import 'package:url_launcher/url_launcher.dart';

import 'code_block.dart';
import 'mermaid_view.dart';

/// ポスト本文の描画。
///
/// Markdown の意味論は React 側と揃え、実装のみプラットフォーム別にする
/// （design.md D10）。`mermaid` のコードブロックだけ図として描く。
class PostMarkdown extends StatelessWidget {
  const PostMarkdown({required this.body, super.key});

  final String body;

  @override
  Widget build(BuildContext context) {
    return MarkdownBody(
      data: body,
      // モバイルでは長押しをポストの操作メニューに使うため、本文の選択は行わない
      // （post-timeline spec「モバイルでの長押し操作」）。コードのコピーは
      // CodeBlock のコピーボタンから行う。
      selectable: false,
      extensionSet: md.ExtensionSet.gitHubFlavored,
      onTapLink: (_, href, __) => _openLink(href),
      builders: {'pre': _FencedCodeBuilder()},
      styleSheet: MarkdownStyleSheet.fromTheme(Theme.of(context)).copyWith(
        // フェンス付きコードは _FencedCodeBuilder が描くため、既定の装飾を消す。
        codeblockDecoration: const BoxDecoration(),
        codeblockPadding: EdgeInsets.zero,
        blockquoteDecoration: BoxDecoration(
          border: Border(left: BorderSide(color: Theme.of(context).dividerColor, width: 3)),
        ),
      ),
    );
  }

  /// 危険なスキームのリンクは開かない（rich-content-rendering spec）。
  static Future<void> _openLink(String? href) async {
    if (href == null) return;
    final uri = Uri.tryParse(href);
    if (uri == null) return;
    if (uri.scheme != 'http' && uri.scheme != 'https' && uri.scheme != 'mailto') return;
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }
}

/// フェンス付きコードブロックを [CodeBlock] / [MermaidView] へ振り分ける。
class _FencedCodeBuilder extends MarkdownElementBuilder {
  @override
  Widget? visitElementAfter(md.Element element, TextStyle? preferredStyle) {
    final code = element.children?.whereType<md.Element>().firstOrNull;
    if (code == null) return null;

    final source = code.textContent.replaceFirst(RegExp(r'\n$'), '');
    final language = _languageOf(code);
    if (language == 'mermaid') return MermaidView(source: source);
    return CodeBlock(source: source, language: language);
  }

  /// fenced code は `language-<name>` の class を持つ。
  static String? _languageOf(md.Element code) {
    final className = code.attributes['class'];
    if (className == null) return null;
    for (final name in className.split(' ')) {
      if (name.startsWith('language-')) return name.substring('language-'.length);
    }
    return null;
  }
}
