// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'thread.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Thread _$ThreadFromJson(Map<String, dynamic> json) => Thread(
  root: Post.fromJson(json['root'] as Map<String, dynamic>),
  replies: (json['replies'] as List<dynamic>)
      .map((e) => Post.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$ThreadToJson(Thread instance) => <String, dynamic>{
  'root': instance.root,
  'replies': instance.replies,
};
