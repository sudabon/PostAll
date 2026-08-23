// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'create_channel_request.g.dart';

@JsonSerializable()
class CreateChannelRequest {
  const CreateChannelRequest({
    required this.name,
    this.parentId,
  });
  
  factory CreateChannelRequest.fromJson(Map<String, Object?> json) => _$CreateChannelRequestFromJson(json);
  
  final String name;
  final String? parentId;

  Map<String, Object?> toJson() => _$CreateChannelRequestToJson(this);
}
