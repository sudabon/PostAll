// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'health.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Health _$HealthFromJson(Map<String, dynamic> json) => Health(
  status: HealthStatus.fromJson(json['status'] as String),
  database: HealthDatabase.fromJson(json['database'] as String),
);

Map<String, dynamic> _$HealthToJson(Health instance) => <String, dynamic>{
  'status': instance.status,
  'database': instance.database,
};
