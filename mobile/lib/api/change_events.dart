import 'generated/models.dart';

/// 変更イベント種別の読み取り。
///
/// 生成された [ChangeEventEventType] の Dart 識別子は `undefined0` のような
/// 自動生成名になる（`channel.created` のようなドット付きの値は Dart の
/// 識別子にできないため）。そこで種別の判定は必ずワイヤ値（`json`）で行う。
extension ChangeEventKind on ChangeEventEventType {
  /// api/openapi.yaml に書かれている値そのもの。
  String get wireValue => json ?? '';

  bool get isChannelChange => wireValue.startsWith('channel.');
  bool get isPostChange => wireValue.startsWith('post.');
  bool get isReplyChange => wireValue.startsWith('reply.');
  bool get isReactionChange => wireValue == 'reaction.updated';
}

/// ワイヤ値から種別を引く。テストと、手で組み立てる場面で使う。
ChangeEventEventType changeEventType(String wireValue) =>
    ChangeEventEventType.values.firstWhere(
      (value) => value.json == wireValue,
      orElse: () => ChangeEventEventType.$unknown,
    );

extension ChangeEventSynchronization on ChangeEvent {
  /// SSE の `postall.sync` フレームは既存デコーダとの互換性を保つため、
  /// entity ID を持たない `post.updated` として運ぶ。
  bool get isSyncWatermark =>
      eventType.wireValue == 'post.updated' &&
      channelId == null &&
      postId == null &&
      threadRootId == null;
}
