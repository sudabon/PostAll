# PR #1 Review Fixes Implementation Plan

> Execute this plan inline with `superpowers:executing-plans`; preserve public compatibility and verify each behavior before moving on.

**Goal:** Fix all twelve actionable PR #1 review findings with focused regression coverage.

**Architecture:** Keep durable state in PostgreSQL, introduce one internal LISTEN fanout broker, make compound writes transactional, and treat SSE notifications as wake-up hints. Add only compatible client request fields and an SSE sentinel that existing `ChangeEvent` decoders accept.

**Stack:** Go/pgx/sqlc/PostgreSQL, React/TypeScript/TanStack Query/Vitest/Playwright, Flutter/Riverpod.

---

## Task 1: Bound JWT key refresh work

**Files:**
- Modify: `backend/internal/auth/verifier.go`
- Modify: `backend/internal/auth/verifier_test.go`
- Modify: `backend/go.mod`, `backend/go.sum` if `x/sync` becomes direct

1. Add tests proving concurrent requests for one unknown `kid` perform one JWKS refresh, repeated misses within the cooldown do not refetch, the negative cache remains bounded, and a rotated key returned by refresh verifies successfully.
2. Run `go test ./internal/auth -run 'TestVerifier' -count=1` and confirm the new tests fail for repeated/concurrent refreshes.
3. Add a private `singleflight.Group`, a bounded expiring miss cache, and injectable clock/durations for package tests. Only cache a miss after a successful refresh that still lacks the requested key.
4. Re-run the focused tests and `go test -race ./internal/auth`.

## Task 2: Make post edits atomic

**Files:**
- Modify: `backend/internal/post/service.go`
- Modify: `backend/internal/httpapi/posts_integration_test.go`

1. Add an integration test that edits a post using one valid and one invalid attachment ID and asserts both the original body and original attachments remain.
2. Run the focused test and confirm the body currently changes before the attachment error.
3. When `attachmentIds` is present, begin a pgx transaction, use `Queries.WithTx`, perform body update and attachment replacement, and commit only after both succeed. Preserve the existing body-only path.
4. Re-run the focused test and post package tests.

## Task 3: Make attachment cleanup durable and channel deletion safe

**Files:**
- Create: `backend/migrations/00007_attachment_cleanup.sql`
- Modify: `backend/internal/store/schema.sql`
- Modify: `backend/internal/store/queries/attachments.sql`
- Regenerate: `backend/internal/store/attachments.sql.go`
- Modify: `backend/internal/attachment/service.go`
- Modify: `backend/internal/httpapi/attachments_integration_test.go`
- Modify: `backend/internal/httpapi/integration_test.go`

1. Add a retry test with a blob store that fails its first delete; assert the row retains its storage key, pending timestamp, attempt count, and error, then disappears after a successful retry.
2. Add a test that soft-deletes a post with an attachment, deletes its channel, and asserts success plus a pending detached attachment.
3. Run both tests and confirm the old delete-before-object/FK behavior fails.
4. Add durable cleanup columns. Replace the attachment-to-post delete restriction with `ON DELETE SET NULL` and a `BEFORE DELETE` post trigger that atomically marks/detaches attachments.
5. Replace reaper queries with mark-eligible, list-pending, record-failure, and delete-after-success operations; run `make sqlc`.
6. Update the reaper to retain/record failed objects, return joined errors, and delete rows only after object deletion succeeds.
7. Re-run focused tests, migration/schema tests, and `go test ./internal/attachment ./internal/httpapi`.

## Task 4: Share one SSE listener and close the initial race

**Files:**
- Create: `backend/internal/httpapi/event_broker.go`
- Modify: `backend/internal/httpapi/events.go`
- Modify: `backend/internal/httpapi/server.go`
- Modify: `backend/internal/httpapi/events_integration_test.go`

1. Add tests that multiple open streams work with `pool_max_conns=2` while a normal API query completes, that an event committed after subscription readiness is delivered, and that a stream without a cursor first receives `event: postall.sync` at the durable watermark.
2. Run focused tests and confirm per-stream `Acquire` exhausts the pool and no sync frame exists.
3. Implement a lazy process-owned broker that completes `LISTEN` before subscriptions become ready and fans non-blocking wake signals to subscribers. Release/reconnect safely and use heartbeat polling as recovery.
4. Subscribe before selecting the initial cursor. Preserve cursor replay; for a new stream emit a valid nil-entity `ChangeEvent` as a named `postall.sync` frame.
5. Re-run focused tests and existing replay/order tests.

## Task 5: Log unexpected server and reaper failures safely

**Files:**
- Modify: `backend/internal/httpapi/server.go`
- Modify: `backend/internal/httpapi/channels.go`
- Modify: `backend/internal/httpapi/posts.go`
- Modify: `backend/internal/httpapi/attachments.go`
- Modify: `backend/internal/httpapi/events.go`
- Modify: other `writeAppError` callers under `backend/internal/httpapi`
- Modify: `backend/internal/httpapi/server_test.go`

