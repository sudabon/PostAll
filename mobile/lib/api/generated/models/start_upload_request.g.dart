// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'start_upload_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

StartUploadRequest _$StartUploadRequestFromJson(Map<String, dynamic> json) =>
    StartUploadRequest(
      fileName: json['fileName'] as String,
      contentType: json['contentType'] as String,
      sizeBytes: (json['sizeBytes'] as num).toInt(),
      checksum: json['checksum'] as String,
    );

Map<String, dynamic> _$StartUploadRequestToJson(StartUploadRequest instance) =>
    <String, dynamic>{
      'fileName': instance.fileName,
      'contentType': instance.contentType,
      'sizeBytes': instance.sizeBytes,
      'checksum': instance.checksum,
    };
