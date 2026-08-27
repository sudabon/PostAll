# PR #2 Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the twelve actionable PR #2 review findings without breaking existing client APIs or adding paid infrastructure.

**Architecture:** Keep Realtime as a best-effort wake-up path and preserve durable `GET /v1/events` recovery. Both clients obtain a fresh JWT for every explicit Realtime reconnect, poll while degraded, and retry with bounded exponential backoff; database and Storage fixes remain server-side and backward compatible. Database dumps are compressed, encrypted, size-bounded, and uploaded only as ciphertext.

**Tech Stack:** Go 1.26, PostgreSQL/goose/PGroonga, React 19/TypeScript/Vitest/Vite, Flutter 3.32/Dart/Supabase SDK, GitHub Actions/GPG.

**Spec:** `openspec/changes/vercel-supabase-migration/design.md` and `openspec/changes/vercel-supabase-migration/tasks.md` section 15.

## Global Constraints

- Always keep backward compatibility unless explicitly told otherwise.
- Do not remove or change existing public API signatures; compatible optional inputs and an optional capability interface are allowed by the approved design.
- Make minimal, focused changes and follow the existing coding style.
- Realtime failure must never roll back the primary database write.
- Realtime failure must retain 15-second event polling and display `degraded`, not `online`.
- GitHub Artifact retention is 30 days, each encrypted dump is at most 10 MiB, and the documented Actions storage budget is `$0` with usage blocked at the limit.
- Do not commit, push, deploy, create secrets, or mutate external services unless the user explicitly requests it.
- Execute this plan inline in the current session; multi-agent delegation is disabled for this task.

---

### Task 1: GitHub OAuth and invite-only authentication

**Files:**
- Create: `frontend/src/auth/pkce.test.ts`
- Modify: `frontend/src/auth/pkce.ts`
- Modify: `mobile/test/util_test.dart`
- Modify: `mobile/lib/auth/pkce.dart`
- Modify: `supabase/config.toml`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: existing `authorizeUrl(...)` builders and PKCE callback paths.
- Produces: TypeScript `authorizeUrl(input & { provider?: string }): string` and Dart `authorizeUrl(..., String provider = 'github'): Uri`, both source-compatible with existing calls.

- [x] **Step 1: Add failing URL-builder regression tests**

```ts
it('selects GitHub OAuth by default while accepting an explicit provider', () => {
  const defaults = new URL(authorizeUrl({
    supabaseUrl: 'https://auth.example.invalid',
    redirectUri: 'postall://auth/callback',
    challenge: 'challenge',
  }))
  expect(defaults.searchParams.get('provider')).toBe('github')

  const explicit = new URL(authorizeUrl({
    supabaseUrl: 'https://auth.example.invalid',
    redirectUri: 'postall://auth/callback',
    challenge: 'challenge',
    provider: 'gitlab',
  }))
  expect(explicit.searchParams.get('provider')).toBe('gitlab')
})
```

```dart
expect(url.queryParameters['provider'], 'github');
expect(
  authorizeUrl(
    supabaseUrl: 'https://auth.example.invalid',
    redirectUri: 'postall://auth/callback',
    challenge: 'challenge',
    provider: 'gitlab',
  ).queryParameters['provider'],
  'gitlab',
);
```

- [x] **Step 2: Run both focused tests and confirm `provider` is absent**

Run: `cd frontend && npm test -- src/auth/pkce.test.ts`

Run: `cd mobile && flutter test test/util_test.dart --plain-name 'authorize URL に PKCE のパラメータを載せる'`

Expected: both fail because the current builders do not add `provider`.

- [x] **Step 3: Add the compatible default provider**

```ts
export function authorizeUrl(input: {
  supabaseUrl: string
  redirectUri: string
  challenge: string
  provider?: string
}): string {
  const url = new URL(`${input.supabaseUrl.replace(/\/$/, '')}/auth/v1/authorize`)
  url.searchParams.set('provider', input.provider ?? 'github')
  url.searchParams.set('redirect_to', input.redirectUri)
  url.searchParams.set('code_challenge', input.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}
```

