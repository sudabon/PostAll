import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/generated/models.dart';
import '../../state/channels.dart';
import '../../state/search.dart';
import '../../state/timeline.dart';
import '../../util/dates.dart';
import '../../util/excerpt.dart';

/// 全文検索（full-text-search spec）。
///
/// 結果を選ぶと、そのポストが見える位置でタイムラインを開き直す。
class SearchScreen extends ConsumerStatefulWidget {
  const SearchScreen({super.key});

  @override
  ConsumerState<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends ConsumerState<SearchScreen> {
  late final TextEditingController _controller =
      TextEditingController(text: ref.read(searchProvider).query);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final search = ref.watch(searchProvider);

    return Scaffold(
      appBar: AppBar(
        title: TextField(
          key: const Key('search-input'),
          controller: _controller,
          autofocus: true,
          textInputAction: TextInputAction.search,
          decoration: const InputDecoration(hintText: 'ポストを検索', border: InputBorder.none),
          onChanged: ref.read(searchProvider.notifier).updateQuery,
          onSubmitted: (_) => ref.read(searchProvider.notifier).run(),
        ),
        actions: [
          IconButton(
            key: const Key('search-run'),
            icon: const Icon(Icons.search),
            tooltip: '検索',
            onPressed: search.tooShort ? null : ref.read(searchProvider.notifier).run,
          ),
        ],
      ),
      body: _body(search),
    );
  }

  Widget _body(SearchState search) {
    if (search.loading) return const Center(child: CircularProgressIndicator());
    if (search.error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Text('検索に失敗しました\n${search.error}', textAlign: TextAlign.center),
        ),
      );
    }
    if (search.tooShort) {
      return const Center(child: Text('$minSearchQueryLength 文字以上で検索します'));
    }
    if (search.searched && search.results.isEmpty) {
      return const Center(child: Text('一致するポストがありません'));
    }
    if (!search.searched) {
      return const Center(child: Text('検索語を入力してください'));
    }

    return ListView.separated(
      itemCount: search.results.length + (search.hasMore ? 1 : 0),
      separatorBuilder: (_, __) => const Divider(height: 1),
      itemBuilder: (context, index) {
        if (index == search.results.length) {
          return Padding(
            padding: const EdgeInsets.all(12),
            child: Center(
              child: search.loadingMore
                  ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : OutlinedButton(
                      onPressed: ref.read(searchProvider.notifier).loadMore,
                      child: const Text('さらに読み込む'),
                    ),
            ),
          );
        }
        return _ResultTile(
          result: search.results[index],
          query: search.query.trim(),
          onTap: () => _openResult(search.results[index]),
        );
      },
    );
  }

  /// 元のポストへ移動し、そのポストが見える位置でタイムラインを表示する。
  Future<void> _openResult(SearchResult result) async {
    ref.read(selectedChannelProvider.notifier).select(result.channelId);
    await ref
        .read(timelineProvider(result.channelId).notifier)
        .focusAround(result.timelinePostId);
    if (mounted) Navigator.of(context).pop();
  }
}

class _ResultTile extends StatelessWidget {
  const _ResultTile({required this.result, required this.query, required this.onTap});

  final SearchResult result;
  final String query;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final excerpt = buildExcerpt(result.body, query);
    final highlight = Theme.of(context)
        .textTheme
        .bodyMedium
        ?.copyWith(fontWeight: FontWeight.bold, backgroundColor: Theme.of(context).highlightColor);

    return ListTile(
      onTap: onTap,
      title: Text(
        '#${result.channelName} · ${formatDateTime(result.createdAt)}'
        '${result.threadRootId == null ? '' : ' · スレッド返信'}',
        style: Theme.of(context).textTheme.labelSmall,
      ),
      subtitle: Text.rich(
        TextSpan(
          children: [
            if (excerpt.clippedStart) const TextSpan(text: '…'),
            for (final part in excerpt.parts)
              TextSpan(text: part.text, style: part.match ? highlight : null),
            if (excerpt.clippedEnd) const TextSpan(text: '…'),
          ],
        ),
        maxLines: 3,
        overflow: TextOverflow.ellipsis,
      ),
    );
  }
}
