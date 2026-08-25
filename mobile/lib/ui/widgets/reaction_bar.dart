import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/generated/models.dart';
import '../../state/emojis.dart';

/// 絵文字画像。取得できない場合はショートコードを文字で出す
/// （emoji-reactions spec「絵文字画像が取得できない」）。
class EmojiImage extends ConsumerWidget {
  const EmojiImage({required this.shortcode, this.size = 18, super.key});

  final String shortcode;
  final double size;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final image = ref.watch(emojiImageProvider(shortcode));
    return image.when(
      loading: () => SizedBox.square(dimension: size),
      error: (_, __) => Text(':$shortcode:', style: TextStyle(fontSize: size * 0.7)),
      data: (bytes) => Image.memory(
        bytes,
        width: size,
        height: size,
        errorBuilder: (context, _, __) => Text(':$shortcode:', style: TextStyle(fontSize: size * 0.7)),
      ),
    );
  }
}

/// ポストに付いたリアクションの一覧。
class ReactionBar extends StatelessWidget {
  const ReactionBar({
    required this.reactions,
    required this.onToggle,
    required this.onAdd,
    super.key,
  });

  final List<Reaction> reactions;
  final Future<void> Function(Reaction reaction) onToggle;
  final VoidCallback onAdd;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Wrap(
        spacing: 6,
        runSpacing: 4,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          for (final reaction in reactions)
            _ReactionChip(reaction: reaction, onToggle: () => onToggle(reaction)),
          IconButton(
            iconSize: 18,
            visualDensity: VisualDensity.compact,
            tooltip: 'リアクションを追加',
            icon: const Icon(Icons.add_reaction_outlined),
            onPressed: onAdd,
          ),
        ],
      ),
    );
  }
}

class _ReactionChip extends StatelessWidget {
  const _ReactionChip({required this.reaction, required this.onToggle});

  final Reaction reaction;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Tooltip(
      // 誰が付けたかを確認できるようにする（emoji-reactions spec）。
      message: '${reaction.emoji.shortcode} · ${reaction.reactorIds.length} 人',
      child: InkWell(
        onTap: onToggle,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(
            // 自分が付けたものを見分けられるようにする。
            color: reaction.reactedByMe ? scheme.primaryContainer : scheme.surfaceContainerHighest,
            border: Border.all(
              color: reaction.reactedByMe ? scheme.primary : Theme.of(context).dividerColor,
            ),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              EmojiImage(shortcode: reaction.emoji.shortcode),
              const SizedBox(width: 4),
              Text('${reaction.count}', style: Theme.of(context).textTheme.labelSmall),
            ],
          ),
        ),
      ),
    );
  }
}

/// 絵文字ピッカー。ショートコードで絞り込む。
class EmojiPickerSheet extends ConsumerStatefulWidget {
  const EmojiPickerSheet({super.key});

  @override
  ConsumerState<EmojiPickerSheet> createState() => _EmojiPickerSheetState();
}

class _EmojiPickerSheetState extends ConsumerState<EmojiPickerSheet> {
  String _filter = '';

  @override
  Widget build(BuildContext context) {
    final emojis = ref.watch(emojisProvider);
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: SizedBox(
          height: 320,
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(12),
                child: TextField(
                  autofocus: true,
                  decoration: const InputDecoration(
                    prefixIcon: Icon(Icons.search),
                    hintText: '絵文字を絞り込む',
                  ),
                  onChanged: (value) => setState(() => _filter = value.trim().toLowerCase()),
                ),
              ),
              Expanded(
                child: emojis.when(
                  loading: () => const Center(child: CircularProgressIndicator()),
                  error: (_, __) => const Center(child: Text('絵文字を取得できませんでした')),
                  data: (all) {
                    final visible = _filter.isEmpty
                        ? all
                        : all.where((e) => e.shortcode.toLowerCase().contains(_filter)).toList();
                    if (visible.isEmpty) {
                      // 1 件も登録されていない場合も同じ表示にする。
                      return const Center(child: Text('該当する絵文字がありません'));
                    }
                    return GridView.builder(
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                        maxCrossAxisExtent: 56,
                        childAspectRatio: 1,
                      ),
                      itemCount: visible.length,
                      itemBuilder: (context, index) {
                        final emoji = visible[index];
                        return InkWell(
                          onTap: () => Navigator.of(context).pop(emoji),
                          child: Tooltip(
                            message: emoji.shortcode,
                            child: Center(child: EmojiImage(shortcode: emoji.shortcode, size: 28)),
                          ),
                        );
                      },
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

Future<Emoji?> showEmojiPicker(BuildContext context) => showModalBottomSheet<Emoji>(
      context: context,
      isScrollControlled: true,
      builder: (context) => const EmojiPickerSheet(),
    );
