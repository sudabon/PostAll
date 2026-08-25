// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'attachment.g.dart';

@JsonSerializable()
class Attachment {
  const Attachment({
    required this.id,
    required this.fileName,
    required this.contentType,
    required this.sizeBytes,
    required this.checksum,
    required this.createdAt,
    this.postId,
  });
  
  factory Attachment.fromJson(Map<String, Object?> json) => _$AttachmentFromJson(json);
  
  final String id;
  final String? postId;
  final String fileName;
  final String contentType;
  final int sizeBytes;
  final String checksum;
  final DateTime createdAt;

  Map<String, Object?> toJson() => _$AttachmentToJson(this);
}