```dart
Uri authorizeUrl({
  required String supabaseUrl,
  required String redirectUri,
  required String challenge,
  String provider = 'github',
}) => Uri.parse('${_trimBase(supabaseUrl)}/auth/v1/authorize').replace(
  queryParameters: {
    'provider': provider,
    'redirect_to': redirectUri,
    'code_challenge': challenge,
    'code_challenge_method': 'S256',
  },
);
```

- [x] **Step 4: Disable signup and configure local GitHub OAuth**

```toml
[auth]
enable_signup = false

[auth.email]
enable_signup = false

[auth.external.github]
enabled = true
client_id = "env(SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID)"
secret = "env(SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET)"
redirect_uri = ""
url = ""
skip_nonce_check = false
email_optional = false
```

Add empty example values for `SUPABASE_AUTH_EXTERNAL_GITHUB_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GITHUB_SECRET`. Document the GitHub OAuth callback, the Supabase Dashboard provider setup, and creation of a confirmed existing user whose email exactly matches the verified GitHub email before first sign-in.

- [x] **Step 5: Re-run focused tests and validate the Supabase config**

Run: `cd frontend && npm test -- src/auth/pkce.test.ts`

Run: `cd mobile && flutter test test/util_test.dart --plain-name 'authorize URL に PKCE のパラメータを載せる'`

Run: `supabase config push --dry-run` only if the installed CLI supports a non-mutating dry run; otherwise validate through `supabase start` configuration parsing during final verification.

Expected: URL tests pass and no existing builder call needs modification.

### Task 2: Web fresh-token Realtime retry and production test-hook removal

**Files:**
- Create: `frontend/src/auth/session.test.ts`
- Modify: `frontend/src/auth/session.ts`
- Modify: `frontend/src/lib/realtime.ts`
- Modify: `frontend/src/hooks/useChangeSync.ts`
- Modify: `frontend/src/hooks/useChangeSync.test.tsx`

**Interfaces:**
- Consumes: `PlatformAdapter`, stored `TokenSet`, `refreshTokens`, and `subscribePostallEvents`.
- Produces: `accessTokenForRequest(platform: PlatformAdapter): Promise<string | null>`; `subscribePostallEvents` retains `accessToken` and additionally accepts `getAccessToken?: () => Promise<string | null>`.

- [x] **Step 1: Add failing session and reconnect tests**

```ts
it('shares one refresh and returns the refreshed token to concurrent callers', async () => {
  rememberTokens({ accessToken: 'expired', refreshToken: 'refresh', expiresAt: 0 })
  mocks.refreshTokens.mockResolvedValue({ accessToken: 'fresh', expiresAt: Date.now() + 3_600_000 })
  const [first, second] = await Promise.all([
    accessTokenForRequest(platform),
    accessTokenForRequest(platform),
  ])
  expect([first, second]).toEqual(['fresh', 'fresh'])
  expect(mocks.refreshTokens).toHaveBeenCalledTimes(1)
})
```

```ts
it('polls while degraded and reconnects with a fresh token after backoff', async () => {
  vi.useFakeTimers()
  mocks.autoSubscribe = false
  renderHook(() => useChangeSync(true), { wrapper: wrapper(queryClient) })
  mocks.onStatus?.(false)
  expect(useUi.getState().connectionState).toBe('degraded')
  await vi.advanceTimersByTimeAsync(1_000)
  expect(mocks.subscribeCalls).toBe(2)
  expect(mocks.getAccessToken).toHaveBeenCalledTimes(2)
})
```

- [x] **Step 2: Run focused tests and confirm missing refresh sharing/retry behavior**

Run: `cd frontend && npm test -- src/auth/session.test.ts src/hooks/useChangeSync.test.tsx`

Expected: new tests fail because the hook passes a fixed token and never schedules a new subscription.

- [x] **Step 3: Extract the existing refresh path with concurrency protection**

```ts
let refreshInFlight: Promise<string | null> | null = null

export async function accessTokenForRequest(platform: PlatformAdapter): Promise<string | null> {
  const cur = tokens
  if (!cur) return null
  if (cur.expiresAt - Date.now() > 60_000) return cur.accessToken
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = refreshAccessToken(platform, cur).finally(() => {
    refreshInFlight = null
  })
  return refreshInFlight
}
```

