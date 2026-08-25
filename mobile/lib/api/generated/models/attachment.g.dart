// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'attachment.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Attachment _$AttachmentFromJson(Map<String, dynamic> json) => Attachment(
  id: json['id'] as String,
  fileName: json['fileName'] as String,
  contentType: json['contentType'] as String,
  sizeBytes: (json['sizeBytes'] as num).toInt(),
  checksum: json['checksum'] as String,
  createdAt: DateTime.parse(json['createdAt'] as String),
  postId: json['postId'] as String?,
);

Map<String, dynamic> _$AttachmentToJson(Attachment instance) =>
    <String, dynamic>{
      'id': instance.id,
      'postId': instance.postId,
      'fileName': instance.fileName,
      'contentType': instance.contentType,
      'sizeBytes': instance.sizeBytes,
      'checksum': instance.checksum,
      'createdAt': instance.createdAt.toIso8601String(),
    };
