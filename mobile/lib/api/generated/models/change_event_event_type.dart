// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

@JsonEnum()
enum ChangeEventEventType {
  /// Incorrect name has been replaced. Original name: `channel.created`.
  @JsonValue('channel.created')
  undefined0('channel.created'),
  /// Incorrect name has been replaced. Original name: `channel.updated`.
  @JsonValue('channel.updated')
  undefined1('channel.updated'),
  /// Incorrect name has been replaced. Original name: `channel.deleted`.
  @JsonValue('channel.deleted')
  undefined2('channel.deleted'),
  /// Incorrect name has been replaced. Original name: `post.created`.
  @JsonValue('post.created')
  undefined3('post.created'),
  /// Incorrect name has been replaced. Original name: `post.updated`.
  @JsonValue('post.updated')
  undefined4('post.updated'),
  /// Incorrect name has been replaced. Original name: `post.deleted`.
  @JsonValue('post.deleted')
  undefined5('post.deleted'),
  /// Incorrect name has been replaced. Original name: `reply.created`.
  @JsonValue('reply.created')
  undefined6('reply.created'),
  /// Incorrect name has been replaced. Original name: `reply.updated`.
  @JsonValue('reply.updated')
  undefined7('reply.updated'),
  /// Incorrect name has been replaced. Original name: `reply.deleted`.
  @JsonValue('reply.deleted')
  undefined8('reply.deleted'),
  /// Incorrect name has been replaced. Original name: `reaction.updated`.
  @JsonValue('reaction.updated')
  undefined9('reaction.updated'),
  /// Default value for all unparsed values, allows backward compatibility when adding new values on the backend.
  $unknown(null);

  const ChangeEventEventType(this.json);

  factory ChangeEventEventType.fromJson(String json) => values.firstWhere(
        (e) => e.json == json,
        orElse: () => $unknown,
      );

  final String? json;
  String toJson() {
    final value = json;
    if (value == null) {
      throw StateError('Cannot convert enum value with null JSON representation to String. '
          'This usually happens for \$unknown or @JsonValue(null) entries.');
    }
    return value as String;
  }

  @override
  String toString() => json?.toString() ?? super.toString();
  /// Returns all defined enum values excluding the $unknown value.
  static List<ChangeEventEventType> get $valuesDefined => values.where((value) => value != $unknown).toList();
}