Move the current `createApiClient` refresh body into the private `refreshAccessToken` helper, keep `currentAccessToken()` unchanged, and pass `() => accessTokenForRequest(platform)` to `ApiClient`.

- [x] **Step 4: Let Supabase obtain the current token on every join/rejoin**

```ts
export function subscribePostallEvents(input: {
  supabaseUrl: string
  publishableKey: string
  accessToken?: string
  getAccessToken?: () => Promise<string | null>
  onSignal: () => void
  onStatus: (subscribed: boolean) => void
}): () => void {
  const getAccessToken = input.getAccessToken ?? (async () => input.accessToken ?? null)
  const client = createClient(input.supabaseUrl, input.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    accessToken: getAccessToken,
  })
  // private postall:events broadcast subscription remains unchanged
}
```

Keep the old fixed `accessToken` argument working. Configuration absence still calls `onStatus(false)` and returns a no-op unsubscribe function.

- [x] **Step 5: Add bounded exponential reconnect while polling remains active**

```ts
const realtimeRetryBase = 1_000
const realtimeRetryMax = 30_000
const retryDelay = (attempt: number) =>
  Math.min(realtimeRetryBase * 2 ** attempt, realtimeRetryMax)
```

Track a retry timer, attempt count, and connection generation in the effect. On a current-generation failure, set `degraded`, start the existing 15-second poller, recover once, and schedule `connectRealtime()` after `retryDelay(attempt++)`. On subscribe, clear retry state and polling; on offline/unmount, cancel both timers and invalidate stale callbacks.

- [x] **Step 6: Gate the E2E-only signal listener**

```ts
const mockSignalsEnabled = import.meta.env.DEV || import.meta.env.MODE === 'test'
if (mockSignalsEnabled) window.addEventListener('postall:change-signal', onMockSignal)
// cleanup uses the same guard
```

This retains Vitest and Vite development E2E behavior. Vite constant-folding removes the listener branch from a production build.

- [x] **Step 7: Re-run Web tests and inspect the production bundle**

Run: `cd frontend && npm test -- src/auth/session.test.ts src/hooks/useChangeSync.test.tsx`

Run: `cd frontend && npm run build`

Run: `rg -n 'postall:change-signal' frontend/dist`

Expected: focused tests pass; the final command returns no match.

### Task 3: Mobile fresh-token retry and truthful degraded state

**Files:**
- Modify: `mobile/lib/realtime.dart`
- Modify: `mobile/lib/api/postall_api.dart`
- Modify: `mobile/lib/api/http_postall_api.dart`
- Modify: `mobile/lib/state/sync.dart`
- Modify: `mobile/test/support/fake_api.dart`
- Create: `mobile/test/http_postall_api_test.dart`
- Modify: `mobile/test/mobile_shell_test.dart`

**Interfaces:**
- Consumes: existing `TokenProvider` and unchanged `PostAllApi.watchChangeSignals(): Stream<void>`.
- Produces: optional `RealtimeStatusSource.watchRealtimeStatus(): Stream<bool>` capability; `PostallRealtime` keeps the fixed `accessToken` constructor input and additionally accepts `accessTokenProvider`.

- [x] **Step 1: Add failing retry/token and degraded-state tests**

```dart
test('reconnect obtains a fresh token while polling remains available', () async {
  final tokens = <String>[];
  var tokenNumber = 0;
  var connections = 0;
  final api = HttpPostAllApi(
    baseUrl: () => 'https://api.example.invalid',
    token: () async => 'token-${++tokenNumber}',
    supabaseUrl: () => 'https://auth.example.invalid',
    publishableKey: () => 'publishable',
    realtimeRetryDelay: (_) => Duration.zero,
    realtimeFactory: ({required accessToken, required onSignal, required onStatus}) {
      connections++;
      return FakeRealtimeConnection(() async {
        tokens.add((await accessToken())!);
        onStatus(connections > 1);
      });
    },
  );
  final subscription = api.watchChangeSignals().listen((_) {});
  await waitUntil(() => connections == 2);
  expect(tokens, ['token-1', 'token-2']);
  await subscription.cancel();
})
```

Add a widget assertion after setting `api.streamConnected = false` and pumping a polled signal:

