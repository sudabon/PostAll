// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'start_upload_request.g.dart';

@JsonSerializable()
class StartUploadRequest {
  const StartUploadRequest({
    required this.fileName,
    required this.contentType,
    required this.sizeBytes,
    required this.checksum,
  });
  
  factory StartUploadRequest.fromJson(Map<String, Object?> json) => _$StartUploadRequestFromJson(json);
  
  final String fileName;
  final String contentType;
  final int sizeBytes;

  /// SHA-256 の hex
  final String checksum;

  Map<String, Object?> toJson() => _$StartUploadRequestToJson(this);
}
