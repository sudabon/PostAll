// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'error.g.dart';

@JsonSerializable()
class Error {
  const Error({
    required this.code,
    required this.message,
    this.details,
  });
  
  factory Error.fromJson(Map<String, Object?> json) => _$ErrorFromJson(json);
  
  /// 機械可読なエラーコード
  final String code;

  /// 人間可読なメッセージ
  final String message;
  final dynamic details;

  Map<String, Object?> toJson() => _$ErrorToJson(this);
}
