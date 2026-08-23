import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/generated/models.dart';
import 'providers.dart';

/// 検索は 2 文字以上で実行する（full-text-search spec）。
const int minSearchQueryLength = 2;

class SearchState {
  const SearchState({
    this.query = '',
    this.results = const [],
    this.nextCursor,
    this.loading = false,
    this.loadingMore = false,
    this.searched = false,
    this.error,
  });

  final String query;
  final List<SearchResult> results;
  final String? nextCursor;
  final bool loading;
  final bool loadingMore;

  /// 一度でも検索を実行したか。0 件表示と初期状態を区別する。
  final bool searched;
  final String? error;

  bool get tooShort => query.trim().length < minSearchQueryLength;
  bool get hasMore => nextCursor != null;
}

class SearchNotifier extends Notifier<SearchState> {
  @override
  SearchState build() => const SearchState();

  void updateQuery(String value) {
    state = SearchState(query: value, results: state.results, searched: state.searched);
  }

  Future<void> run() async {
    final query = state.query.trim();
    if (query.length < minSearchQueryLength) {
      state = SearchState(query: state.query);
      return;
    }
    state = SearchState(query: state.query, loading: true);
    try {
      final page = await ref.read(apiProvider).searchPosts(query: query);
      state = SearchState(
        query: state.query,
        results: page.results,
        nextCursor: page.nextCursor,
        searched: true,
      );
    } on Object catch (error) {
      state = SearchState(query: state.query, searched: true, error: '$error');
    }
  }

  Future<void> loadMore() async {
    final cursor = state.nextCursor;
    if (cursor == null || state.loadingMore) return;
    state = SearchState(
      query: state.query,
      results: state.results,
      nextCursor: cursor,
      loadingMore: true,
      searched: true,
    );
    try {
      final page = await ref.read(apiProvider).searchPosts(
            query: state.query.trim(),
            cursor: cursor,
          );
      state = SearchState(
        query: state.query,
        results: [...state.results, ...page.results],
        nextCursor: page.nextCursor,
        searched: true,
      );
    } on Object catch (error) {
      state = SearchState(
        query: state.query,
        results: state.results,
        nextCursor: cursor,
        searched: true,
        error: '$error',
      );
    }
  }

  void reset() => state = const SearchState();
}

final searchProvider = NotifierProvider<SearchNotifier, SearchState>(SearchNotifier.new);
