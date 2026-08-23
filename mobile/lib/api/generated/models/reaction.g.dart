// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'reaction.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Reaction _$ReactionFromJson(Map<String, dynamic> json) => Reaction(
  emoji: Emoji.fromJson(json['emoji'] as Map<String, dynamic>),
  count: (json['count'] as num).toInt(),
  reactedByMe: json['reactedByMe'] as bool,
  reactorIds: (json['reactorIds'] as List<dynamic>)
      .map((e) => e as String)
      .toList(),
);

Map<String, dynamic> _$ReactionToJson(Reaction instance) => <String, dynamic>{
  'emoji': instance.emoji,
  'count': instance.count,
  'reactedByMe': instance.reactedByMe,
  'reactorIds': instance.reactorIds,
};
