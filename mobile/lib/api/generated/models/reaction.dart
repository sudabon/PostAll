// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'emoji.dart';

part 'reaction.g.dart';

@JsonSerializable()
class Reaction {
  const Reaction({
    required this.emoji,
    required this.count,
    required this.reactedByMe,
    required this.reactorIds,
  });
  
  factory Reaction.fromJson(Map<String, Object?> json) => _$ReactionFromJson(json);
  
  final Emoji emoji;
  final int count;
  final bool reactedByMe;

  /// 付与者 ID。reactedByMe が true の場合は現在のユーザーを先頭にする。
  final List<String> reactorIds;

  Map<String, Object?> toJson() => _$ReactionToJson(this);
}
