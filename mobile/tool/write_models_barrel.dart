// 生成されたモデルをまとめて export する barrel を書き出す。
// swagger_parser の export.dart は REST クライアントも含むため、ここで作り直す。
import 'dart:io';

void main() {
  final dir = Directory('lib/api/generated/models');
  final names = dir
      .listSync()
      .whereType<File>()
      .map((f) => f.uri.pathSegments.last)
      .where((n) => n.endsWith('.dart') && !n.endsWith('.g.dart'))
      .toList()
    ..sort();

  File('lib/api/generated/models.dart').writeAsStringSync([
    '// GENERATED CODE - DO NOT MODIFY BY HAND',
    '// api/openapi.yaml から生成されたモデルの barrel。`make generate` で再生成する。',
    '',
    ...names.map((n) => "export 'models/$n';"),
    '',
  ].join('\n'));

  stdout.writeln('barrel を書き出しました: ${names.length} models');
}
