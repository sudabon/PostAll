// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'download_url_response.g.dart';

@JsonSerializable()
class DownloadUrlResponse {
  const DownloadUrlResponse({
    required this.url,
    required this.expiresAt,
  });
  
  factory DownloadUrlResponse.fromJson(Map<String, Object?> json) => _$DownloadUrlResponseFromJson(json);
  
  final String url;
  final DateTime expiresAt;

  Map<String, Object?> toJson() => _$DownloadUrlResponseToJson(this);
}
