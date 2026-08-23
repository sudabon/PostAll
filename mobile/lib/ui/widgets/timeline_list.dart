import 'package:flutter/material.dart';

import '../../api/generated/models.dart';
import '../../util/dates.dart';
import 'post_tile.dart';

/// タイムラインに並べる行。
sealed class TimelineRow {
  const TimelineRow();
}

class PostRow extends TimelineRow {
  const PostRow(this.post);

  final Post post;
}

class SeparatorRow extends TimelineRow {
  const SeparatorRow(this.date);

  final DateTime date;
}

/// 日付が変わる箇所にセパレータを挟む。
///
/// 過去を読み足しても重複したセパレータが出ないよう、並んだ結果から毎回組み直す
/// （post-timeline spec「過去を読み込んで日付が増える」）。
List<TimelineRow> buildTimelineRows(List<Post> posts) {
  final rows = <TimelineRow>[];
  String? previousKey;
  for (final post in posts) {
    final key = localDateKey(post.createdAt);
    if (key != previousKey) {
      rows.add(SeparatorRow(post.createdAt));
      previousKey = key;
    }
    rows.add(PostRow(post));
  }
  return rows;
}

/// 古い順のタイムライン。上端へ近づくと過去を読み足す。
class TimelineList extends StatefulWidget {
  const TimelineList({
    required this.posts,
    required this.loadingOlder,
    required this.atOldest,
    required this.onLoadOlder,
    required this.onAction,
    required this.onToggleReaction,
    this.controller,
    super.key,
  });

  final List<Post> posts;
  final bool loadingOlder;
  final bool atOldest;
  final Future<void> Function() onLoadOlder;
  final void Function(Post post, PostAction action) onAction;
  final Future<void> Function(Post post, Reaction reaction) onToggleReaction;
  final ScrollController? controller;

  @override
  State<TimelineList> createState() => _TimelineListState();
}

class _TimelineListState extends State<TimelineList> {
  late final ScrollController _controller = widget.controller ?? ScrollController();

  @override
  void dispose() {
    if (widget.controller == null) _controller.dispose();
    super.dispose();
  }

  /// reverse したリストでは maxScrollExtent 側が「過去」になる。
  bool _shouldLoadOlder(ScrollNotification notification) {
    if (widget.loadingOlder || widget.atOldest) return false;
    final position = notification.metrics;
    return position.pixels >= position.maxScrollExtent - 200;
  }

  @override
  Widget build(BuildContext context) {
    if (widget.posts.isEmpty) {
      return const Center(child: Text('まだポストがありません'));
    }

    // 末尾（最新）を基準に積むことで、過去を先頭へ足しても表示位置が飛ばない
    // （post-timeline spec「上方向へ遡って読み込む」）。
    final rows = buildTimelineRows(widget.posts).reversed.toList();

    return NotificationListener<ScrollNotification>(
      onNotification: (notification) {
        if (_shouldLoadOlder(notification)) widget.onLoadOlder();
        return false;
      },
      child: ListView.builder(
        controller: _controller,
        reverse: true,
        itemCount: rows.length + 1,
        itemBuilder: (context, index) {
          if (index == rows.length) return _header();
          final row = rows[index];
          return switch (row) {
            SeparatorRow(:final date) => DateSeparator(date: date),
            PostRow(:final post) => PostTile(
                key: ValueKey(post.id),
                post: post,
                onAction: (action) => widget.onAction(post, action),
                onToggleReaction: (reaction) => widget.onToggleReaction(post, reaction),
              ),
          };
        },
      ),
    );
  }

  Widget _header() {
    if (widget.loadingOlder) {
      return const Padding(
        padding: EdgeInsets.all(12),
        child: Center(
          child: SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2)),
        ),
      );
    }
    if (widget.atOldest) {
      return Padding(
        padding: const EdgeInsets.all(12),
        child: Center(
          child: Text('これ以上前のポストはありません',
              style: Theme.of(context).textTheme.labelSmall),
        ),
      );
    }
    return const SizedBox(height: 12);
  }
}
