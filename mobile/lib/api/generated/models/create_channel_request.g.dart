// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'create_channel_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CreateChannelRequest _$CreateChannelRequestFromJson(
  Map<String, dynamic> json,
) => CreateChannelRequest(
  name: json['name'] as String,
  parentId: json['parentId'] as String?,
);

Map<String, dynamic> _$CreateChannelRequestToJson(
  CreateChannelRequest instance,
) => <String, dynamic>{'name': instance.name, 'parentId': instance.parentId};
