// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'emoji.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Emoji _$EmojiFromJson(Map<String, dynamic> json) => Emoji(
  id: json['id'] as String,
  shortcode: json['shortcode'] as String,
  imagePath: json['imagePath'] as String,
  checksum: json['checksum'] as String,
);

Map<String, dynamic> _$EmojiToJson(Emoji instance) => <String, dynamic>{
  'id': instance.id,
  'shortcode': instance.shortcode,
  'imagePath': instance.imagePath,
  'checksum': instance.checksum,
};
