// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'rename_channel_request.g.dart';

@JsonSerializable()
class RenameChannelRequest {
  const RenameChannelRequest({
    required this.name,
  });
  
  factory RenameChannelRequest.fromJson(Map<String, Object?> json) => _$RenameChannelRequestFromJson(json);
  
  final String name;

  Map<String, Object?> toJson() => _$RenameChannelRequestToJson(this);
}
