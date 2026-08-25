// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'search_result_page.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

SearchResultPage _$SearchResultPageFromJson(Map<String, dynamic> json) =>
    SearchResultPage(
      results: (json['results'] as List<dynamic>)
          .map((e) => SearchResult.fromJson(e as Map<String, dynamic>))
          .toList(),
      nextCursor: json['nextCursor'] as String?,
    );

Map<String, dynamic> _$SearchResultPageToJson(SearchResultPage instance) =>
    <String, dynamic>{
      'results': instance.results,
      'nextCursor': instance.nextCursor,
    };
