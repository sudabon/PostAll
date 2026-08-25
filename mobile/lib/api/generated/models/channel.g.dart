// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'channel.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Channel _$ChannelFromJson(Map<String, dynamic> json) => Channel(
  id: json['id'] as String,
  name: json['name'] as String,
  sortKey: json['sortKey'] as String,
  createdAt: DateTime.parse(json['createdAt'] as String),
  updatedAt: DateTime.parse(json['updatedAt'] as String),
  parentId: json['parentId'] as String?,
);

Map<String, dynamic> _$ChannelToJson(Channel instance) => <String, dynamic>{
  'id': instance.id,
  'parentId': instance.parentId,
  'name': instance.name,
  'sortKey': instance.sortKey,
  'createdAt': instance.createdAt.toIso8601String(),
  'updatedAt': instance.updatedAt.toIso8601String(),
};
