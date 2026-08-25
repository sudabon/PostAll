// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'download_url_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

DownloadUrlResponse _$DownloadUrlResponseFromJson(Map<String, dynamic> json) =>
    DownloadUrlResponse(
      url: json['url'] as String,
      expiresAt: DateTime.parse(json['expiresAt'] as String),
    );

Map<String, dynamic> _$DownloadUrlResponseToJson(
  DownloadUrlResponse instance,
) => <String, dynamic>{
  'url': instance.url,
  'expiresAt': instance.expiresAt.toIso8601String(),
};
