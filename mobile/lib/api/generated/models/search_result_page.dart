// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'search_result.dart';

part 'search_result_page.g.dart';

@JsonSerializable()
class SearchResultPage {
  const SearchResultPage({
    required this.results,
    this.nextCursor,
  });
  
  factory SearchResultPage.fromJson(Map<String, Object?> json) => _$SearchResultPageFromJson(json);
  
  final List<SearchResult> results;
  final String? nextCursor;

  Map<String, Object?> toJson() => _$SearchResultPageToJson(this);
}
