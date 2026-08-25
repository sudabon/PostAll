// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'search_result.g.dart';

@JsonSerializable()
class SearchResult {
  const SearchResult({
    required this.postId,
    required this.timelinePostId,
    required this.channelId,
    required this.channelName,
    required this.body,
    required this.createdAt,
    this.threadRootId,
  });
  
  factory SearchResult.fromJson(Map<String, Object?> json) => _$SearchResultFromJson(json);
  
  final String postId;

  /// チャネルタイムラインに表示するルートポスト ID。
  final String timelinePostId;
  final String channelId;
  final String channelName;
  final String? threadRootId;
  final String body;
  final DateTime createdAt;

  Map<String, Object?> toJson() => _$SearchResultToJson(this);
}
