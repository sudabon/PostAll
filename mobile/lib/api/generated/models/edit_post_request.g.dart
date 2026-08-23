// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'edit_post_request.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

EditPostRequest _$EditPostRequestFromJson(Map<String, dynamic> json) =>
    EditPostRequest(
      body: json['body'] as String,
      attachmentIds: (json['attachmentIds'] as List<dynamic>?)
          ?.map((e) => e as String)
          .toList(),
    );

Map<String, dynamic> _$EditPostRequestToJson(EditPostRequest instance) =>
    <String, dynamic>{
      'body': instance.body,
      'attachmentIds': instance.attachmentIds,
    };
