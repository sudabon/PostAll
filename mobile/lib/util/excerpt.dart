/// 抜粋の 1 断片。[match] が true の部分を強調表示する。
class ExcerptPart {
  const ExcerptPart(this.text, {this.match = false});

  final String text;
  final bool match;
}

class Excerpt {
  const Excerpt({
    required this.parts,
    required this.clippedStart,
    required this.clippedEnd,
  });

  final List<ExcerptPart> parts;
  final bool clippedStart;
  final bool clippedEnd;

  String get text => parts.map((part) => part.text).join();
}

/// 本文から一致箇所の周辺を切り出す。frontend/src/lib/search.ts の移植。
///
/// 書記素ではなくコードポイント単位で扱う点も TypeScript 版と揃えてある。
Excerpt buildExcerpt(String body, String query, {int radius = 48}) {
  final source = body.runes.toList();
  final needle = query.runes.toList();
  if (needle.isEmpty) {
    return Excerpt(parts: [ExcerptPart(body)], clippedStart: false, clippedEnd: false);
  }

  final lowerQuery = query.toLowerCase();
  bool matchesAt(int index) {
    if (index + needle.length > source.length) return false;
    return String.fromCharCodes(source.sublist(index, index + needle.length)).toLowerCase() ==
        lowerQuery;
  }

  var first = -1;
  for (var index = 0; index + needle.length <= source.length; index += 1) {
    if (matchesAt(index)) {
      first = index;
      break;
    }
  }

  if (first < 0) {
    final end = source.length < radius * 2 ? source.length : radius * 2;
    return Excerpt(
      parts: [ExcerptPart(String.fromCharCodes(source.sublist(0, end)))],
      clippedStart: false,
      clippedEnd: end < source.length,
    );
  }

  final start = first - radius < 0 ? 0 : first - radius;
  final rawEnd = first + needle.length + radius;
  final end = rawEnd > source.length ? source.length : rawEnd;

  final parts = <ExcerptPart>[];
  var plainStart = start;
  var index = start;
  while (index < end) {
    if (index + needle.length <= end && matchesAt(index)) {
      if (plainStart < index) {
        parts.add(ExcerptPart(String.fromCharCodes(source.sublist(plainStart, index))));
      }
      parts.add(
        ExcerptPart(String.fromCharCodes(source.sublist(index, index + needle.length)), match: true),
      );
      index += needle.length;
      plainStart = index;
      continue;
    }
    index += 1;
  }
  if (plainStart < end) {
    parts.add(ExcerptPart(String.fromCharCodes(source.sublist(plainStart, end))));
  }

  return Excerpt(parts: parts, clippedStart: start > 0, clippedEnd: end < source.length);
}
