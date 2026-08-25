// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'channel.dart';

part 'channel_list.g.dart';

@JsonSerializable()
class ChannelList {
  const ChannelList({
    required this.channels,
  });
  
  factory ChannelList.fromJson(Map<String, Object?> json) => _$ChannelListFromJson(json);
  
  final List<Channel> channels;

  Map<String, Object?> toJson() => _$ChannelListToJson(this);
}
