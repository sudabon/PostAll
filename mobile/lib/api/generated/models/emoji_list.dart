// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'emoji.dart';

part 'emoji_list.g.dart';

@JsonSerializable()
class EmojiList {
  const EmojiList({
    required this.emojis,
  });
  
  factory EmojiList.fromJson(Map<String, Object?> json) => _$EmojiListFromJson(json);
  
  final List<Emoji> emojis;

  Map<String, Object?> toJson() => _$EmojiListToJson(this);
}
