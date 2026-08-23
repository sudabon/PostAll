// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'post.dart';

part 'post_list.g.dart';

@JsonSerializable()
class PostList {
  const PostList({
    required this.posts,
    this.nextBefore,
  });
  
  factory PostList.fromJson(Map<String, Object?> json) => _$PostListFromJson(json);
  
  final List<Post> posts;

  /// より古いポストを取得するカーソル。これ以上過去が無ければ null。
  final String? nextBefore;

  Map<String, Object?> toJson() => _$PostListToJson(this);
}
