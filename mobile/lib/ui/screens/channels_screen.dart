import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/errors.dart';
import '../../state/auth.dart';
import '../../state/channels.dart';
import '../../state/connection.dart';
import '../widgets/channel_tree.dart';
import '../widgets/text_prompt.dart';
import 'search_screen.dart';
import 'sign_in_screen.dart';

/// チャネル一覧。狭幅では最初の画面、広幅では分割表示の左側になる。
class ChannelsScreen extends ConsumerWidget {
  const ChannelsScreen({this.showSearchAction = true, super.key});

  final bool showSearchAction;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('チャネル'),
        actions: [
          if (showSearchAction)
            IconButton(
              key: const Key('open-search'),
              icon: const Icon(Icons.search),
              tooltip: '検索',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => const SearchScreen()),
              ),
            ),
          IconButton(
            icon: const Icon(Icons.add),
            tooltip: 'チャネルを作成',
            onPressed: () => _createChannel(context, ref),
          ),
          PopupMenuButton<String>(
            onSelected: (value) async {
              if (value == 'settings') await showSettingsDialog(context, ref);
              if (value == 'signOut') await ref.read(authControllerProvider.notifier).signOut();
            },
            itemBuilder: (context) => const [
              PopupMenuItem(value: 'settings', child: Text('接続設定')),
              PopupMenuItem(value: 'signOut', child: Text('サインアウト')),
            ],
          ),
        ],
        bottom: const _ConnectionBanner(),
      ),
      body: ChannelTree(
        onSelect: (channel) {
          ref.read(selectedChannelProvider.notifier).select(channel.id);
          ref.read(timelineOpenProvider.notifier).open();
        },
      ),
    );
  }

  Future<void> _createChannel(BuildContext context, WidgetRef ref) async {
    final input = await promptForText(
      context,
      title: 'チャネルを作成',
      label: 'チャネル名',
      confirmLabel: '作成',
      fieldKey: const Key('channel-name-input'),
    );
    final name = input?.trim() ?? '';
    if (name.isEmpty) return;

    try {
      await ref.read(channelsProvider.notifier).create(name: name);
    } on ApiException catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.maybeOf(context)?.showSnackBar(SnackBar(content: Text(error.message)));
      }
    }
  }
}

/// 接続断を明示する（sync-and-storage spec）。
class _ConnectionBanner extends ConsumerWidget implements PreferredSizeWidget {
  const _ConnectionBanner();

  @override
  Size get preferredSize => const Size.fromHeight(20);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final connection = ref.watch(connectionProvider);
    if (connection == BackendConnection.online) return const SizedBox.shrink();

    final offline = connection == BackendConnection.offline;
    return Container(
      width: double.infinity,
      color: offline
          ? Theme.of(context).colorScheme.errorContainer
          : Theme.of(context).colorScheme.surfaceContainerHighest,
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Text(
        offline ? 'バックエンドへ接続できません' : '変更通知が切断されています',
        textAlign: TextAlign.center,
        style: Theme.of(context).textTheme.labelSmall,
      ),
    );
  }
}
