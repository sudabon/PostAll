import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/errors.dart';
import '../../api/generated/models.dart';
import '../../state/channels.dart';
import '../../util/tree.dart';

/// ドロップ先の意味。
enum DropIntent {
  /// 対象チャネルの子にする。
  into,

  /// 対象チャネルの直前（同じ親の中で並べ替える）。
  before,
}

/// チャネル階層。展開・折りたたみと、長押しドラッグでの階層／並び順の変更
/// （mobile-shell spec「チャネル階層のタッチ操作」）。
class ChannelTree extends ConsumerWidget {
  const ChannelTree({required this.onSelect, super.key});

  final void Function(Channel channel) onSelect;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final channels = ref.watch(channelsProvider);

    return channels.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Text('チャネルを取得できませんでした\n$error', textAlign: TextAlign.center),
        ),
      ),
      data: (all) {
        final forest = buildForest(all);
        final expanded = ref.watch(expandedChannelsProvider);
        final rows = flattenVisible(forest, expanded);
        if (rows.isEmpty) {
          return const Center(child: Text('チャネルがありません'));
        }
        final selectedId = ref.watch(selectedChannelProvider);

        return ListView.builder(
          itemCount: rows.length,
          itemBuilder: (context, index) => _ChannelRow(
            row: rows[index],
            selected: rows[index].node.id == selectedId,
            expanded: expanded.contains(rows[index].node.id),
            forest: forest,
            channels: all,
            onSelect: onSelect,
          ),
        );
      },
    );
  }
}

class _ChannelRow extends ConsumerWidget {
  const _ChannelRow({
    required this.row,
    required this.selected,
    required this.expanded,
    required this.forest,
    required this.channels,
    required this.onSelect,
  });

  final VisibleChannel row;
  final bool selected;
  final bool expanded;
  final List<ChannelNode> forest;
  final List<Channel> channels;
  final void Function(Channel channel) onSelect;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final channel = row.node.channel;

    final tile = Container(
      color: selected ? Theme.of(context).colorScheme.primaryContainer : null,
      child: Padding(
        padding: EdgeInsets.only(left: 8.0 + row.depth * 16, right: 8),
        child: Row(
          children: [
            SizedBox(
              width: 28,
              child: row.node.hasChildren
                  ? IconButton(
                      padding: EdgeInsets.zero,
                      iconSize: 18,
                      tooltip: expanded ? '折りたたむ' : '展開する',
                      icon: Icon(expanded ? Icons.expand_more : Icons.chevron_right),
                      onPressed: () =>
                          ref.read(expandedChannelsProvider.notifier).toggle(channel.id),
                    )
                  : null,
            ),
            Expanded(
              child: InkWell(
                onTap: () => onSelect(channel),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Text(channel.name, overflow: TextOverflow.ellipsis),
                ),
              ),
            ),
          ],
        ),
      ),
    );

    return LongPressDraggable<String>(
      data: channel.id,
      feedback: Material(
        elevation: 4,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Text(channel.name),
        ),
      ),
      childWhenDragging: Opacity(opacity: 0.4, child: tile),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          _DropTarget(
            intent: DropIntent.before,
            target: channel,
            forest: forest,
            channels: channels,
            child: const SizedBox(height: 6),
          ),
          _DropTarget(
            intent: DropIntent.into,
            target: channel,
            forest: forest,
            channels: channels,
            child: tile,
          ),
        ],
      ),
    );
  }
}

class _DropTarget extends ConsumerWidget {
  const _DropTarget({
    required this.intent,
    required this.target,
    required this.forest,
    required this.channels,
    required this.child,
  });

  final DropIntent intent;
  final Channel target;
  final List<ChannelNode> forest;
  final List<Channel> channels;
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return DragTarget<String>(
      // 構造として成り立たない移動はドロップ自体を受け付けない。
      // 名前の衝突は受け付けたうえで理由を伝える（channel-hierarchy spec）。
      onWillAcceptWithDetails: (details) => _blocked(details.data) == null,
      onAcceptWithDetails: (details) => _apply(context, ref, details.data),
      builder: (context, candidate, __) => DecoratedBox(
        decoration: BoxDecoration(
          border: candidate.isEmpty
              ? null
              : Border.all(color: Theme.of(context).colorScheme.primary, width: 2),
        ),
        child: child,
      ),
    );
  }

  String? get _nextParentId => intent == DropIntent.into ? target.id : target.parentId;

  /// ドロップを受け付けない理由。受け付けるなら null。
  ///
  /// 自身の子孫への移動は木として成り立たないため、ここで弾いて元の位置へ戻す。
  String? _blocked(String draggedId) {
    if (draggedId == target.id) return '同じチャネルへは移動できません';
    if (!channels.any((c) => c.id == draggedId)) return 'チャネルが見つかりません';

    final descendants = descendantIds(forest, draggedId);
    if (intent == DropIntent.into && descendants.contains(target.id)) {
      return '自身の子孫へは移動できません';
    }
    if (intent == DropIntent.before &&
        target.parentId != null &&
        (target.parentId == draggedId || descendants.contains(target.parentId!))) {
      return '自身の子孫へは移動できません';
    }
    return null;
  }

  /// 移動先で名前が衝突する場合の理由。衝突しないなら null。
  String? _conflict(String draggedId) {
    final dragged = channels.firstWhere((c) => c.id == draggedId);
    if (hasNameConflict(
      channels,
      name: dragged.name,
      parentId: _nextParentId,
      excludingId: draggedId,
    )) {
      return '移動先に同じ名前のチャネルがあります';
    }
    return null;
  }

  Future<void> _apply(BuildContext context, WidgetRef ref, String draggedId) async {
    final blocked = _blocked(draggedId) ?? _conflict(draggedId);
    if (blocked != null) {
      _notify(context, blocked);
      return;
    }
    try {
      await ref.read(channelsProvider.notifier).move(
            draggedId,
            parentId: _nextParentId,
            beforeId: intent == DropIntent.before ? target.id : null,
          );
      if (intent == DropIntent.into) {
        ref.read(expandedChannelsProvider.notifier).expand(target.id);
      }
    } on ApiException catch (error) {
      // サーバが拒否した場合も元の位置へ戻す（notifier 側で復元済み）。
      if (context.mounted) _notify(context, error.message);
    } on Object catch (error) {
      if (context.mounted) _notify(context, '$error');
    }
  }

  void _notify(BuildContext context, String message) =>
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(message)));
}
