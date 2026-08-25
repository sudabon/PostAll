import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'state/auth.dart';
import 'state/startup.dart';
import 'ui/screens/home_shell.dart';
import 'ui/screens/sign_in_screen.dart';

class PostAllApp extends StatelessWidget {
  const PostAllApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'PostAll',
      theme: ThemeData(colorSchemeSeed: const Color(0xFF4A154B)),
      darkTheme: ThemeData(colorSchemeSeed: const Color(0xFF4A154B), brightness: Brightness.dark),
      home: const _Root(),
    );
  }
}

class _Root extends ConsumerWidget {
  const _Root();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);

    return auth.when(
      loading: () => const Scaffold(body: Center(child: CircularProgressIndicator())),
      error: (error, _) => Scaffold(body: Center(child: Text('起動に失敗しました\n$error'))),
      data: (state) {
        if (!state.signedIn) return const SignInScreen();
        return const _ReachabilityGate(child: HomeShell());
      },
    );
  }
}

/// バックエンドへ接続できないまま古いデータを見せない。
class _ReachabilityGate extends ConsumerWidget {
  const _ReachabilityGate({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final reachable = ref.watch(backendReachableProvider);

    return reachable.when(
      loading: () => const Scaffold(body: Center(child: CircularProgressIndicator())),
      error: (_, __) => _Unreachable(onRetry: () => ref.invalidate(backendReachableProvider)),
      data: (ok) =>
          ok ? child : _Unreachable(onRetry: () => ref.invalidate(backendReachableProvider)),
    );
  }
}

class _Unreachable extends StatelessWidget {
  const _Unreachable({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('バックエンドへ接続できません', textAlign: TextAlign.center),
              const SizedBox(height: 8),
              Text(
                '通信環境を確認してから再試行してください。',
                style: Theme.of(context).textTheme.bodySmall,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              FilledButton(
                key: const Key('retry-connection'),
                onPressed: onRetry,
                child: const Text('再試行'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
