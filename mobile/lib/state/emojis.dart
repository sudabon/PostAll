import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/generated/models.dart';
import 'auth.dart';
import 'providers.dart';

/// 絵文字カタログ。カスタム png のみ（design.md D25）。
final emojisProvider = FutureProvider<List<Emoji>>((ref) async {
  final signedIn = ref.watch(authControllerProvider.select((s) => s.value?.signedIn ?? false));
  if (!signedIn) return const [];
  return ref.read(apiProvider).listEmojis();
});

/// 絵文字画像。API 経由で配信されるため、取得結果をプロセス内で保持する。
///
/// 取得できない場合はショートコードを文字として出す（emoji-reactions spec）ので、
/// ここでは例外をそのまま返す。
final emojiImageProvider = FutureProvider.family<Uint8List, String>(
  (ref, shortcode) => ref.read(apiProvider).getEmojiImage(shortcode),
);
