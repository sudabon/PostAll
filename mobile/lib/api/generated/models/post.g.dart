// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'post.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Post _$PostFromJson(Map<String, dynamic> json) => Post(
  id: json['id'] as String,
  channelId: json['channelId'] as String,
  authorId: json['authorId'] as String,
  body: json['body'] as String,
  createdAt: DateTime.parse(json['createdAt'] as String),
  updatedAt: DateTime.parse(json['updatedAt'] as String),
  deleted: json['deleted'] as bool,
  replyCount: (json['replyCount'] as num).toInt(),
  threadRootId: json['threadRootId'] as String?,
  editedAt: json['editedAt'] == null
      ? null
      : DateTime.parse(json['editedAt'] as String),
  lastReplyAt: json['lastReplyAt'] == null
      ? null
      : DateTime.parse(json['lastReplyAt'] as String),
  attachments: (json['attachments'] as List<dynamic>?)
      ?.map((e) => Attachment.fromJson(e as Map<String, dynamic>))
      .toList(),
  reactions: (json['reactions'] as List<dynamic>?)
      ?.map((e) => Reaction.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$PostToJson(Post instance) => <String, dynamic>{
  'id': instance.id,
  'channelId': instance.channelId,
  'threadRootId': instance.threadRootId,
  'authorId': instance.authorId,
  'body': instance.body,
  'createdAt': instance.createdAt.toIso8601String(),
  'updatedAt': instance.updatedAt.toIso8601String(),
  'editedAt': instance.editedAt?.toIso8601String(),
  'deleted': instance.deleted,
  'replyCount': instance.replyCount,
  'lastReplyAt': instance.lastReplyAt?.toIso8601String(),
  'attachments': instance.attachments,
  'reactions': instance.reactions,
};
