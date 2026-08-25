// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'edit_post_request.g.dart';

@JsonSerializable()
class EditPostRequest {
  const EditPostRequest({
    required this.body,
    this.attachmentIds,
  });
  
  factory EditPostRequest.fromJson(Map<String, Object?> json) => _$EditPostRequestFromJson(json);
  
  final String body;

  /// 指定した場合は添付の集合を置き換える。省略時は既存の添付を維持する。
  final List<String>? attachmentIds;

  Map<String, Object?> toJson() => _$EditPostRequestToJson(this);
}
