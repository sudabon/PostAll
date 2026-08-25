// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'channel.g.dart';

@JsonSerializable()
class Channel {
  const Channel({
    required this.id,
    required this.name,
    required this.sortKey,
    required this.createdAt,
    required this.updatedAt,
    this.parentId,
  });
  
  factory Channel.fromJson(Map<String, Object?> json) => _$ChannelFromJson(json);
  
  final String id;
  final String? parentId;
  final String name;
  final String sortKey;
  final DateTime createdAt;
  final DateTime updatedAt;

  Map<String, Object?> toJson() => _$ChannelToJson(this);
}
