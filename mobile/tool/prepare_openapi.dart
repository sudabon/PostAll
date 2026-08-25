// api/openapi.yaml を swagger_parser が読める形へ正規化して JSON で書き出す。
//
// swagger_parser 1.44 はパス項目レベルの `parameters` を操作オブジェクトとして
// 読もうとして失敗する。ここで各操作へ畳み込んでからパス項目から取り除く。
// api/openapi.yaml 自体は single source of truth のまま変更しない。
import 'dart:convert';
import 'dart:io';

import 'package:yaml/yaml.dart';

const _methods = {'get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'};

void main(List<String> args) {
  final source = File(args.isNotEmpty ? args[0] : '../api/openapi.yaml');
  final target = File(args.length > 1 ? args[1] : 'build/openapi.normalized.json');

  if (!source.existsSync()) {
    stderr.writeln('OpenAPI 仕様が見つかりません: ${source.path}');
    exit(1);
  }

  final spec = _plain(loadYaml(source.readAsStringSync())) as Map<String, dynamic>;
  final paths = spec['paths'];
  if (paths is Map<String, dynamic>) {
    for (final item in paths.values) {
      if (item is! Map<String, dynamic>) continue;
      final shared = item.remove('parameters');
      if (shared is! List) continue;
      for (final entry in item.entries) {
        if (!_methods.contains(entry.key)) continue;
        final operation = entry.value;
        if (operation is! Map<String, dynamic>) continue;
        operation['parameters'] = [...shared, ...?(operation['parameters'] as List?)];
      }
    }
  }

  target.parent.createSync(recursive: true);
  target.writeAsStringSync(const JsonEncoder.withIndent('  ').convert(spec));
  stdout.writeln('正規化しました: ${source.path} -> ${target.path}');
}

Object? _plain(Object? node) => switch (node) {
      YamlMap() => {for (final e in node.entries) e.key.toString(): _plain(e.value)},
      YamlList() => node.map(_plain).toList(),
      YamlScalar() => node.value,
      Map() => {for (final e in node.entries) e.key.toString(): _plain(e.value)},
      List() => node.map(_plain).toList(),
      _ => node,
    };
