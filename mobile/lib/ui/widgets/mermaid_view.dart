import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:visibility_detector/visibility_detector.dart';
import 'package:webview_flutter/webview_flutter.dart';

import 'code_block.dart';

/// 同時に生成する WebView の上限。
///
/// Mermaid を含むポストが多数あるタイムラインでも描画コンテキストが増え続けない
/// ようにする（mobile-shell spec「描画の負荷を抑える」、design.md のリスク欄）。
const int maxConcurrentMermaidViews = 3;

/// WebView の同時生成数を制限する順番待ち。
///
/// 可視になったポストから順に枠を取り、画面外へ出たら枠を返す。
class MermaidSlots {
  MermaidSlots({this.capacity = maxConcurrentMermaidViews});

  final int capacity;
  final _waiting = <Completer<void>>[];
  int _inUse = 0;

  int get inUse => _inUse;

  Future<void> acquire() {
    if (_inUse < capacity) {
      _inUse += 1;
      return Future<void>.value();
    }
    final completer = Completer<void>();
    _waiting.add(completer);
    return completer.future;
  }

  void release() {
    if (_waiting.isNotEmpty) {
      _waiting.removeAt(0).complete();
      return;
    }
    if (_inUse > 0) _inUse -= 1;
  }
}

/// アプリ全体で共有する枠。
final mermaidSlots = MermaidSlots();

/// Mermaid 図。可視範囲に入ってから WebView を作る。
///
/// React 側と同じ mermaid.min.js を assets から読ませることで、
/// 「同じ図が両方で同じに見える」を構成として保証する（design.md D10）。
class MermaidView extends StatefulWidget {
  const MermaidView({required this.source, super.key, this.slots});

  final String source;

  /// テストで差し替えるための注入口。既定はアプリ共有の [mermaidSlots]。
  final MermaidSlots? slots;

  @override
  State<MermaidView> createState() => _MermaidViewState();
}

enum _MermaidMode { diagram, source }

class _MermaidViewState extends State<MermaidView> {
  WebViewController? _controller;
  bool _requested = false;
  bool _holdsSlot = false;
  bool _failed = false;
  double _height = 120;
  _MermaidMode _mode = _MermaidMode.diagram;

  MermaidSlots get _slots => widget.slots ?? mermaidSlots;

  @override
  void dispose() {
    if (_holdsSlot) _slots.release();
    super.dispose();
  }

  Future<void> _prepare() async {
    if (_requested) return;
    _requested = true;
    await _slots.acquire();
    if (!mounted) {
      _slots.release();
      return;
    }
    _holdsSlot = true;

    final controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.transparent)
      ..addJavaScriptChannel(
        'MermaidHost',
        onMessageReceived: (message) {
          final payload = jsonDecode(message.message) as Map<String, Object?>;
          if (!mounted) return;
          setState(() {
            if (payload['error'] != null) {
              _failed = true;
              return;
            }
            final height = (payload['height'] as num?)?.toDouble();
            if (height != null && height > 0) _height = height + 16;
          });
        },
      );

    final bundle = DefaultAssetBundle.of(context);
    final dark = Theme.of(context).brightness == Brightness.dark;
    try {
      final script = await bundle.loadString('assets/mermaid/mermaid.min.js');
      await controller.loadHtmlString(_html(script: script, dark: dark), baseUrl: 'about:blank');
    } on Object {
      if (mounted) setState(() => _failed = true);
      return;
    }
    if (mounted) setState(() => _controller = controller);
  }

  String _html({required String script, required bool dark}) {
    final source = jsonEncode(widget.source);
    return '''
<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin: 0; padding: 0; background: transparent; }
  #host { overflow-x: auto; }
</style>
<script>$script</script>
</head>
<body>
<div id="host"></div>
<script>
  (async () => {
    const report = (payload) => MermaidHost.postMessage(JSON.stringify(payload));
    try {
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: ${dark ? "'dark'" : "'default'"} });
      const { svg } = await mermaid.render('postall-mermaid', $source);
      document.getElementById('host').innerHTML = svg;
      report({ height: document.getElementById('host').scrollHeight });
    } catch (error) {
      report({ error: String(error) });
    }
  })();
</script>
</body></html>
''';
  }

  @override
  Widget build(BuildContext context) {
    // 描画できない定義はソースコードとして見せる（rich-content-rendering spec）。
    if (_failed || _mode == _MermaidMode.source) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (!_failed) _toggle(label: '図を表示', to: _MermaidMode.diagram),
          CodeBlock(source: widget.source, language: 'mermaid'),
          if (_failed)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                '図の描画に失敗しました',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
        ],
      );
    }

    return VisibilityDetector(
      key: ValueKey('mermaid-${widget.source.hashCode}'),
      onVisibilityChanged: (info) {
        if (info.visibleFraction > 0) unawaited(_prepare());
      },
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _toggle(label: 'ソースを表示', to: _MermaidMode.source),
          Container(
            height: _height,
            decoration: BoxDecoration(
              border: Border.all(color: Theme.of(context).dividerColor),
              borderRadius: BorderRadius.circular(6),
            ),
            child: _controller == null
                ? const Center(child: SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2)))
                : WebViewWidget(controller: _controller!),
          ),
        ],
      ),
    );
  }

  Widget _toggle({required String label, required _MermaidMode to}) => Align(
        alignment: Alignment.centerRight,
        child: TextButton(
          onPressed: () => setState(() => _mode = to),
          child: Text(label, style: Theme.of(context).textTheme.labelSmall),
        ),
      );
}
