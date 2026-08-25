// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'emoji_list.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EmojiList _$EmojiListFromJson(Map<String, dynamic> json) => EmojiList(
  emojis: (json['emojis'] as List<dynamic>)
      .map((e) => Emoji.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$EmojiListToJson(EmojiList instance) => <String, dynamic>{
  'emojis': instance.emojis,
};
