import 'dart:convert';

/// Mermaid ソースを実行用スクリプトと分離した HTML を組み立てる。
///
/// ソースは UTF-8 の Base64 として埋め込み、`</script>` や JavaScript の
/// 行区切り文字が inline script を途中で閉じないようにする。
String buildMermaidDocument({
  required String script,
  required String source,
  required bool dark,
}) {
  final encodedSource = base64Encode(utf8.encode(source));
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
      const encodedSource = '$encodedSource';
      const sourceBytes = Uint8Array.from(atob(encodedSource), (char) => char.charCodeAt(0));
      const source = new TextDecoder().decode(sourceBytes);
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: ${dark ? "'dark'" : "'default'"} });
      const { svg } = await mermaid.render('postall-mermaid', source);
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
