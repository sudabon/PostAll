import '../api/generated/models.dart';

/// チャネル階層のノード。隣接リスト + fractional index（design.md D6）を木へ畳む。
class ChannelNode {
  ChannelNode(this.channel, this.children);

  final Channel channel;
  final List<ChannelNode> children;

  String get id => channel.id;
  String get name => channel.name;
  bool get hasChildren => children.isNotEmpty;
}

/// frontend/src/lib/tree.ts の buildForest と同じ順序で木を組む。
List<ChannelNode> buildForest(List<Channel> channels) {
  final childrenOf = <String, List<ChannelNode>>{};
  final nodes = <String, ChannelNode>{};
  final ids = {for (final channel in channels) channel.id};

  final sorted = [...channels]..sort(
      (a, b) {
        final bySortKey = a.sortKey.compareTo(b.sortKey);
        return bySortKey != 0 ? bySortKey : a.id.compareTo(b.id);
      },
    );

  for (final channel in sorted) {
    nodes[channel.id] = ChannelNode(channel, childrenOf.putIfAbsent(channel.id, () => []));
  }

  final roots = <ChannelNode>[];
  for (final channel in sorted) {
    final node = nodes[channel.id]!;
    final parentId = channel.parentId;
    if (parentId != null && ids.contains(parentId)) {
      childrenOf.putIfAbsent(parentId, () => []).add(node);
    } else {
      roots.add(node);
    }
  }
  return roots;
}

/// [id] の子孫の ID。自分自身は含まない。自身の子孫へのドロップを拒むために使う。
Set<String> descendantIds(List<ChannelNode> forest, String id) {
  final byId = <String, ChannelNode>{};
  void index(List<ChannelNode> nodes) {
    for (final node in nodes) {
      byId[node.id] = node;
      index(node.children);
    }
  }

  index(forest);

  final out = <String>{};
  void collect(String current) {
    for (final child in byId[current]?.children ?? const <ChannelNode>[]) {
      out.add(child.id);
      collect(child.id);
    }
  }

  collect(id);
  return out;
}

/// 表示中の行と、その深さ。
class VisibleChannel {
  const VisibleChannel(this.node, this.depth);

  final ChannelNode node;
  final int depth;
}

/// 展開中のノードだけを辿って一次元に並べる。
List<VisibleChannel> flattenVisible(
  List<ChannelNode> forest,
  Set<String> expanded, [
  int depth = 0,
]) {
  final out = <VisibleChannel>[];
  for (final node in forest) {
    out.add(VisibleChannel(node, depth));
    if (expanded.contains(node.id) && node.hasChildren) {
      out.addAll(flattenVisible(node.children, expanded, depth + 1));
    }
  }
  return out;
}

/// [parentId] の直下に [name] のチャネルが既にあるか（自分自身は除く）。
///
/// 同一階層での名前の一意性はサーバでも検証されるが、ドロップを見た目上
/// 戻すために手元でも判定する（channel-hierarchy spec）。
bool hasNameConflict(
  List<Channel> channels, {
  required String name,
  required String? parentId,
  String? excludingId,
}) =>
    channels.any(
      (channel) =>
          channel.id != excludingId &&
          channel.parentId == parentId &&
          channel.name.toLowerCase() == name.toLowerCase(),
    );
