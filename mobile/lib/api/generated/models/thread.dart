// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'post.dart';

part 'thread.g.dart';

@JsonSerializable()
class Thread {
  const Thread({
    required this.root,
    required this.replies,
  });
  
  factory Thread.fromJson(Map<String, Object?> json) => _$ThreadFromJson(json);
  
  final Post root;
  final List<Post> replies;

  Map<String, Object?> toJson() => _$ThreadToJson(this);
}
