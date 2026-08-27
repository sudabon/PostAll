// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'change_event.dart';

part 'change_event_page.g.dart';

@JsonSerializable()
class ChangeEventPage {
  const ChangeEventPage({
    required this.events,
    required this.nextAfter,
    required this.hasMore,
    this.resetRequired,
  });
  
  factory ChangeEventPage.fromJson(Map<String, Object?> json) => _$ChangeEventPageFromJson(json);
  
  final List<ChangeEvent> events;
  final String nextAfter;
  final bool hasMore;

  /// 指定カーソルが保持期間外で、表示中データの全再取得が必要か。省略時は false
  final bool? resetRequired;

  Map<String, Object?> toJson() => _$ChangeEventPageToJson(this);
}
