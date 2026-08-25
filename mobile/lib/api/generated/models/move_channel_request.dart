// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'move_channel_request.g.dart';

@JsonSerializable()
class MoveChannelRequest {
  const MoveChannelRequest({
    this.parentId,
    this.beforeId,
    this.afterId,
  });
  
  factory MoveChannelRequest.fromJson(Map<String, Object?> json) => _$MoveChannelRequestFromJson(json);
  
  final String? parentId;

  /// このチャネルの直前に挿入する。null なら末尾。
  final String? beforeId;

  /// このチャネルの直後に挿入する。
  final String? afterId;

  Map<String, Object?> toJson() => _$MoveChannelRequestToJson(this);
}
