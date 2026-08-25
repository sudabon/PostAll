// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'change_event.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ChangeEvent _$ChangeEventFromJson(Map<String, dynamic> json) => ChangeEvent(
  id: json['id'] as String,
  eventType: ChangeEventEventType.fromJson(json['eventType'] as String),
  createdAt: DateTime.parse(json['createdAt'] as String),
  channelId: json['channelId'] as String?,
  postId: json['postId'] as String?,
  threadRootId: json['threadRootId'] as String?,
);

Map<String, dynamic> _$ChangeEventToJson(ChangeEvent instance) =>
    <String, dynamic>{
      'id': instance.id,
      'eventType': instance.eventType,
      'channelId': instance.channelId,
      'postId': instance.postId,
      'threadRootId': instance.threadRootId,
      'createdAt': instance.createdAt.toIso8601String(),
    };
