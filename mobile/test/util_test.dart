import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:postall/auth/pkce.dart';
import 'package:postall/state/timeline.dart';
import 'package:postall/ui/widgets/mermaid_view.dart';
import 'package:postall/util/mermaid_document.dart';
import 'package:postall/ui/widgets/timeline_list.dart';
import 'package:postall/util/attachment_limits.dart';
import 'package:postall/util/dates.dart';
import 'package:postall/util/excerpt.dart';
import 'package:postall/util/tree.dart';

import 'support/harness.dart';

void main() {
  group('チャネル階層', () {
    test('sortKey の順に木を組む', () {
      final forest = buildForest([
        channel(2, name: 'b', sortKey: 'n'),
        channel(1, name: 'a', sortKey: 'm'),
        channel(3, name: 'a-child', parentId: testId(1), sortKey: 'm1'),
      ]);

      expect(forest.map((n) => n.name), ['a', 'b']);
      expect(forest.first.children.map((n) => n.name), ['a-child']);
    });

    test('子孫を列挙する', () {
      final forest = buildForest([
        channel(1),
        channel(2, parentId: testId(1)),
        channel(3, parentId: testId(2)),
        channel(4),
      ]);

      expect(descendantIds(forest, testId(1)), {testId(2), testId(3)});
      expect(descendantIds(forest, testId(4)), isEmpty);
    });

    test('折りたたまれた子は並べない', () {
      final forest = buildForest([channel(1), channel(2, parentId: testId(1))]);

      expect(flattenVisible(forest, {}).length, 1);
      expect(flattenVisible(forest, {testId(1)}).map((v) => v.depth), [0, 1]);
    });

    test('同一階層の同名を衝突として扱う', () {
      final channels = [
        channel(1, name: 'general'),
        channel(2, name: 'general', parentId: testId(1)),
      ];

      expect(
        hasNameConflict(channels, name: 'general', parentId: null),
        isTrue,
      );
      expect(
        hasNameConflict(
          channels,
          name: 'general',
          parentId: null,
          excludingId: testId(1),
        ),
        isFalse,
      );
      expect(
        hasNameConflict(channels, name: 'general', parentId: testId(2)),
        isFalse,
      );
    });
  });

  group('日付', () {
    test('ローカルタイムゾーンで日付キーを決める', () {
      final value = DateTime.utc(2026, 3, 1, 15).toLocal();
      expect(
        localDateKey(value),
        '${value.year}-03-0${value.day}'.replaceAll('-030', '-03-0'),
      );
      expect(formatDateLabel(DateTime(2026, 3, 1)), '2026年3月1日');
      expect(formatTime(DateTime(2026, 3, 1, 9, 5)), '09:05');
    });
  });

  group('抜粋', () {
    test('一致箇所を強調し、前後を切り詰める', () {
      final excerpt = buildExcerpt(
        '${'あ' * 100}検索語${'い' * 100}',
        '検索語',
        radius: 10,
      );

      expect(excerpt.parts.where((p) => p.match).map((p) => p.text), ['検索語']);
      expect(excerpt.clippedStart, isTrue);
      expect(excerpt.clippedEnd, isTrue);
    });

    test('一致しない場合は先頭を返す', () {
      final excerpt = buildExcerpt('abcdef', 'zzz', radius: 2);

      expect(excerpt.parts.single.match, isFalse);
      expect(excerpt.clippedStart, isFalse);
    });
  });

  group('タイムライン', () {
    test('同時刻はポスト ID で安定して並ぶ', () {
      final at = DateTime.utc(2026, 3, 1, 9);
      final sorted = sortPosts([
        post(2, channelId: 'c', createdAt: at),
        post(1, channelId: 'c', createdAt: at),
      ]);

      expect(sorted.map((p) => p.id), [testId(1), testId(2)]);
    });

    test('重複を除いて束ねる', () {
      final existing = [post(1, channelId: 'c')];
      final merged = mergePosts(existing, [
        post(1, channelId: 'c', body: '更新'),
        post(2, channelId: 'c'),
      ]);

      expect(merged, hasLength(2));
      expect(merged.first.body, '更新');
    });

    test('日付が変わる箇所にだけセパレータを挟む', () {
      final rows = buildTimelineRows([
        post(1, channelId: 'c', createdAt: DateTime(2026, 3, 1, 9)),
        post(2, channelId: 'c', createdAt: DateTime(2026, 3, 1, 10)),
        post(3, channelId: 'c', createdAt: DateTime(2026, 3, 2, 9)),
      ]);

      expect(rows.whereType<SeparatorRow>(), hasLength(2));
      expect(rows.first, isA<SeparatorRow>());
    });
  });

  group('添付の上限', () {
    test('サイズ・件数・形式を検証する', () {
      expect(
        attachmentRejection(
          contentType: 'image/png',
          sizeBytes: 1,
          alreadyAttached: 0,
        ),
        isNull,
      );
      expect(
        attachmentRejection(
          contentType: 'image/png',
          sizeBytes: 1,
          alreadyAttached: 10,
        ),
        contains('10 件'),
      );
      expect(
        attachmentRejection(
          contentType: 'image/png',
          sizeBytes: maxAttachmentBytes + 1,
          alreadyAttached: 0,
        ),
        contains('25 MiB'),
      );
      expect(
        attachmentRejection(
          contentType: 'application/x-sh',
          sizeBytes: 1,
          alreadyAttached: 0,
        ),
        contains('添付できません'),
      );
    });

    test('拡張子から MIME type を引く', () {
      expect(contentTypeForFileName('a.PNG'), 'image/png');
      expect(contentTypeForFileName('a.unknown'), 'application/octet-stream');
    });
  });

  group('PKCE', () {
    test('S256 の challenge を作る', () {
      final pair = generatePkce();

      expect(pair.verifier, isNot(contains('=')));
      expect(pair.challenge, isNot(contains('+')));
      expect(pair.challenge, isNot(contains('/')));
      expect(generatePkce().verifier, isNot(pair.verifier));
    });

    test('authorize URL に PKCE のパラメータを載せる', () {
      final url = authorizeUrl(
        supabaseUrl: 'https://auth.example.invalid',
        redirectUri: 'postall://auth/callback',
        challenge: 'challenge',
      );

      expect(url.queryParameters['code_challenge_method'], 'S256');
      expect(url.queryParameters['redirect_to'], 'postall://auth/callback');
      expect(url.queryParameters['provider'], 'github');
      expect(url.path, '/auth/v1/authorize');

      final explicit = authorizeUrl(
        supabaseUrl: 'https://auth.example.invalid',
        redirectUri: 'postall://auth/callback',
        challenge: 'challenge',
        provider: 'gitlab',
      );
      expect(explicit.queryParameters['provider'], 'gitlab');
    });

    test('expires_in から失効時刻を決める', () {
      final tokens = TokenSet.fromTokenResponse({
        'access_token': 'a',
        'expires_in': 3600,
      }, now: DateTime.utc(2026, 1, 1));

      expect(tokens.expiresAt, DateTime.utc(2026, 1, 1, 1));
      expect(tokens.isFresh(now: DateTime.utc(2026, 1, 1)), isTrue);
      expect(tokens.isFresh(now: DateTime.utc(2026, 1, 1, 1)), isFalse);
    });
  });

  group('Mermaid の同時描画数', () {
    test('上限を超えた要求は枠が空くまで待つ', () async {
      final slots = MermaidSlots(capacity: 2);
      await slots.acquire();
      await slots.acquire();
      expect(slots.inUse, 2);

      var third = false;
      unawaited(slots.acquire().then((_) => third = true));
      await Future<void>.delayed(Duration.zero);
      expect(third, isFalse);

      slots.release();
      await Future<void>.delayed(Duration.zero);
      expect(third, isTrue);
    });
  });

  group('Mermaid HTML', () {
    test('ソースを script と分離して埋め込み、完全に復元できる', () {
      const source =
          'graph TD; A[</script><script>attack()</script>]\nB[\u2028\u2029]';
      final document = buildMermaidDocument(
        script: 'window.mermaid = {};',
        source: source,
        dark: false,
      );

      expect(document, isNot(contains(source)));
      expect(document, isNot(contains('</script><script>attack()')));
      expect(document, isNot(contains('\u2028')));
      expect(document, isNot(contains('\u2029')));

      final encoded = RegExp(
        "const encodedSource = '([^']+)'",
      ).firstMatch(document)!.group(1)!;
      expect(utf8.decode(base64Decode(encoded)), source);
    });
  });
}

void unawaited(Future<void> future) {}
