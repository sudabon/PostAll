/// 日付の境界はクライアントのローカルタイムゾーンで判定する（design.md D26）。
String localDateKey(DateTime value) {
  final local = value.toLocal();
  final month = local.month.toString().padLeft(2, '0');
  final day = local.day.toString().padLeft(2, '0');
  return '${local.year}-$month-$day';
}

String formatDateLabel(DateTime value) {
  final local = value.toLocal();
  return '${local.year}年${local.month}月${local.day}日';
}

String formatTime(DateTime value) {
  final local = value.toLocal();
  return '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
}

String formatDateTime(DateTime value) => '${formatDateLabel(value)} ${formatTime(value)}';
