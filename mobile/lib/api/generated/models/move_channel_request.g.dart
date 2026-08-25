// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'move_channel_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MoveChannelRequest _$MoveChannelRequestFromJson(Map<String, dynamic> json) =>
    MoveChannelRequest(
      parentId: json['parentId'] as String?,
      beforeId: json['beforeId'] as String?,
      afterId: json['afterId'] as String?,
    );

Map<String, dynamic> _$MoveChannelRequestToJson(MoveChannelRequest instance) =>
    <String, dynamic>{
      'parentId': instance.parentId,
      'beforeId': instance.beforeId,
      'afterId': instance.afterId,
    };
