import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../state/channels.dart';
import '../../state/sync.dart';
import '../../state/thread.dart';
import '../widgets/attachment_picker.dart';
import 'channels_screen.dart';
import 'thread_screen.dart';
import 'timeline_screen.dart';

/// 並列表示へ切り替える幅の下限。横向きの iPhone と iPad がこれを超える。
const double wideLayoutBreakpoint = 720;

/// サインイン後の画面。
///
/// 狭幅では「チャネル一覧」→「タイムライン」→「スレッド」の階層遷移、
/// 広幅ではチャネル一覧とタイムラインの並列表示にする
/// （mobile-shell spec「狭幅向けナビゲーション」「横向きや大画面で表示する」）。
///
/// スタックを [Navigator.pages] で宣言的に組むことで、回転で幅が変わっても
/// 選択状態を保ったまま畳み方だけが切り替わる。
class HomeShell extends ConsumerWidget {
  const HomeShell({super.key, this.attachmentPicker});

  /// テストで添付の選択を差し替えるための注入口。
  final AttachmentPicker? attachmentPicker;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // サインイン中は SSE を購読する。
    ref.watch(changeSyncProvider);

    final channel = ref.watch(resolvedSelectedChannelProvider);
    final timelineOpen = ref.watch(timelineOpenProvider);
    final openThread = ref.watch(openThreadProvider);
    final wide = MediaQuery.sizeOf(context).width >= wideLayoutBreakpoint;

    return Navigator(
      pages: [
        if (wide)
          MaterialPage(
            key: const ValueKey('split'),
            child: Row(
              children: [
                const SizedBox(width: 300, child: ChannelsScreen()),
                const VerticalDivider(width: 1),
                Expanded(
                  child: channel == null
                      ? const Scaffold(body: Center(child: Text('チャネルを選択してください')))
                      : TimelineScreen(channel: channel, attachmentPicker: attachmentPicker),
                ),
              ],
            ),
          )
        else ...[
          const MaterialPage(key: ValueKey('channels'), child: ChannelsScreen()),
          if (channel != null && timelineOpen)
            MaterialPage(key: ValueKey('timeline-${channel.id}'), child: TimelineScreen(channel: channel, attachmentPicker: attachmentPicker)),
        ],
        if (openThread != null)
          MaterialPage(key: ValueKey('thread-$openThread'), child: ThreadScreen(rootPostId: openThread, attachmentPicker: attachmentPicker)),
      ],
      onDidRemovePage: (page) {
        // 戻る操作は状態を戻すことで表す。
        final key = page.key;
        if (key is! ValueKey<String>) return;
        if (key.value.startsWith('thread-')) {
          ref.read(openThreadProvider.notifier).close();
        } else if (key.value.startsWith('timeline-')) {
          // 選択は残したままタイムラインだけ閉じる。
          ref.read(timelineOpenProvider.notifier).close();
        }
      },
    );
  }
}
