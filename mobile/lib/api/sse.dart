import 'dart:convert';

/// SSE の 1 メッセージ。
class SseMessage {
  const SseMessage({required this.data, this.id, this.event});

  final String data;
  final String? id;
  final String? event;
}

/// バイト列のストリームを SSE メッセージへ変換する。
///
/// 行の分割規則は frontend/src/api/sse.ts と同じ。CR / LF / CRLF を区切りとして
/// 扱い、チャンク末尾に届いた CR は次のチャンクを待ってから判定する。
Stream<SseMessage> parseSseStream(Stream<List<int>> bytes) async* {
  const decoder = Utf8Decoder(allowMalformed: true);
  const cr = '\r';
  const lf = '\n';

  var buffer = '';
  String? eventId;
  String? eventType;
  var dataLines = <String>[];

  SseMessage? processLine(String line) {
    if (line.isEmpty) {
      if (dataLines.isEmpty) {
        eventId = null;
        eventType = null;
        return null;
      }
      final message = SseMessage(data: dataLines.join(lf), id: eventId, event: eventType);
      eventId = null;
      eventType = null;
      dataLines = <String>[];
      return message;
    }
    if (line.startsWith(':')) return null;

    final separator = line.indexOf(':');
    final field = separator < 0 ? line : line.substring(0, separator);
    var value = separator < 0 ? '' : line.substring(separator + 1);
    if (value.startsWith(' ')) value = value.substring(1);

    switch (field) {
      case 'data':
        dataLines.add(value);
      case 'event':
        eventType = value;
      case 'id':
        eventId = value;
    }
    return null;
  }

  /// buffer から取り出せる行を返す。[last] が false のとき、末尾の CR は
  /// 続きの LF が来るかもしれないので保留する。
  List<String> drainLines({required bool last}) {
    final lines = <String>[];
    while (true) {
      var end = -1;
      var separatorLength = 0;
      for (var index = 0; index < buffer.length; index += 1) {
        final char = buffer[index];
        if (char == lf) {
          end = index;
          separatorLength = 1;
          break;
        }
        if (char == cr) {
          if (index == buffer.length - 1 && !last) return lines;
          end = index;
          separatorLength = index + 1 < buffer.length && buffer[index + 1] == lf ? 2 : 1;
          break;
        }
      }
      if (end < 0) {
        if (last && buffer.isNotEmpty) {
          lines.add(buffer);
          buffer = '';
        }
        return lines;
      }
      lines.add(buffer.substring(0, end));
      buffer = buffer.substring(end + separatorLength);
    }
  }

  await for (final chunk in bytes) {
    buffer += decoder.convert(chunk);
    for (final line in drainLines(last: false)) {
      final message = processLine(line);
      if (message != null) yield message;
    }
  }
  for (final line in drainLines(last: true)) {
    final message = processLine(line);
    if (message != null) yield message;
  }
}
