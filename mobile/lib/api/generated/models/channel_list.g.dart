// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'channel_list.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ChannelList _$ChannelListFromJson(Map<String, dynamic> json) => ChannelList(
  channels: (json['channels'] as List<dynamic>)
      .map((e) => Channel.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$ChannelListToJson(ChannelList instance) =>
    <String, dynamic>{'channels': instance.channels};
