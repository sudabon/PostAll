// specs/mobile-shell/spec.md の各 Scenario に対応する widget test。
//
// 各 group が Requirement、各 testWidgets が Scenario にひとつずつ対応する。
import 'package:flutter/gestures.dart' show kLongPressTimeout;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:postall/app.dart';
import 'package:postall/state/channels.dart';
import 'package:postall/state/connection.dart';
import 'package:postall/state/sync.dart';
import 'package:postall/ui/screens/channels_screen.dart';
import 'package:postall/ui/screens/home_shell.dart';
import 'package:postall/ui/screens/thread_screen.dart';
import 'package:postall/ui/screens/timeline_screen.dart';
import 'package:postall/ui/widgets/composer.dart';

import 'support/fake_api.dart';
import 'support/harness.dart';

const _narrow = Size(390, 844);
const _wide = Size(1024, 768);

void main() {
  group('Requirement: iOS アプリとしての起動', () {
    testWidgets('Scenario: アプリを起動する — 前回のチャネルのタイムラインを復元する', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [post(10, channelId: testId(1), body: 'おはよう')],
      );
      addTearDown(api.dispose);

      await pumpApp(
        tester,
        api: api,
        size: _narrow,
        // 前回開いていたチャネルが保存されている状態。
        prefs: {'channels.selected': testId(1)},
        child: const PostAllApp(),
      );

      expect(find.text('general'), findsWidgets);
      expect(find.text('おはよう'), findsOneWidget);
    });

    testWidgets('Scenario: 未サインイン状態で起動する — 内容を表示しない', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [post(10, channelId: testId(1), body: '秘密')],
      );
      addTearDown(api.dispose);

      await pumpApp(tester, api: api, signedIn: false, size: _narrow, child: const PostAllApp());

      expect(find.text('サインイン'), findsOneWidget);
      expect(find.text('general'), findsNothing);
      expect(find.text('秘密'), findsNothing);
    });

    testWidgets('Scenario: バックエンドへ接続できない — 再試行を出し、古いデータを見せない', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [post(10, channelId: testId(1), body: '古い内容')],
        healthy: false,
      );
      addTearDown(api.dispose);

      await pumpApp(tester, api: api, size: _narrow, child: const PostAllApp());

      expect(find.text('バックエンドへ接続できません'), findsOneWidget);
      expect(find.byKey(const Key('retry-connection')), findsOneWidget);
      expect(find.text('古い内容'), findsNothing);

      // 復旧してから再試行するとチャネルが出る。
      api.healthy = true;
      await tester.tap(find.byKey(const Key('retry-connection')));
      await tester.pumpAndSettle();

      expect(find.text('general'), findsWidgets);
    });
  });

  group('Requirement: 狭幅向けナビゲーション', () {
    testWidgets('Scenario: チャネルからタイムラインへ遷移する', (tester) async {
      final api = FakeApi(channels: [channel(1, name: 'general')]);
      addTearDown(api.dispose);

      await pumpApp(tester, api: api, size: _narrow, child: const HomeShell());
      expect(find.byType(TimelineScreen), findsNothing);

      await tester.tap(find.text('general'));
      await tester.pumpAndSettle();

      expect(find.byType(TimelineScreen), findsOneWidget);
      // 選択したチャネル名をヘッダーに表示する。
      expect(find.widgetWithText(AppBar, 'general'), findsOneWidget);
    });

    testWidgets('Scenario: チャネル一覧へ戻る — 直前のチャネルを強調表示する', (tester) async {
      final api = FakeApi(channels: [channel(1, name: 'general')]);
      addTearDown(api.dispose);

      final container =
          await pumpApp(tester, api: api, size: _narrow, child: const HomeShell());

      await tester.tap(find.text('general'));
      await tester.pumpAndSettle();
      await tester.pageBack();
      await tester.pumpAndSettle();

      expect(find.byType(ChannelsScreen), findsOneWidget);
      expect(find.byType(TimelineScreen), findsNothing);
      // 戻ってもどのチャネルを見ていたかは残る。
      expect(container.read(selectedChannelProvider), testId(1));
    });

    testWidgets('Scenario: スレッドを開く — 独立画面で開き、戻るとタイムラインへ復帰する', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [
          post(10, channelId: testId(1), body: '親ポスト', replyCount: 1),
          post(11, channelId: testId(1), threadRootId: testId(10), body: '返信です'),
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

      await tester.tap(find.text('1 件の返信'));
      await tester.pumpAndSettle();

      expect(find.byType(ThreadScreen), findsOneWidget);
      expect(find.text('返信です'), findsOneWidget);

      await tester.pageBack();
      await tester.pumpAndSettle();

      expect(find.byType(ThreadScreen), findsNothing);
      expect(find.byType(TimelineScreen), findsOneWidget);
    });

    testWidgets('Scenario: 横向きや大画面で表示する — 並列表示へ切り替える', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [post(10, channelId: testId(1), body: '本文')],
      );
      addTearDown(api.dispose);

      await pumpApp(
        tester,
        api: api,
        size: _wide,
        prefs: {'channels.selected': testId(1)},
        child: const HomeShell(),
      );

      // チャネル一覧とタイムラインが同時に見える。
      expect(find.byType(ChannelsScreen), findsOneWidget);
      expect(find.byType(TimelineScreen), findsOneWidget);
      expect(find.text('本文'), findsOneWidget);
    });
  });

  group('Requirement: チャネル階層のタッチ操作', () {
    testWidgets('Scenario: 階層を展開する', (tester) async {
      final api = FakeApi(
        channels: [
          channel(1, name: 'parent'),
          channel(2, name: 'child', parentId: testId(1), sortKey: 'm1'),
        ],
      );
      addTearDown(api.dispose);

      await pumpApp(tester, api: api, size: _narrow, child: const HomeShell());
      expect(find.text('child'), findsNothing);

      await tester.tap(find.byTooltip('展開する'));
      await tester.pumpAndSettle();
      expect(find.text('child'), findsOneWidget);

      await tester.tap(find.byTooltip('折りたたむ'));
      await tester.pumpAndSettle();
      expect(find.text('child'), findsNothing);
    });

    testWidgets('Scenario: 長押しドラッグで移動する — 親の付け替えが保存される', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'alpha'), channel(2, name: 'beta', sortKey: 'n')],
      );
      addTearDown(api.dispose);

      await pumpApp(tester, api: api, size: _narrow, child: const HomeShell());

      await _longPressDrag(tester, from: find.text('beta'), to: find.text('alpha'));

      expect(
        api.calls,
        contains('moveChannel:${testId(2)}:parent=${testId(1)}:before=null'),
      );
      expect(api.channels.firstWhere((c) => c.id == testId(2)).parentId, testId(1));
    });

    testWidgets('Scenario: 無効な移動を拒否する — 自身の子孫へはドロップできない', (tester) async {
      final api = FakeApi(
        channels: [
          channel(1, name: 'parent'),
          channel(2, name: 'child', parentId: testId(1), sortKey: 'm1'),
        ],
      );
      addTearDown(api.dispose);

      await pumpApp(
        tester,
        api: api,
        size: _narrow,
        prefs: {'channels.expanded': <String>[testId(1)]},
        child: const HomeShell(),
      );
      expect(find.text('child'), findsOneWidget);

      await _longPressDrag(tester, from: find.text('parent'), to: find.text('child'));

      // 移動要求そのものが発行されない。
      expect(api.calls.where((c) => c.startsWith('moveChannel')), isEmpty);
      expect(api.channels.firstWhere((c) => c.id == testId(1)).parentId, isNull);
    });

    testWidgets('Scenario: 名前が衝突する移動を拒否する', (tester) async {
      final api = FakeApi(
        channels: [
          channel(1, name: 'parent'),
          channel(2, name: 'docs', parentId: testId(1), sortKey: 'm1'),
          channel(3, name: 'docs', sortKey: 'n'),
        ],
      );
      addTearDown(api.dispose);

      await pumpApp(
        tester,
        api: api,
        size: _narrow,
        prefs: {'channels.expanded': <String>[testId(1)]},
        child: const HomeShell(),
      );

      // ルートの docs を parent の下（既に docs がある）へ落とす。
      await _longPressDrag(tester, from: find.text('docs').last, to: find.text('parent'));

      expect(api.calls.where((c) => c.startsWith('moveChannel')), isEmpty);
      expect(api.channels.firstWhere((c) => c.id == testId(3)).parentId, isNull);
      expect(find.text('移動先に同じ名前のチャネルがあります'), findsOneWidget);
    });
  });

  group('Requirement: ソフトキーボードと入力フォームの共存', () {
    testWidgets('Scenario: キーボードを開く — フォームがキーボードの上に留まる', (tester) async {
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

      final before = tester.getBottomLeft(find.byType(Composer)).dy;

      // ソフトキーボードの分だけ viewInsets が増える状況を作る。
      tester.view.viewInsets = const FakeViewPadding(bottom: 300);
      addTearDown(tester.view.resetViewInsets);
      await tester.pumpAndSettle();

      final input = tester.getBottomLeft(find.byKey(const Key('composer-input'))).dy;
      // 入力欄がキーボード領域（画面下 300 論理ピクセル）へ潜り込まない。
      expect(input, lessThanOrEqualTo(before - 300));
    });

    testWidgets('Scenario: キーボード表示中もタイムラインを読む — 入力内容を失わない', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [for (var i = 0; i < 10; i++) post(20 + i, channelId: testId(1), body: 'post $i')],
      );
      addTearDown(api.dispose);

      await pumpApp(
        tester,
        api: api,
        size: _narrow,
        prefs: {'channels.selected': testId(1)},
        child: const HomeShell(),
      );

      await tester.enterText(find.byKey(const Key('composer-input')), '書きかけ');
      await tester.pumpAndSettle();

      await tester.drag(find.byType(ListView).first, const Offset(0, 200));
      await tester.pumpAndSettle();

      final field = tester.widget<TextField>(find.byKey(const Key('composer-input')));
      expect(field.controller?.text, '書きかけ');
    });

    testWidgets('Scenario: セーフエリアを尊重する', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [post(10, channelId: testId(1))],
      );
      addTearDown(api.dispose);

      // ホームインジケータを持つ端末を模す。
      tester.view.padding = const FakeViewPadding(bottom: 34);
      addTearDown(tester.view.resetPadding);

      await pumpApp(
        tester,
        api: api,
        size: _narrow,
        prefs: {'channels.selected': testId(1)},
        child: const HomeShell(),
      );

      final input = tester.getBottomLeft(find.byKey(const Key('composer-input'))).dy;
      final screenBottom = tester.getBottomLeft(find.byType(Composer)).dy;
      expect(input, lessThanOrEqualTo(screenBottom - 34));
    });
  });

  group('Requirement: バックグラウンド復帰時の更新', () {
    testWidgets('Scenario: 復帰時に差分を取得する', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [post(10, channelId: testId(1), body: '最初')],
      )
        // バックグラウンドでは SSE が切れている（design.md D13 のトレードオフ）。
        ..streamConnected = false;
      addTearDown(api.dispose);

      final container = await pumpApp(
        tester,
        api: api,
        size: _narrow,
        prefs: {'channels.selected': testId(1)},
        child: const HomeShell(),
      );

      // 見ていない間にサーバ側でポストが増えた。SSE が切れているので届かない。
      await api.createPost(testId(1), '不在中の投稿');
      await tester.pump();
      expect(find.text('不在中の投稿'), findsNothing);

      // 復帰で差分をまとめて取り直す。
      await container.read(changeSyncProvider)!.resume();
      await tester.pumpAndSettle();

      expect(api.calls.where((c) => c.startsWith('listEvents')), isNotEmpty);
      expect(find.text('不在中の投稿'), findsOneWidget);

      // 再接続待ちのタイマーを残したままテストを終えない。
      container.read(changeSyncProvider)!.dispose();
    });
  });

  group('接続状態', () {
    testWidgets('接続断中は投稿できない', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [post(10, channelId: testId(1))],
      );
      addTearDown(api.dispose);

      final container = await pumpApp(
        tester,
        api: api,
        size: _narrow,
        prefs: {'channels.selected': testId(1)},
        child: const HomeShell(),
      );

      container.read(connectionProvider.notifier).set(BackendConnection.offline);
      await tester.pumpAndSettle();

      expect(find.text('バックエンドへ接続できないため投稿できません'), findsOneWidget);
      final field = tester.widget<TextField>(find.byKey(const Key('composer-input')));
      expect(field.enabled, isFalse);
    });
  });
}

/// 長押ししてから対象の上まで運び、離す。
Future<void> _longPressDrag(
  WidgetTester tester, {
  required Finder from,
  required Finder to,
}) async {
  final gesture = await tester.startGesture(tester.getCenter(from));
  await tester.pump(kLongPressTimeout + const Duration(milliseconds: 100));
  await gesture.moveTo(tester.getCenter(to));
  await tester.pump();
  await gesture.up();
  await tester.pumpAndSettle();
}