```dart
expect(container.read(connectionProvider), BackendConnection.degraded);
```

- [x] **Step 2: Run focused Flutter tests and confirm failure**

Run: `cd mobile && flutter test test/http_postall_api_test.dart test/mobile_shell_test.dart`

Expected: the reconnect test cannot compile before the compatible factory/status additions, and the shell reports online after a polling signal.

- [x] **Step 3: Add dynamic token support without removing fixed-token construction**

```dart
PostallRealtime({
  required this.supabaseUrl,
  required this.publishableKey,
  String accessToken = '',
  Future<String?> Function()? accessTokenProvider,
  required this.onSignal,
  required this.onStatus,
})  : accessToken = accessToken,
      _accessTokenProvider = accessTokenProvider ?? (() async => accessToken);
```

Before subscribing, await `_accessTokenProvider`, reject an empty result through `onStatus(false)`, initialize `SupabaseClient(accessToken: _accessTokenProvider)`, and call `realtime.setAuth(initialToken)`. Use a generation counter so a late asynchronous connect cannot resurrect a disconnected client.

- [x] **Step 4: Add the optional connection-status capability**

```dart
abstract interface class RealtimeStatusSource {
  Stream<bool> watchRealtimeStatus();
}
```

Implement it on `HttpPostAllApi` and the test `FakeApi`. The status stream first yields the current state, then broadcasts transitions. Preserve the existing `PostAllApi` interface and every existing implementer.

- [x] **Step 5: Retry Realtime independently from the 15-second poller**

```dart
Duration defaultRealtimeRetryDelay(int attempt) {
  final seconds = 1 << attempt.clamp(0, 4);
  return Duration(seconds: seconds > 30 ? 30 : seconds);
}
```

In `watchChangeSignals`, use connection generations to ignore callbacks from disposed connections. On failure, emit `false` status, keep/start polling, and schedule a fresh `PostallRealtime` after the delay. On subscribe, emit `true`, reset attempts, cancel retry and polling, then signal immediate recovery. Cancellation stops polling, retry, and the current Realtime client.

- [x] **Step 6: Keep polling signals from changing degraded to online**

Subscribe to `RealtimeStatusSource` before `watchChangeSignals`. Store the most recent Realtime state; only set `BackendConnection.online` from a change signal when that state is not explicitly false. A false status always sets `degraded`; a true status sets `online`. Cancel both subscriptions in `dispose` and reconnect paths.

- [x] **Step 7: Re-run focused mobile coverage**

Run: `cd mobile && dart format lib/realtime.dart lib/api/postall_api.dart lib/api/http_postall_api.dart lib/state/sync.dart test/support/fake_api.dart test/http_postall_api_test.dart test/mobile_shell_test.dart`

Run: `cd mobile && flutter test test/http_postall_api_test.dart test/mobile_shell_test.dart`

Expected: retry obtains two distinct tokens and a polling signal leaves the UI degraded.

### Task 4: Realtime SQL safety and PGroonga rollback/index coverage

**Files:**
- Create: `backend/migrations/migrations_test.go`
- Modify: `backend/migrations/00008_pgroonga.sql`
- Modify: `backend/migrations/00011_realtime_rls.sql`
- Modify: `backend/migrations/00012_realtime_notify_best_effort.sql`
- Modify: `backend/internal/search/schema_integration_test.go`
- Modify: `README.md`

**Interfaces:**
- Consumes: goose embedded migrations, `search.ContainsPattern`, and the `realtime.messages` schema.
- Produces: a topic- and extension-scoped authenticated SELECT policy; warning-level best-effort failures; rollback that restores `pg_bigm` before removing PGroonga.

- [x] **Step 1: Add failing migration contract tests**

