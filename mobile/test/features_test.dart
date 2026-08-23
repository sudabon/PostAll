// タイムライン・入力・スレッド・リアクション・検索・添付の振る舞い。
//
// 対応する spec: post-timeline / post-composer / post-threads /
// emoji-reactions / full-text-search / attachments / rich-content-rendering。
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:postall/api/generated/models.dart';
import 'package:postall/state/channels.dart';
import 'package:postall/state/drafts.dart';
import 'package:postall/state/timeline.dart';
import 'package:postall/ui/screens/home_shell.dart';
import 'package:postall/ui/screens/search_screen.dart';
import 'package:postall/ui/screens/thread_screen.dart';
import 'package:postall/ui/widgets/code_block.dart';
import 'package:postall/ui/widgets/post_tile.dart';

import 'support/fake_api.dart';
import 'support/harness.dart';

const _narrow = Size(390, 844);

void main() {
  group('post-timeline: 古い順のタイムライン', () {
    testWidgets('初期表示は最新 10 件で、昇順に並ぶ', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [
          for (var i = 0; i < 25; i++)
            post(100 + i, channelId: testId(1), body: 'post $i', createdAt: DateTime(2026, 3, 1, 9, i)),
        ],
      );
      addTearDown(api.dispose);

      final container = await pumpApp(
        tester,
        api: api,
        size: _narrow,
        prefs: {'channels.selected': testId(1)},
        child: const HomeShell(),
      );

      final state = container.read(timelineProvider(testId(1))).value!;
      expect(state.posts, hasLength(10));
      expect(state.posts.first.body, 'post 15');
      expect(state.posts.last.body, 'post 24');
      // 全件取得はしない。
      expect(api.calls.where((c) => c.startsWith('listPosts')), hasLength(1));
    });

    testWidgets('10 件未満なら追加取得を要求しない', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [post(10, channelId: testId(1)), post(11, channelId: testId(1))],
      );
      addTearDown(api.dispose);

      final container = await pumpApp(
        tester,
        api: api,
        size: _narrow,
        prefs: {'channels.selected': testId(1)},
        child: const HomeShell(),
      );

      final state = container.read(timelineProvider(testId(1))).value!;
      expect(state.posts, hasLength(2));
      expect(state.atOldest, isTrue);
      expect(find.text('これ以上前のポストはありません'), findsOneWidget);
    });

    testWidgets('上方向へ遡ると過去が先頭へ足される', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [
          for (var i = 0; i < 25; i++)
            post(100 + i, channelId: testId(1), body: 'post $i', createdAt: DateTime(2026, 3, 1, 9, i)),
        ],
      );
      addTearDown(api.dispose);

      final container = await pumpApp(
        tester,
        api: api,
        size: _narrow,
        prefs: {'channels.selected': testId(1)},
        child: const HomeShell(),
      );

      await container.read(timelineProvider(testId(1)).notifier).loadOlder();
      await tester.pumpAndSettle();

      final state = container.read(timelineProvider(testId(1))).value!;
      expect(state.posts, hasLength(20));
      expect(state.posts.first.body, 'post 5');
      expect(state.posts.last.body, 'post 24');
    });

    testWidgets('取得中は重複した要求を出さない', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [
          for (var i = 0; i < 25; i++)
            post(100 + i, channelId: testId(1), createdAt: DateTime(2026, 3, 1, 9, i)),
        ],
      );
      addTearDown(api.dispose);

      final container = await pumpApp(
        tester,
        api: api,
        size: _narrow,
        prefs: {'channels.selected': testId(1)},
        child: const HomeShell(),
      );

      final notifier = container.read(timelineProvider(testId(1)).notifier);
      final before = api.calls.where((c) => c.startsWith('listPosts')).length;
      await Future.wait([notifier.loadOlder(), notifier.loadOlder()]);
      await tester.pumpAndSettle();

      expect(api.calls.where((c) => c.startsWith('listPosts')).length, before + 1);
    });

    testWidgets('スレッド返信と子チャネルのポストを混ぜない', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'parent'), channel(2, name: 'child', parentId: testId(1))],
        posts: [
          post(10, channelId: testId(1), body: '親チャネルのポスト'),
          post(11, channelId: testId(1), threadRootId: testId(10), body: 'スレッド返信'),
          post(12, channelId: testId(2), body: '子チャネルのポスト'),
        ],
      );
      addTearDown(api.dispose);

      await pumpApp(
        tester,
        api: api,
        size: _narrow,
        prefs: {'channels.selected': testId(1)},
        child: const HomeShell(),
      );

      expect(find.text('親チャネルのポスト'), findsOneWidget);
      expect(find.text('スレッド返信'), findsNothing);
      expect(find.text('子チャネルのポスト'), findsNothing);
    });

    testWidgets('論理削除されたポストは表示しない', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [
          post(10, channelId: testId(1), body: '残る'),
          post(11, channelId: testId(1), body: '消える', deleted: true),
        ],
      );
      addTearDown(api.dispose);

      await pumpApp(
        tester,
        api: api,
        size: _narrow,
        prefs: {'channels.selected': testId(1)},
        child: const HomeShell(),
      );

      expect(find.text('残る'), findsOneWidget);
      expect(find.text('消える'), findsNothing);
    });

    testWidgets('ポストが 0 件でも入力フォームは操作できる', (tester) async {
      final api = FakeApi(channels: [channel(1, name: 'general')]);
      addTearDown(api.dispose);

      await pumpApp(
        tester,
        api: api,
        size: _narrow,
        prefs: {'channels.selected': testId(1)},
        child: const HomeShell(),
      );

      expect(find.text('まだポストがありません'), findsOneWidget);
      final field = tester.widget<TextField>(find.byKey(const Key('composer-input')));
      expect(field.enabled, isTrue);
    });

    testWidgets('日付が変わる箇所にセパレータを出す', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [
          post(10, channelId: testId(1), createdAt: DateTime(2026, 3, 1, 9)),
          post(11, channelId: testId(1), createdAt: DateTime(2026, 3, 2, 9)),
        ],
      );
      addTearDown(api.dispose);

      await pumpApp(
        tester,
        api: api,
        size: _narrow,
        prefs: {'channels.selected': testId(1)},
        child: const HomeShell(),
      );

      expect(find.text('2026年3月1日'), findsOneWidget);
      expect(find.text('2026年3月2日'), findsOneWidget);
    });
  });

  group('post-composer: 送信と下書き', () {
    testWidgets('送信するとタイムライン末尾へ追加され、フォームが空になる', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [post(10, channelId: testId(1), body: '既存')],
      );
      addTearDown(api.dispose);

      await pumpApp(
        tester,
        api: api,
        size: _narrow,
        prefs: {'channels.selected': testId(1)},
        child: const HomeShell(),
      );

      await tester.enterText(find.byKey(const Key('composer-input')), 'こんにちは');
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('composer-send')));
      await tester.pumpAndSettle();

      expect(find.text('こんにちは'), findsOneWidget);
      final field = tester.widget<TextField>(find.byKey(const Key('composer-input')));
      expect(field.controller?.text, isEmpty);
    });

    testWidgets('本文も添付も無いと送信できない', (tester) async {
      final api = FakeApi(channels: [channel(1, name: 'general')]);
      addTearDown(api.dispose);

      await pumpApp(
        tester,
        api: api,
        size: _narrow,
        prefs: {'channels.selected': testId(1)},
        child: const HomeShell(),
      );

      final send = tester.widget<IconButton>(find.byKey(const Key('composer-send')));
      expect(send.onPressed, isNull);
    });

    testWidgets('チャネルとスレッドの下書きは混ざらない', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [
          post(10, channelId: testId(1), body: '親', replyCount: 1),
          post(11, channelId: testId(1), threadRootId: testId(10), body: '返信'),
        ],
      );
      addTearDown(api.dispose);

      final container = await pumpApp(
        tester,
        api: api,
        size: _narrow,
        prefs: {'channels.selected': testId(1)},
        child: const HomeShell(),
      );

      await tester.enterText(find.byKey(const Key('composer-input')), 'チャネルの下書き');
      await tester.pumpAndSettle();

      await tester.tap(find.text('1 件の返信'));
      await tester.pumpAndSettle();

      // スレッドのフォームは空で始まる。
      final threadField = tester.widget<TextField>(find.byKey(const Key('composer-input')));
      expect(threadField.controller?.text, isEmpty);

      await tester.enterText(find.byKey(const Key('composer-input')), 'スレッドの下書き');
      await tester.pumpAndSettle();

      final drafts = container.read(draftsProvider.notifier);
      expect(drafts.read(DraftKey.channel(testId(1))), 'チャネルの下書き');
      expect(drafts.read(DraftKey.thread(testId(10))), 'スレッドの下書き');
    });

    testWidgets('下書きは端末に残り、開き直すと復元される', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [post(10, channelId: testId(1))],
      );
      addTearDown(api.dispose);

      await pumpApp(
        tester,
        api: api,
        size: _narrow,
        prefs: {
          'channels.selected': testId(1),
          'draft.channel.${testId(1)}': '書きかけの本文',
        },
        child: const HomeShell(),
      );

      final field = tester.widget<TextField>(find.byKey(const Key('composer-input')));
      expect(field.controller?.text, '書きかけの本文');
    });

    testWidgets('コードブロック挿入で雛形が入り、言語指定位置にカーソルが来る', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [post(10, channelId: testId(1))],
      );
      addTearDown(api.dispose);

      await pumpApp(
        tester,
        api: api,
        size: _narrow,
        prefs: {'channels.selected': testId(1)},
        child: const HomeShell(),
      );

      await tester.tap(find.byTooltip('コードブロックを挿入'));
      await tester.pumpAndSettle();

      final field = tester.widget<TextField>(find.byKey(const Key('composer-input')));
      expect(field.controller?.text, '```\n```');
      expect(field.controller?.selection.baseOffset, 3);
    });
  });

  group('post-timeline: 編集と削除', () {
    testWidgets('編集すると本文が上書きされ、編集済み表示が付く', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [post(10, channelId: testId(1), body: '元の本文')],
      );
      addTearDown(api.dispose);

      await pumpApp(
        tester,
        api: api,
        size: _narrow,
        prefs: {'channels.selected': testId(1)},
        child: const HomeShell(),
      );

      await tester.longPress(find.text('元の本文'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('編集'));
      await tester.pumpAndSettle();

      await tester.enterText(find.byKey(const Key('post-edit-input')), '直した本文');
      await tester.tap(find.byKey(const Key('post-edit-save')));
      await tester.pumpAndSettle();

      expect(find.text('直した本文'), findsOneWidget);
      expect(find.text('元の本文'), findsNothing);
      expect(find.text('編集済み'), findsOneWidget);
    });

    testWidgets('削除は確認を求め、取り消すと残る', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [post(10, channelId: testId(1), body: '消さない')],
      );
      addTearDown(api.dispose);

      await pumpApp(
        tester,
        api: api,
        size: _narrow,
        prefs: {'channels.selected': testId(1)},
        child: const HomeShell(),
      );

      await tester.longPress(find.text('消さない'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('削除'));
      await tester.pumpAndSettle();

      expect(find.text('ポストを削除しますか'), findsOneWidget);
      await tester.tap(find.text('取り消す'));
      await tester.pumpAndSettle();

      expect(find.text('消さない'), findsOneWidget);
      expect(api.calls.where((c) => c.startsWith('deletePost')), isEmpty);
    });

    testWidgets('削除を承認するとタイムラインから消える', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [post(10, channelId: testId(1), body: '消える本文')],
      );
      addTearDown(api.dispose);

      await pumpApp(
        tester,
        api: api,
        size: _narrow,
        prefs: {'channels.selected': testId(1)},
        child: const HomeShell(),
      );

      await tester.longPress(find.text('消える本文'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('削除'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('post-delete-confirm')));
      await tester.pumpAndSettle();

      expect(find.text('消える本文'), findsNothing);
      expect(api.calls, contains('deletePost:${testId(10)}'));
    });
  });

  group('post-threads: スレッド', () {
    testWidgets('返信を投稿するとスレッド末尾に出る', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [post(10, channelId: testId(1), body: '親')],
      );
      addTearDown(api.dispose);

      await pumpApp(
        tester,
        api: api,
        size: _narrow,
        prefs: {'channels.selected': testId(1)},
        child: const HomeShell(),
      );

      await tester.tap(find.text('スレッドで返信'));
      await tester.pumpAndSettle();
      expect(find.byType(ThreadScreen), findsOneWidget);

      await tester.enterText(find.byKey(const Key('composer-input')), '返信します');
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('composer-send')));
      await tester.pumpAndSettle();

      expect(find.text('返信します'), findsOneWidget);
    });

    testWidgets('親が削除されていてもスレッドは開け、返信は残る', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [
          post(10, channelId: testId(1), body: '削除された親', deleted: true, replyCount: 1),
          post(11, channelId: testId(1), threadRootId: testId(10), body: '残る返信'),
        ],
      );
      addTearDown(api.dispose);

      await pumpApp(
        tester,
        api: api,
        size: _narrow,
        prefs: {'channels.selected': testId(1)},
        child: const ThreadScreen(rootPostId: '00000000-0000-4000-8000-000000000010'),
      );

      expect(find.text('このポストは削除されました'), findsOneWidget);
      expect(find.text('削除された親'), findsNothing);
      expect(find.text('残る返信'), findsOneWidget);
    });
  });

  group('emoji-reactions: リアクション', () {
    testWidgets('自分の付与を区別して表示する', (tester) async {
      final emoji = Emoji(id: testId(900), shortcode: 'tada', imagePath: 'tada.png', checksum: 'x');
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        emojis: [emoji],
        posts: [
          post(
            10,
            channelId: testId(1),
            body: '祝う',
            reactions: [Reaction(emoji: emoji, count: 2, reactedByMe: true, reactorIds: const ['me', 'other'])],
          ),
        ],
      );
      addTearDown(api.dispose);

      await pumpApp(
        tester,
        api: api,
        size: _narrow,
        prefs: {'channels.selected': testId(1)},
        child: const HomeShell(),
      );

      // 画像が取れない場合はショートコードを文字で出す。
      expect(find.text(':tada:'), findsOneWidget);
      expect(find.text('2'), findsOneWidget);
    });

    testWidgets('付与済みのリアクションを押すと解除される', (tester) async {
      final emoji = Emoji(id: testId(900), shortcode: 'tada', imagePath: 'tada.png', checksum: 'x');
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        emojis: [emoji],
        posts: [
          post(
            10,
            channelId: testId(1),
            body: '祝う',
            reactions: [Reaction(emoji: emoji, count: 1, reactedByMe: true, reactorIds: const ['me'])],
          ),
        ],
      );
      addTearDown(api.dispose);

      await pumpApp(
        tester,
        api: api,
        size: _narrow,
        prefs: {'channels.selected': testId(1)},
        child: const HomeShell(),
      );

      await tester.tap(find.text(':tada:'));
      await tester.pumpAndSettle();

      expect(api.calls, contains('removeReaction:${testId(10)}:${testId(900)}'));
      expect(find.text(':tada:'), findsNothing);
    });
  });

  group('rich-content-rendering: 描画', () {
    testWidgets('コードブロックをハイライトして描く', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [post(10, channelId: testId(1), body: '```dart\nvoid main() {}\n```')],
      );
      addTearDown(api.dispose);

      await pumpApp(
        tester,
        api: api,
        size: _narrow,
        prefs: {'channels.selected': testId(1)},
        child: const HomeShell(),
      );

      expect(find.byType(CodeBlock), findsOneWidget);
      expect(find.text('dart'), findsOneWidget);
    });

    testWidgets('未対応の言語でも素のコードとして描く', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [post(10, channelId: testId(1), body: '```klingon\nnuqneH\n```')],
      );
      addTearDown(api.dispose);

      await pumpApp(
        tester,
        api: api,
        size: _narrow,
        prefs: {'channels.selected': testId(1)},
        child: const HomeShell(),
      );

      expect(find.byType(CodeBlock), findsOneWidget);
      expect(find.text('klingon'), findsNothing);
    });
  });

  group('full-text-search: 検索', () {
    testWidgets('2 文字未満では検索しない', (tester) async {
      final api = FakeApi(channels: [channel(1, name: 'general')]);
      addTearDown(api.dispose);

      await pumpApp(tester, api: api, size: _narrow, child: const SearchScreen());

      await tester.enterText(find.byKey(const Key('search-input')), 'あ');
      await tester.pumpAndSettle();

      expect(find.text('2 文字以上で検索します'), findsOneWidget);
      final run = tester.widget<IconButton>(find.byKey(const Key('search-run')));
      expect(run.onPressed, isNull);
    });

    testWidgets('チャネル名と日時つきで結果を出し、0 件も表示する', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [post(10, channelId: testId(1), body: '議事録の下書き')],
      );
      addTearDown(api.dispose);

      await pumpApp(tester, api: api, size: _narrow, child: const SearchScreen());

      await tester.enterText(find.byKey(const Key('search-input')), '議事録');
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('search-run')));
      await tester.pumpAndSettle();

      expect(find.textContaining('#general'), findsOneWidget);
      expect(find.textContaining('議事録の下書き'), findsOneWidget);

      await tester.enterText(find.byKey(const Key('search-input')), '存在しない語');
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('search-run')));
      await tester.pumpAndSettle();

      expect(find.text('一致するポストがありません'), findsOneWidget);
    });

    testWidgets('結果を選ぶと、そのポストが見える位置でタイムラインを開く', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [
          for (var i = 0; i < 30; i++)
            post(100 + i, channelId: testId(1), body: 'post $i', createdAt: DateTime(2026, 3, 1, 9, i)),
        ],
      );
      addTearDown(api.dispose);

      final container = await pumpApp(
        tester,
        api: api,
        size: _narrow,
        child: const SearchScreen(),
      );

      await tester.enterText(find.byKey(const Key('search-input')), 'post 3');
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('search-run')));
      await tester.pumpAndSettle();

      await tester.tap(find.textContaining('post 3').first);
      await tester.pumpAndSettle();

      expect(container.read(selectedChannelProvider), testId(1));
      // around でその範囲を読み直している。
      expect(
        api.calls.where((c) => c.contains('around=${testId(103)}')),
        isNotEmpty,
      );
      final state = container.read(timelineProvider(testId(1))).value!;
      expect(state.posts.map((p) => p.body), contains('post 3'));
    });
  });

  group('attachments: 添付の表示', () {
    testWidgets('非画像はファイルカードとして出す', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [
          Post(
            id: testId(10),
            channelId: testId(1),
            authorId: 'author',
            body: '資料です',
            createdAt: DateTime(2026, 3, 1, 9),
            updatedAt: DateTime(2026, 3, 1, 9),
            deleted: false,
            replyCount: 0,
            attachments: [
              Attachment(
                id: testId(500),
                fileName: 'report.pdf',
                contentType: 'application/pdf',
                sizeBytes: 2048,
                checksum: 'x',
                createdAt: DateTime(2026, 3, 1, 9),
              ),
            ],
          ),
        ],
      );
      addTearDown(api.dispose);

      await pumpApp(
        tester,
        api: api,
        size: _narrow,
        prefs: {'channels.selected': testId(1)},
        child: const HomeShell(),
      );

      expect(find.text('report.pdf'), findsOneWidget);
      expect(find.text('2.0 KB'), findsOneWidget);
    });
  });

  group('操作導線', () {
    testWidgets('長押しで操作メニューを出す', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [post(10, channelId: testId(1), body: '対象ポスト')],
      );
      addTearDown(api.dispose);

      await pumpApp(
        tester,
        api: api,
        size: _narrow,
        prefs: {'channels.selected': testId(1)},
        child: const HomeShell(),
      );

      expect(find.byType(PostTile), findsOneWidget);
      await tester.longPress(find.text('対象ポスト'));
      await tester.pumpAndSettle();

      expect(find.text('編集'), findsOneWidget);
      expect(find.text('削除'), findsOneWidget);
      expect(find.text('スレッドを開く'), findsOneWidget);
      expect(find.text('リアクションを付ける'), findsOneWidget);
    });
  });
}
