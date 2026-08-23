// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'change_event_event_type.dart';

part 'change_event.g.dart';

@JsonSerializable()
class ChangeEvent {
  const ChangeEvent({
    required this.id,
    required this.eventType,
    required this.createdAt,
    this.channelId,
    this.postId,
    this.threadRootId,
  });
  
  factory ChangeEvent.fromJson(Map<String, Object?> json) => _$ChangeEventFromJson(json);
  
  /// JavaScript で精度を失わない十進文字列の単調増加 ID。
  final String id;
  final ChangeEventEventType eventType;
  final String? channelId;
  final String? postId;
  final String? threadRootId;
  final DateTime createdAt;

  Map<String, Object?> toJson() => _$ChangeEventToJson(this);
}
