// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'attachment.dart';
import 'reaction.dart';

part 'post.g.dart';

@JsonSerializable()
class Post {
  const Post({
    required this.id,
    required this.channelId,
    required this.authorId,
    required this.body,
    required this.createdAt,
    required this.updatedAt,
    required this.deleted,
    required this.replyCount,
    this.threadRootId,
    this.editedAt,
    this.lastReplyAt,
    this.attachments,
    this.reactions,
  });
  
  factory Post.fromJson(Map<String, Object?> json) => _$PostFromJson(json);
  
  final String id;
  final String channelId;
  final String? threadRootId;
  final String authorId;
  final String body;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DateTime? editedAt;

  /// 論理削除済み。スレッド親のプレースホルダでのみ true になる。
  final bool deleted;
  final int replyCount;
  final DateTime? lastReplyAt;
  final List<Attachment>? attachments;

  /// 最初に付与された順のリアクション集計。
  final List<Reaction>? reactions;

  Map<String, Object?> toJson() => _$PostToJson(this);
}
