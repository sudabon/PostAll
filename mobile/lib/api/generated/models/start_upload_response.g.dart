// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'start_upload_response.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

StartUploadResponse _$StartUploadResponseFromJson(Map<String, dynamic> json) =>
    StartUploadResponse(
      id: json['id'] as String,
      uploadUrl: json['uploadUrl'] as String,
      headers: Map<String, String>.from(json['headers'] as Map),
    );

Map<String, dynamic> _$StartUploadResponseToJson(
  StartUploadResponse instance,
) => <String, dynamic>{
  'id': instance.id,
  'uploadUrl': instance.uploadUrl,
  'headers': instance.headers,
};
