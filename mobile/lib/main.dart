import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app.dart';
import 'state/providers.dart';
import 'state/settings.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // 下書き・展開状態・選択中チャネルの読み出しを同期にするため、起動時に読む。
  final prefs = await SharedPreferences.getInstance();

  runApp(
    ProviderScope(
      retry: noAutomaticRetry,
      overrides: [sharedPreferencesProvider.overrideWithValue(prefs)],
      child: const PostAllApp(),
    ),
  );
}
