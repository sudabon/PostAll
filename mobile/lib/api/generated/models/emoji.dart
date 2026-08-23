// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'emoji.g.dart';

@JsonSerializable()
class Emoji {
  const Emoji({
    required this.id,
    required this.shortcode,
    required this.imagePath,
    required this.checksum,
  });
  
  factory Emoji.fromJson(Map<String, Object?> json) => _$EmojiFromJson(json);
  
  final String id;
  final String shortcode;
  final String imagePath;
  final String checksum;

  Map<String, Object?> toJson() => _$EmojiToJson(this);
}