```go
func TestRealtimePolicyIsTopicAndExtensionScoped(t *testing.T) {
	contents := migration(t, "00011_realtime_rls.sql")
	for _, required := range []string{
		"realtime.topic() = 'postall:events'",
		"extension = 'broadcast'",
	} {
		if !strings.Contains(contents, required) { t.Errorf("missing %q", required) }
	}
	if strings.Contains(contents, "using (true)") { t.Fatal("unscoped policy") }
}

func TestBestEffortNotificationIsObservable(t *testing.T) {
	contents := migration(t, "00012_realtime_notify_best_effort.sql")
	if !strings.Contains(contents, "raise warning") || !strings.Contains(contents, "sqlstate") {
		t.Fatal("notification errors are still silent")
	}
}

func TestPGroongaDownRestoresBigmBeforeDroppingPGroonga(t *testing.T) {
	contents := migration(t, "00008_pgroonga.sql")
	assertOrdered(t, contents, "-- +goose Down", "create extension if not exists pg_bigm", "create index posts_body_bigm", "drop index if exists posts_body_pgroonga")
}
```

- [x] **Step 2: Strengthen the PGroonga integration test before SQL changes**

Use one acquired pgx connection. For each query in `[]string{"都庁", "hello", "a%b", "b_c", `c\\d`}`, set `enable_seqscan = off`, run `EXPLAIN`, assert the output names `posts_body_pgroonga`, and capture results. Drop the index, reset `enable_seqscan`, capture plain `ILIKE` results, compare, and recreate the index before the next case.

- [x] **Step 3: Run migration unit tests and the focused integration test**

Run: `cd backend && go test ./migrations -count=1`

Run: `cd backend && go test ./internal/search -run 'TestPGroongaIndexMatchesPlainLike' -count=1`

Expected: migration tests fail on the current broad/silent/unsafe SQL; the search test fails because current coverage does not assert the plan or literal `_` and backslash cases.

- [x] **Step 4: Scope RLS and surface notification failures**

```sql
create policy postall_events_select
    on realtime.messages
    for select
    to authenticated
    using (
        realtime.topic() = 'postall:events'
        and extension = 'broadcast'
    );
```

```sql
exception
    when others then
        raise warning 'postall realtime notification failed (SQLSTATE %): %', sqlstate, sqlerrm;
```

Keep `return new` after the inner exception so writes succeed. Update the README manual SQL to the exact same predicate.

- [x] **Step 5: Make 00008 Down transactional-safe by restoring the old index first**

```sql
-- +goose Down
create extension if not exists pg_bigm;
create index posts_body_bigm
    on posts using gin (lower(body) gin_bigm_ops);

drop index if exists posts_body_pgroonga;
drop extension if exists pgroonga;
```

On Supabase, unavailable `pg_bigm` aborts the goose transaction before PGroonga is removed, avoiding an index-free partial rollback.

- [x] **Step 6: Re-run database tests**

Run: `cd backend && gofmt -w migrations/migrations_test.go internal/search/schema_integration_test.go`

Run: `cd backend && go test ./migrations -count=1`

Run: `cd backend && go test ./internal/search -run 'TestSearchMatchesJapaneseSubstringAndLiterals|TestPGroongaIndexMatchesPlainLike' -count=1`

Expected: migration contracts and forced-index semantic comparisons pass.

### Task 5: Emoji Storage recovery and safe redirect caching

**Files:**
- Modify: `backend/internal/emoji/sync_integration_test.go`
- Modify: `backend/internal/emoji/service.go`
- Modify: `backend/internal/httpapi/emoji_reactions_integration_test.go`
- Modify: `backend/internal/httpapi/emojis.go`

**Interfaces:**
- Consumes: existing `blob.Store.Head`, `blob.Store.Put`, checksum records, and five-minute `PresignGet` URLs.
- Produces: missing-object self-healing and `private, max-age=60` redirect/304 responses after object existence is verified.

- [x] **Step 1: Change the existing missing-object sync test to require repair**

```go
third, err := service.Sync(context.Background(), dir, objects)
if err != nil { t.Fatal(err) }
if third.Updated != 1 || third.Unchanged != 1 {
	t.Fatalf("third sync = %+v", third)
}
if !objects.Has("shipit.png") {
	t.Fatal("missing unchanged object was not repaired")
}
```

- [x] **Step 2: Add the stale-ETag/missing-object and cache-duration HTTP assertions**

