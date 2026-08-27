// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'change_event_page.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ChangeEventPage _$ChangeEventPageFromJson(Map<String, dynamic> json) =>
    ChangeEventPage(
      events: (json['events'] as List<dynamic>)
          .map((e) => ChangeEvent.fromJson(e as Map<String, dynamic>))
          .toList(),
      nextAfter: json['nextAfter'] as String,
      hasMore: json['hasMore'] as bool,
      resetRequired: json['resetRequired'] as bool?,
    );

Map<String, dynamic> _$ChangeEventPageToJson(ChangeEventPage instance) =>
    <String, dynamic>{
      'events': instance.events,
      'nextAfter': instance.nextAfter,
      'hasMore': instance.hasMore,
      'resetRequired': instance.resetRequired,
    };
