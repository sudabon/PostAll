// attachments spec と mobile-shell「iOS からの添付」のうち、
// 端末側で完結する部分（選択・上限検証・権限拒否・アップロード）。
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:postall/state/attachments.dart';
import 'package:postall/ui/screens/home_shell.dart';
import 'package:postall/ui/widgets/attachment_picker.dart';
import 'package:postall/util/attachment_limits.dart';

import 'support/fake_api.dart';
import 'support/harness.dart';

/// 添付元の選択と読み込みを差し替えるピッカー。
class StubPicker implements AttachmentPicker {
  StubPicker({this.library, this.camera, this.files = const [], this.denied});

  final PickedFile? library;
  final PickedFile? camera;
  final List<PickedFile> files;

  /// 権限が拒否されている場合に投げる例外。
  final PermissionDeniedException? denied;

  @override
  Future<PickedFile?> pickFromLibrary() async {
    if (denied != null) throw denied!;
    return library;
  }

  @override
  Future<PickedFile?> pickFromCamera() async {
    if (denied != null) throw denied!;
    return camera;
  }

  @override
  Future<List<PickedFile>> pickFiles() async => files;
}

PickedFile picked({
  String fileName = 'photo.png',
  String contentType = 'image/png',
  int size = 16,
}) =>
    PickedFile(
      fileName: fileName,
      contentType: contentType,
      bytes: Uint8List.fromList(List<int>.filled(size, 7)),
    );

Future<void> _openComposer(WidgetTester tester, FakeApi api, StubPicker picker) async {
  await pumpApp(
    tester,
    api: api,
    size: const Size(390, 844),
    prefs: {'channels.selected': testId(1)},
    child: _ComposerHost(picker: picker),
  );
}

/// タイムライン画面と同じ Composer を、差し替えたピッカーで動かす。
class _ComposerHost extends StatelessWidget {
  const _ComposerHost({required this.picker});

  final AttachmentPicker picker;

  @override
  Widget build(BuildContext context) => HomeShell(attachmentPicker: picker);
}

void main() {
  group('添付の選択', () {
    testWidgets('写真ライブラリから選ぶとフォームに追加され、アップロードされる', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [post(10, channelId: testId(1))],
      );
      addTearDown(api.dispose);

      await _openComposer(tester, api, StubPicker(library: picked()));

      await tester.tap(find.byTooltip('添付を追加'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('写真ライブラリ'));
      await tester.pumpAndSettle();

      expect(find.text('photo.png'), findsOneWidget);
      expect(api.calls, contains('startUpload:photo.png'));
    });

    testWidgets('権限が拒否されていると案内を出し、クラッシュしない', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [post(10, channelId: testId(1))],
      );
      addTearDown(api.dispose);

      await _openComposer(
        tester,
        api,
        StubPicker(denied: const PermissionDeniedException('カメラへのアクセスが許可されていません')),
      );

      await tester.tap(find.byTooltip('添付を追加'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('カメラ'));
      await tester.pumpAndSettle();

      expect(find.text('権限が必要です'), findsOneWidget);
      expect(find.textContaining('カメラへのアクセスが許可されていません'), findsOneWidget);
      expect(api.calls.where((c) => c.startsWith('startUpload')), isEmpty);
    });

    testWidgets('上限を超えるファイルは受け付けない', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [post(10, channelId: testId(1))],
      );
      addTearDown(api.dispose);

      await _openComposer(
        tester,
        api,
        StubPicker(files: [picked(fileName: 'huge.png', size: maxAttachmentBytes + 1)]),
      );

      await tester.tap(find.byTooltip('添付を追加'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('ファイル'));
      await tester.pumpAndSettle();

      expect(find.text('ファイルサイズの上限は 25 MiB です'), findsOneWidget);
      expect(api.calls.where((c) => c.startsWith('startUpload')), isEmpty);
    });

    testWidgets('許可されていない形式は受け付けない', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [post(10, channelId: testId(1))],
      );
      addTearDown(api.dispose);

      await _openComposer(
        tester,
        api,
        StubPicker(files: [picked(fileName: 'run.sh', contentType: 'application/x-sh')]),
      );

      await tester.tap(find.byTooltip('添付を追加'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('ファイル'));
      await tester.pumpAndSettle();

      expect(find.text('この形式のファイルは添付できません'), findsOneWidget);
    });

    testWidgets('送信前に添付を外せる', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [post(10, channelId: testId(1))],
      );
      addTearDown(api.dispose);

      await _openComposer(tester, api, StubPicker(library: picked()));

      await tester.tap(find.byTooltip('添付を追加'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('写真ライブラリ'));
      await tester.pumpAndSettle();
      expect(find.text('photo.png'), findsOneWidget);

      await tester.tap(find.byTooltip('添付を外す'));
      await tester.pumpAndSettle();

      expect(find.text('photo.png'), findsNothing);
    });

    testWidgets('本文が空でも添付だけで投稿できる', (tester) async {
      final api = FakeApi(
        channels: [channel(1, name: 'general')],
        posts: [post(10, channelId: testId(1))],
      );
      addTearDown(api.dispose);

      await _openComposer(tester, api, StubPicker(library: picked()));

      await tester.tap(find.byTooltip('添付を追加'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('写真ライブラリ'));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('composer-send')));
      await tester.pumpAndSettle();

      expect(api.calls, contains('createPost:${testId(1)}'));
      expect(find.text('photo.png'), findsNothing);
    });
  });

  group('チェックサム', () {
    test('同じ内容からは同じ値が出る', () {
      expect(checksumOf([1, 2, 3]), checksumOf([1, 2, 3]));
      expect(checksumOf([1, 2, 3]), isNot(checksumOf([1, 2, 4])));
      expect(checksumOf([1, 2, 3]), hasLength(64));
    });
  });
}