```go
if got := rec.Header().Get("Cache-Control"); got != "private, max-age=60" {
	t.Fatalf("cache-control = %q", got)
}

missingCached := httptest.NewRequest(http.MethodGet, "/v1/emojis/missing/image", nil)
missingCached.Header.Set("Authorization", authz)
missingCached.Header.Set("If-None-Match", `"sum-2"`)
missingCachedRec := httptest.NewRecorder()
h.ServeHTTP(missingCachedRec, missingCached)
if missingCachedRec.Code != http.StatusNotFound {
	t.Fatalf("missing cached image = %d", missingCachedRec.Code)
}
```

- [x] **Step 3: Run focused tests and confirm both regressions**

Run: `cd backend && go test ./internal/emoji -run TestSyncRegistersUpdatesAndSkipsInvalidFiles -count=1`

Run: `cd backend && go test ./internal/httpapi -run TestEmoji -count=1`

Expected: sync still counts the missing object unchanged and the matching ETag returns 304 before `Head`.

- [x] **Step 4: Repair an unchanged catalog entry when Storage is empty**

```go
case existing.Checksum == checksum && existing.StorageKey == name:
	exists := true
	if objects != nil {
		exists, _, err = objects.Head(ctx, name)
		if err != nil { return result, fmt.Errorf("head emoji %s: %w", shortcode, err) }
	}
	if exists {
		result.Unchanged++
		break
	}
	if err := putEmojiObject(ctx, objects, path, name); err != nil {
		return result, fmt.Errorf("repair emoji %s: %w", shortcode, err)
	}
	result.Updated++
```

- [x] **Step 5: Verify Storage before honoring ETag and shorten cache lifetime**

Set `Cache-Control: private, max-age=60`, perform `emojiBlobs.Head` immediately after loading the DB row, return 404 if absent, and only then compare `If-None-Match`. Preserve authentication, ETag, and 302 response behavior.

- [x] **Step 6: Re-run focused tests**

Run: `cd backend && gofmt -w internal/emoji/service.go internal/emoji/sync_integration_test.go internal/httpapi/emojis.go internal/httpapi/emoji_reactions_integration_test.go`

Run: `cd backend && go test ./internal/emoji ./internal/httpapi -run 'TestSyncRegistersUpdatesAndSkipsInvalidFiles|TestEmoji' -count=1`

Expected: a restored DB repairs missing Storage and a stale cache validator cannot hide the missing object.

### Task 6: Encrypted, bounded, zero-overage database artifacts

**Files:**
- Modify: `.github/workflows/ops.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: `DATABASE_URL` and new repository secret `DUMP_PASSPHRASE`.
- Produces: only `postall.dump.sql.gz.gpg`, retained 30 days and rejected above 10 MiB.

- [x] **Step 1: Record the expected workflow security contract before editing**

The dump step must contain all of these literal controls, which will be checked after the edit:

```text
gzip
gpg --symmetric --cipher-algo AES256
DUMP_PASSPHRASE
10 * 1024 * 1024
postall.dump.sql.gz.gpg
retention-days: 30
compression-level: 0
```

The upload step must not reference `postall.dump.sql` or `postall.dump.sql.gz`.

- [x] **Step 2: Replace plaintext upload with cleanup, compression, encryption, and a hard cap**

```yaml
- name: Dump and encrypt database
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
    DUMP_PASSPHRASE: ${{ secrets.DUMP_PASSPHRASE }}
  run: |
    set -euo pipefail
    plain="$RUNNER_TEMP/postall.dump.sql"
    compressed="$RUNNER_TEMP/postall.dump.sql.gz"
    encrypted="$GITHUB_WORKSPACE/postall.dump.sql.gz.gpg"
    trap 'rm -f "$plain" "$compressed"' EXIT
    : "${DUMP_PASSPHRASE:?DUMP_PASSPHRASE secret is required}"
    supabase db dump --db-url "$DATABASE_URL" -f "$plain"
    gzip -9 -c "$plain" > "$compressed"
    printf '%s' "$DUMP_PASSPHRASE" | gpg \
      --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
      --symmetric --cipher-algo AES256 \
      --output "$encrypted" "$compressed"
    max_bytes=$((10 * 1024 * 1024))
    actual_bytes=$(stat -c '%s' "$encrypted")
    if (( actual_bytes > max_bytes )); then
      echo "Encrypted dump is ${actual_bytes} bytes; maximum is ${max_bytes}." >&2
      rm -f "$encrypted"
      exit 1
    fi
