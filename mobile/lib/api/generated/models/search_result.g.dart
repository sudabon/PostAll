// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'search_result.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SearchResult _$SearchResultFromJson(Map<String, dynamic> json) => SearchResult(
  postId: json['postId'] as String,
  timelinePostId: json['timelinePostId'] as String,
  channelId: json['channelId'] as String,
  channelName: json['channelName'] as String,
  body: json['body'] as String,
  createdAt: DateTime.parse(json['createdAt'] as String),
  threadRootId: json['threadRootId'] as String?,
);

Map<String, dynamic> _$SearchResultToJson(SearchResult instance) =>
    <String, dynamic>{
      'postId': instance.postId,
      'timelinePostId': instance.timelinePostId,
      'channelId': instance.channelId,
      'channelName': instance.channelName,
      'threadRootId': instance.threadRootId,
      'body': instance.body,
      'createdAt': instance.createdAt.toIso8601String(),
    };
