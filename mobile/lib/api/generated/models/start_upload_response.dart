// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'start_upload_response.g.dart';

@JsonSerializable()
class StartUploadResponse {
  const StartUploadResponse({
    required this.id,
    required this.uploadUrl,
    required this.headers,
  });
  
  factory StartUploadResponse.fromJson(Map<String, Object?> json) => _$StartUploadResponseFromJson(json);
  
  final String id;
  final String uploadUrl;
  final Map<String, String> headers;

  Map<String, Object?> toJson() => _$StartUploadResponseToJson(this);
}