```

```yaml
- uses: actions/upload-artifact@v4
  with:
    name: postall-db-dump-${{ github.run_id }}
    path: postall.dump.sql.gz.gpg
    if-no-files-found: error
    retention-days: 30
    compression-level: 0
```

- [x] **Step 3: Document secret setup, zero-dollar budget, and recovery**

Add commands that decrypt and decompress without writing a plaintext artifact into the repository:

```bash
gpg --output postall.dump.sql.gz --decrypt postall.dump.sql.gz.gpg
gzip --decompress postall.dump.sql.gz
```

Document that repository Settings must contain a strong `DUMP_PASSPHRASE`; account Billing → Budgets and alerts must set Actions storage budget to `$0` and stop usage at the limit; a missing secret, 10 MiB overflow, or exhausted free quota is intentionally a failed backup job rather than a paid overage.

- [x] **Step 4: Validate the workflow contract without running production jobs**

Run: `rg -n 'postall\.dump\.sql($|[^.]|\.gz($|[^.]?))' .github/workflows/ops.yml`

Expected: plaintext names appear only in local runner variables/dump/compression commands, never as `upload-artifact.path`.

Run: `rg -n 'AES256|DUMP_PASSPHRASE|10 \* 1024 \* 1024|retention-days: 30|compression-level: 0' .github/workflows/ops.yml`

Expected: every control is present. Do not dispatch the workflow because the repository currently has no configured Actions secrets.

### Task 7: Full verification and OpenSpec completion

**Files:**
- Modify: `openspec/changes/vercel-supabase-migration/tasks.md`
- Review: every file changed by Tasks 1–6.

**Interfaces:**
- Consumes: all focused deliverables above.
- Produces: verified section 15 task state and a user-facing risk report.

- [x] **Step 1: Mark OpenSpec items complete as their implementations pass**

Map deliverables exactly:

```text
15.1 -> Task 6
15.2, 15.3 -> Task 1
15.4, 15.5 -> Tasks 2 and 3
15.6, 15.7 -> Task 4
15.8, 15.9 -> Task 5
15.10 -> Task 2
15.11 -> final commands below
15.12 -> already complete; no external deletion or rotation was needed
```

- [x] **Step 2: Run backend verification**

Run: `cd backend && go test ./...`

Run: `cd backend && go vet ./...`

Run: `cd backend && go build ./...`

Expected: all pass. If Docker is unavailable, separately report the skipped testcontainers-backed packages; do not describe them as passing.

- [x] **Step 3: Run frontend verification**

Run: `cd frontend && npm test`

Run: `cd frontend && npm run typecheck`

Run: `cd frontend && npm run lint`

Run: `cd frontend && npm run build`

Expected: all pass, and the production bundle contains no `postall:change-signal` string.

- [x] **Step 4: Run mobile verification**

Run: `cd mobile && flutter test`

Run: `cd mobile && flutter analyze`

Expected: all pass with no analyzer findings.

- [x] **Step 5: Validate specs and the final diff**

Run: `openspec validate vercel-supabase-migration --strict`

Run: `git diff --check`

Run: `git status --short`

Run: `git diff --stat`

Search the plan for forbidden placeholders:

Run: `rg -n -e 'TB[D]' -e 'TO[D]O' -e 'implement lat[e]r' -e 'fill in detail[s]' -e 'Similar to Tas[k]' docs/superpowers/plans/2026-08-27-pr-2-review-fixes.md`

Expected: OpenSpec and whitespace checks pass; placeholder search returns no matches; changed files are limited to the approved review-fix scope.

- [x] **Step 6: Review compatibility and report risks**

Confirm existing fixed-token callers still compile, `PostAllApi.watchChangeSignals` is unchanged, API/OpenAPI schemas are untouched, writes survive Realtime failures, and no plaintext dump path is uploaded. Report exact verification results and these operational risks: GitHub OAuth/Dashboard configuration and `DUMP_PASSPHRASE` remain manual, `$0` budget is account-level, encrypted artifacts do not include Supabase Storage, and Realtime failures intentionally degrade to polling.