1. Add a test that passes a sentinel unexpected error through the central helper and asserts the response is unchanged, the log includes request ID/method/path/error, and it excludes authorization/query secrets. Assert typed application errors do not emit unexpected-error logs.
2. Run the focused test and confirm no diagnostic log exists.
3. Add request-ID middleware/context helpers and change internal error writers to accept the request and log only unexpected errors with safe fields.
4. Log non-nil reaper errors from the existing background loop.
5. Update all call sites, run `go test ./internal/httpapi`, and run `go vet ./...`.

## Task 6: Preserve browser PKCE state

**Files:**
- Modify: `frontend/src/auth/AuthProvider.tsx`
- Modify: the existing auth Playwright spec under `frontend/e2e`

1. Add a browser test that routes the Cognito authorize request back to `/auth/callback`, captures the token request, and asserts one page is used and `code_verifier` is present.
2. Run that Playwright test and confirm the noopener tab loses the verifier.
3. Navigate the current window for browser sign-in; retain `platform.openExternal` for native shells and ordinary external links.
4. Re-run the focused E2E test.

## Task 7: Apply sync watermarks in Web and Flutter

**Files:**
- Modify: `frontend/src/hooks/useChangeSync.ts`
- Modify: `frontend/src/hooks/useChangeSync.test.tsx`
- Modify: `mobile/lib/api/change_events.dart`
- Modify: relevant state/provider tests in `mobile/test`

1. Add Web and Flutter tests that start with stale displayed data, deliver the sync sentinel, and assert channels plus the currently visible timeline/thread reload.
2. Run both focused tests and confirm the sentinel currently does not establish the barrier.
3. On Web, detect the named SSE event and invalidate channels/posts/thread after advancing the cursor.
4. On Flutter, detect the compatible nil-entity sentinel and reload channels, selected timeline, and open thread without changing generated models.
5. Re-run focused client tests.

## Task 8: Make Composer uploads exactly once

**Files:**
- Modify: `frontend/src/components/composer/Composer.tsx`
- Modify: `frontend/src/components/composer/Composer.test.tsx`

1. Add a StrictMode test that selects one file and asserts one upload call.
2. Run it and confirm the state-updater side effect can execute twice.
3. Build accepted draft records and upload commands in the input event handler, commit state once through an authoritative ref/helper, and start each command once outside any state updater.
4. Re-run Composer tests, lint, and typecheck.

## Task 9: Add complete Web post actions and attachment editing

**Files:**
- Create: `frontend/src/components/post/PostActions.tsx`
- Modify: `frontend/src/components/timeline/Timeline.tsx`
- Modify: `frontend/src/components/thread/ThreadPanel.tsx`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/api/client.test.ts`
- Modify: the relevant post mutation hook
- Modify: Web unit/E2E post specs

1. Add API tests proving body-only edits omit `attachmentIds` and selected edits include them.
2. Add UI/E2E coverage that edits a reply, removes one existing attachment, deletes the reply, and observes the updated thread/reply count.
3. Run focused tests and confirm thread replies lack controls and attachment IDs are omitted.
4. Add an accessible shared actions component/edit dialog with an initially selected attachment checklist. Keep an attachment-only post valid; reject an edit with neither body nor retained attachment.
5. Reuse it for timeline posts and thread replies; pass optional IDs through the API/mutation layer and invalidate both timeline and thread queries.
6. Re-run unit tests, lint, typecheck, and focused Playwright coverage.

## Task 10: Add iOS attachment removal and safe Mermaid transport

**Files:**
- Modify: `mobile/lib/state/post_actions.dart`
- Modify: `mobile/lib/ui/screens/post_edit_dialog.dart`
- Modify: `mobile/lib/ui/widgets/mermaid_view.dart`
- Create or modify a focused Mermaid document helper under `mobile/lib/util`
- Modify: `mobile/test/features_test.dart`
- Modify: `mobile/test/util_test.dart`
- Modify: `mobile/test/support/fake_api.dart`

1. Add a widget test that opens edit for a post with two attachments, deselects one, saves, and asserts the fake API receives the remaining ID.
2. Add a document-generation test with `</script>`, `<`, U+2028, and U+2029; assert source cannot add a script node and base64 decodes to the exact source.
3. Run focused tests and confirm attachment IDs are dropped and hostile source is embedded literally.
4. Add an optional named attachment-ID parameter to the app-internal action, build a stateful checklist edit dialog, and preserve existing callers.
5. Encode Mermaid source as UTF-8 base64 and decode via `TextDecoder` in the WebView script.
6. Re-run Flutter tests and `flutter analyze`.

## Task 11: Full verification and review

1. Run `make sqlc` and confirm a second run produces no diff.
2. Run `go test ./...`, `go test -race ./internal/auth`, and `go vet ./...` in `backend` with Docker available.
3. Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run test:e2e` in `frontend`.
4. Run `flutter test` and `flutter analyze` in `mobile`.
5. Run `git diff --check`, inspect `git status --short`, and review every changed file against the twelve findings and backward-compatibility constraints.
6. Report exact checks, any environmental limitations, and remaining risks; do not commit or push unless explicitly requested.
