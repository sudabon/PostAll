import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../state/auth.dart';
import '../../state/settings.dart';

/// サインイン画面。
///
/// 認証情報を持たない状態ではチャネルやポストの内容を一切出さない
/// （mobile-shell spec「未サインイン状態で起動する」）。
class SignInScreen extends ConsumerWidget {
  const SignInScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider).value ?? const AuthState();
    final settings = ref.watch(settingsProvider);

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('PostAll', style: Theme.of(context).textTheme.headlineMedium),
                const SizedBox(height: 8),
                Text(
                  'サインインするとチャネルとポストを表示します',
                  style: Theme.of(context).textTheme.bodyMedium,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 24),
                if (auth.error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(
                      auth.error!,
                      style: TextStyle(color: Theme.of(context).colorScheme.error),
                      textAlign: TextAlign.center,
                    ),
                  ),
                FilledButton(
                  key: const Key('sign-in-button'),
                  onPressed: auth.busy || !settings.canSignIn
                      ? null
                      : () => ref.read(authControllerProvider.notifier).signIn(),
                  child: auth.busy
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('サインイン'),
                ),
                if (!settings.canSignIn)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Text(
                      'Cognito の接続設定が未入力です',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                TextButton(
                  onPressed: () => showSettingsDialog(context, ref),
                  child: const Text('接続設定'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// 接続先の設定。iOS では実行中に切り替えられると検証が楽になる。
Future<void> showSettingsDialog(BuildContext context, WidgetRef ref) =>
    showDialog<void>(context: context, builder: (_) => const _SettingsDialog());

class _SettingsDialog extends ConsumerStatefulWidget {
  const _SettingsDialog();

  @override
  ConsumerState<_SettingsDialog> createState() => _SettingsDialogState();
}

class _SettingsDialogState extends ConsumerState<_SettingsDialog> {
  late final AppSettings _initial = ref.read(settingsProvider);
  late final _apiBaseUrl = TextEditingController(text: _initial.apiBaseUrl);
  late final _domain = TextEditingController(text: _initial.cognitoDomain);
  late final _clientId = TextEditingController(text: _initial.cognitoClientId);

  @override
  void dispose() {
    _apiBaseUrl.dispose();
    _domain.dispose();
    _clientId.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final navigator = Navigator.of(context);
    await ref.read(settingsProvider.notifier).update(
          apiBaseUrl: _apiBaseUrl.text.trim(),
          cognitoDomain: _domain.text.trim(),
          cognitoClientId: _clientId.text.trim(),
        );
    navigator.pop();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('接続設定'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _apiBaseUrl,
              decoration: const InputDecoration(labelText: 'API のベース URL'),
            ),
            TextField(
              controller: _domain,
              decoration: const InputDecoration(labelText: 'Cognito ドメイン'),
            ),
            TextField(
              controller: _clientId,
              decoration: const InputDecoration(labelText: 'Cognito クライアント ID'),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('取り消す'),
        ),
        TextButton(onPressed: _save, child: const Text('保存')),
      ],
    );
  }
}
