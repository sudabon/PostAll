# M7 Full-Text Search and Change Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement OpenSpec M7 tasks 8.1–8.15: Japanese full-text search, source-post navigation, durable SSE change notifications, replay/diff recovery, and online-only mutation guards.

**Architecture:** PostgreSQL remains the source of truth. Search uses a `pg_bigm` GIN expression index and keyset pagination; durable change rows are written by database triggers in the same transaction as channel/post/reaction mutations and wake SSE listeners through `pg_notify`. React consumes additive OpenAPI endpoints, uses an authenticated Fetch stream instead of native `EventSource`, and refreshes active TanStack Query data from event identifiers.

**Tech Stack:** Go 1.26, PostgreSQL 16 + `pg_bigm`, pgx/sqlc, oapi-codegen, React 19, TypeScript 6, TanStack Query 5, Zustand, Vitest/Testing Library, Playwright, Nginx, Docker Compose.

**Spec:** `openspec/changes/slack-style-memo-app/design.md`, `openspec/changes/slack-style-memo-app/specs/full-text-search/spec.md`, `openspec/changes/slack-style-memo-app/specs/sync-and-storage/spec.md`, and M7 section of `openspec/changes/slack-style-memo-app/tasks.md`.

## Global Constraints

- Keep every existing API behavior backward compatible; all HTTP contract changes are additive.
- Search requires at least 2 Unicode code points and never returns logically deleted posts.
- Search includes thread replies and identifies both the reply and its root timeline post.
- Event IDs are monotonic decimal strings at the HTTP boundary so JavaScript precision cannot truncate PostgreSQL `bigint` values.
- Bearer tokens stay in the `Authorization` header; never place them in an SSE query string.
- Clients do not queue offline mutations; drafts remain editable and persisted during connection loss.
- Render excerpts as React text and `<mark>` nodes; never inject search content with `innerHTML`.
- Use native `<dialog>`, `<search>`, visible labels, Escape dismissal, and programmatic focus for accessible search navigation.
- Existing M0–M6 files are uncommitted dependencies in the shared feature branch, so this plan records verification checkpoints without creating partial commits.

---

### Task 1: Real `pg_bigm` test database and search schema

**Files:**
- Create: `backend/migrations/00006_search_events.sql`
- Modify: `backend/internal/store/schema.sql`
- Modify: `backend/internal/testutil/postgres.go`
- Test: `backend/internal/search/schema_integration_test.go`

**Interfaces:**
- Produces: `posts_body_bigm` GIN index on `lower(body)`, `change_events` table, and trigger-generated event rows.
- Produces: `testutil.PostgresURL(t)` backed by the repository's `infra/postgres/Dockerfile` image.

- [ ] **Step 1: Write the failing schema integration test**

```go
func TestSearchAndEventSchema(t *testing.T) {
    dbURL := testutil.PostgresURL(t)
    pool, err := pgxpool.New(context.Background(), dbURL)
    if err != nil { t.Fatal(err) }
    defer pool.Close()

    var extension string
    if err := pool.QueryRow(context.Background(),
        `select extname from pg_extension where extname = 'pg_bigm'`,
    ).Scan(&extension); err != nil { t.Fatal(err) }
    if extension != "pg_bigm" { t.Fatalf("extension=%q", extension) }

    var index string
    if err := pool.QueryRow(context.Background(),
        `select indexname from pg_indexes where indexname = 'posts_body_bigm'`,
    ).Scan(&index); err != nil { t.Fatal(err) }
}
```

- [ ] **Step 2: Run the focused test and confirm it fails because vanilla test PostgreSQL lacks `pg_bigm`**

Run: `cd backend && go test ./internal/search -run TestSearchAndEventSchema -count=1`

Expected: FAIL before the local Dockerfile-backed test container and migration exist.

- [ ] **Step 3: Build test containers from the repository PostgreSQL Dockerfile**

Use `runtime.Caller` to derive the repository root independent of each Go package's working directory, then pass:

```go
testcontainers.WithDockerfile(testcontainers.FromDockerfile{
    Context:    filepath.Join(repoRoot, "infra", "postgres"),
    Dockerfile: "Dockerfile",
    Repo:       "postall-postgres-test",
    Tag:        "16-bigm",
    KeepImage:  true,
})
```

to `postgres.Run`, retaining the existing database/user/password and readiness strategy.

- [ ] **Step 4: Add the migration and sqlc schema mirror**

The migration creates:

```sql
create extension if not exists pg_bigm;
create index posts_body_bigm on posts using gin (lower(body) gin_bigm_ops);

create table change_events (
    id bigint generated always as identity primary key,
    event_type text not null,
    channel_id uuid,
    post_id uuid,
    thread_root_id uuid,
    created_at timestamptz not null default now()
);
create index change_events_created_at on change_events (created_at);
```

Add trigger functions for channel insert/update/delete, post insert/update, and reaction insert/delete. Each trigger inserts one normalized event row; an `AFTER INSERT ON change_events` trigger executes `pg_notify('postall_events', NEW.id::text)`. PostgreSQL delivers the notification only after commit.

- [ ] **Step 5: Run schema and existing backend tests**

Run: `cd backend && go test ./internal/search ./internal/emoji ./internal/httpapi -count=1`

Expected: PASS with migrations applied on the real `pg_bigm` image.

### Task 2: Additive search and anchored-timeline API contract

**Files:**
- Modify: `api/openapi.yaml`
- Regenerate: `backend/internal/api/openapi.gen.go`
- Regenerate: `frontend/src/api/schema.d.ts`
- Modify: `backend/internal/store/queries/posts.sql`
- Create: `backend/internal/store/queries/search.sql`
- Regenerate: `backend/internal/store/posts.sql.go`
- Create/regenerate: `backend/internal/store/search.sql.go`
- Test: `backend/internal/httpapi/search_integration_test.go`

**Interfaces:**
- Produces: `GET /v1/search?q&channelId&createdFrom&createdTo&limit&cursor`.
- Produces: optional `around` UUID on `GET /v1/channels/{channelId}/posts`.
- Produces: `SearchResultPage{results,nextCursor}` and `SearchResult{postId,timelinePostId,channelId,channelName,threadRootId,body,createdAt}`.

- [ ] **Step 1: Add failing authenticated API tests**

Create posts containing Japanese partial matches, mixed-case ASCII, a thread reply, a logically deleted match, and posts outside channel/date filters. Assert:

```go
res := doJSON(t, h, http.MethodGet, "/v1/search?q=検索語", authz, nil)
if res.Code != http.StatusOK { t.Fatalf("search=%d %s", res.Code, res.Body) }
if got.Results[0].TimelinePostId != root.Id { t.Fatalf("timeline root mismatch") }
```

Also assert one-character queries return `400 validation`, missing auth returns `401`, cursor pages do not overlap, and `?around=<root-id>` includes that root even when it is older than the normal latest ten.

- [ ] **Step 2: Run the focused tests and verify endpoint-not-found failures**

Run: `cd backend && go test ./internal/httpapi -run 'TestSearch|TestTimelineAround' -count=1`

Expected: FAIL with 404 or missing generated API methods.

- [ ] **Step 3: Extend OpenAPI and regenerate both clients**

Define query formats precisely:

```yaml
createdFrom: { type: string, format: date-time }
createdTo: { type: string, format: date-time }
limit: { type: integer, minimum: 1, maximum: 50, default: 20 }
cursor: { type: string }
around: { type: string, format: uuid }
```

Run:

```bash
cd backend && make generate && make sqlc
cd frontend && npm run generate
```

- [ ] **Step 4: Implement stable SQL queries**

Search with:

```sql
where p.deleted_at is null
  and lower(p.body) like likequery(lower(sqlc.arg('search_query')))
  and (sqlc.narg('channel_id')::uuid is null or p.channel_id = sqlc.narg('channel_id'))
  and (sqlc.narg('created_from')::timestamptz is null or p.created_at >= sqlc.narg('created_from'))
  and (sqlc.narg('created_to')::timestamptz is null or p.created_at <= sqlc.narg('created_to'))
order by p.created_at desc, p.id desc
limit sqlc.arg('row_limit');
```

Use `(created_at,id)` keyset predicates for subsequent pages. For `around`, resolve the root post and return the `limit` root timeline posts at or before its stable `(created_at,id)` key, in ascending response order.

- [ ] **Step 5: Run generation consistency and focused tests**

Run: `cd backend && make generate && make sqlc && go test ./internal/httpapi -run 'TestSearch|TestTimelineAround' -count=1`

Expected: PASS.

### Task 3: Search service, handler, excerpt model, and source navigation UI

**Files:**
- Create: `backend/internal/search/cursor.go`
- Create: `backend/internal/search/service.go`
- Create: `backend/internal/httpapi/search.go`
- Modify: `backend/internal/httpapi/server.go`
- Modify: `backend/internal/httpapi/posts.go`
- Modify: `backend/internal/post/service.go`
- Modify: `frontend/src/api/client.ts`
- Create: `frontend/src/lib/search.ts`
- Test: `frontend/src/lib/search.test.ts`
- Create: `frontend/src/hooks/useSearch.ts`
- Create: `frontend/src/components/search/SearchDialog.tsx`
- Test: `frontend/src/components/search/SearchDialog.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/state/ui.ts`
- Modify: `frontend/src/hooks/usePosts.ts`
- Modify: `frontend/src/components/timeline/Timeline.tsx`
- Modify: `frontend/src/components/thread/ThreadPanel.tsx`

**Interfaces:**
- Consumes: Task 2 generated types and endpoints.
- Produces: `buildExcerpt(body, query, radius): {parts: {text:string;match:boolean}[]; clippedStart:boolean; clippedEnd:boolean}`.
- Produces: UI state `timelineAnchorId`, `targetPostId`, and `targetThreadReplyId`.

- [ ] **Step 1: Write failing cursor and excerpt tests**

Test cursor round-trips and rejects malformed values. Test Japanese and case-insensitive excerpts:

```ts
expect(buildExcerpt('前文 日本語の検索語 後文', '検索語', 8).parts).toContainEqual({
  text: '検索語', match: true,
})
expect(buildExcerpt('Alpha BETA gamma', 'beta', 20).parts).toContainEqual({
  text: 'BETA', match: true,
})
```

- [ ] **Step 2: Run focused tests and verify missing implementations**

Run: `cd backend && go test ./internal/search -count=1`

Run: `cd frontend && npm test -- src/lib/search.test.ts`

Expected: FAIL because cursor/service and excerpt utility do not exist.

- [ ] **Step 3: Implement backend validation and HTTP mapping**

`search.Service.Search` counts Unicode code points with `utf8.RuneCountInString`, trims surrounding whitespace, enforces 2 characters, clamps limit to 50, and encodes the last returned `(created_at,id)` only when an extra row proves another page exists.

- [ ] **Step 4: Implement accessible search UI**

Use a native modal:

```tsx
<dialog ref={dialogRef} aria-labelledby="search-title" onCancel={close}>
  <h2 id="search-title">ポストを検索</h2>
  <search>
    <form onSubmit={submitSearch}>...</form>
  </search>
  <p aria-live="polite">{resultSummary}</p>
  <ol>{results.map(renderResult)}</ol>
</dialog>
```

Every search control has a visible `<label>`. Render excerpt parts as text or `<mark>` elements. Submit does not call the API below two characters and displays the exact minimum. “さらに読み込む” fetches the next cursor page.

- [ ] **Step 5: Implement source navigation**

Selecting a result closes the dialog, selects its channel, sets `timelineAnchorId = timelinePostId`, and sets `targetPostId = timelinePostId`. A reply additionally opens `threadRootId` and sets `targetThreadReplyId = postId`. Timeline/thread effects locate `[data-testid="post-<id>"]`, call `scrollIntoView({block:'center'})`, then `focus({preventScroll:true})`; target articles use `tabIndex={-1}` and a non-color-only highlight outline. “最新へ戻る” clears anchor state.

- [ ] **Step 6: Run frontend component tests**

Run: `cd frontend && npm test -- src/lib/search.test.ts src/components/search/SearchDialog.test.tsx src/App.test.tsx`

Expected: PASS, including Escape close, visible labels, minimum length, filters, empty state, pagination, and navigation callbacks.

### Task 4: Durable event diff API

**Files:**
- Create: `backend/internal/store/queries/events.sql`
- Regenerate: `backend/internal/store/events.sql.go`
- Create: `backend/internal/change/service.go`
- Modify: `api/openapi.yaml`
- Regenerate: `backend/internal/api/openapi.gen.go`
- Regenerate: `frontend/src/api/schema.d.ts`
- Create: `backend/internal/httpapi/events.go`
- Modify: `backend/internal/httpapi/server.go`
- Test: `backend/internal/httpapi/events_integration_test.go`

**Interfaces:**
- Produces: `GET /v1/events?after=<decimal>&limit=<1..200>` returning `ChangeEventPage`.
- Produces: `ChangeEvent{id,eventType,channelId,postId,threadRootId,createdAt}` with `id` as a decimal string.
- Produces: `change.Service.ListAfter(ctx, after int64, limit int) (Page, error)`.

- [ ] **Step 1: Write failing event-log and diff tests**

Mutate a channel, root post, reply, and reaction through authenticated APIs. Query `/v1/events?after=0`, assert strictly increasing IDs and normalized identifiers. Query again with the previous last ID and assert only later events. Assert missing auth is 401 and invalid IDs are 400.

- [ ] **Step 2: Run the focused test and verify missing endpoint failure**

Run: `cd backend && go test ./internal/httpapi -run TestEventDiff -count=1`

Expected: FAIL with 404.

- [ ] **Step 3: Add event OpenAPI schemas and sqlc queries**

Use `id: {type: string, pattern: '^[0-9]+$'}`. Query `where id > $after order by id asc limit limit+1`; set `hasMore` and `nextAfter` from returned rows.

- [ ] **Step 4: Implement authenticated handler and service**

Parse event IDs with `strconv.ParseInt`, reject negatives and overflow, clamp limits, map nullable UUIDs without fabricating zero UUIDs, and return an empty array rather than `null`.

- [ ] **Step 5: Regenerate and run focused tests**

Run: `cd backend && make generate && make sqlc && go test ./internal/httpapi -run TestEventDiff -count=1`

Expected: PASS.

### Task 5: Authenticated SSE stream with replay

**Files:**
- Modify: `api/openapi.yaml`
- Regenerate: `backend/internal/api/openapi.gen.go`
- Modify: `backend/internal/change/service.go`
- Modify: `backend/internal/httpapi/events.go`
- Test: `backend/internal/httpapi/events_integration_test.go`

**Interfaces:**
- Produces: `GET /v1/events/stream`, accepting `Last-Event-ID` and emitting standard SSE `id`, `event`, and JSON `data` fields.
- Consumes: `postall_events` PostgreSQL notifications and Task 4 `ListAfter`.

- [ ] **Step 1: Add failing streaming tests**

Open an authenticated request with a cancellable context, read response lines, create a post concurrently, and assert the event arrives before the request closes. Reconnect with `Last-Event-ID` set before two stored events and assert both replay in ascending order without duplicates.

- [ ] **Step 2: Run focused tests and verify no streaming response**

Run: `cd backend && go test ./internal/httpapi -run 'TestEventStream|TestEventReplay' -count=1`

Expected: FAIL because `/v1/events/stream` does not exist.

- [ ] **Step 3: Implement race-free LISTEN/replay loop**

Acquire a dedicated pgx connection, execute `LISTEN postall_events`, establish the starting cursor (latest ID when no header, supplied ID otherwise), replay all stored rows after the cursor, then wait for notifications. After each notification, call `ListAfter(currentID, 200)` until `hasMore` is false. This makes notification payload loss harmless and deduplicates by ID.

- [ ] **Step 4: Emit proxy-safe SSE**

Set:

```go
w.Header().Set("Content-Type", "text/event-stream")
w.Header().Set("Cache-Control", "no-cache")
w.Header().Set("Connection", "keep-alive")
w.Header().Set("X-Accel-Buffering", "no")
```

Require `http.Flusher`, write a `: heartbeat` comment every 15 seconds, flush after every frame, and stop immediately on request context cancellation.

- [ ] **Step 5: Run stream, race, and auth tests**

Run: `cd backend && go test -race ./internal/httpapi -run 'TestEvent(Stream|Replay|Diff)' -count=1`

Expected: PASS.

### Task 6: Frontend SSE parser, cache refresh, and reconnect recovery

**Files:**
- Modify: `frontend/src/api/client.ts`
- Create: `frontend/src/api/sse.ts`
- Test: `frontend/src/api/sse.test.ts`
- Create: `frontend/src/hooks/useChangeSync.ts`
- Test: `frontend/src/hooks/useChangeSync.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/state/ui.ts`

**Interfaces:**
- Produces: `parseSseStream(stream, onEvent, signal): Promise<void>`.
- Produces: `ApiClient.listEvents(after, limit)` and `ApiClient.streamEvents(lastEventId, signal)`.
- Produces: `connectionState: 'connecting' | 'live' | 'degraded' | 'offline'` and `canMutate: boolean`.

- [ ] **Step 1: Write failing parser and reconnect tests**

Feed a `ReadableStream<Uint8Array>` whose SSE fields and UTF-8 characters cross chunk boundaries. Assert comments are ignored, multiline `data:` joins with newline, duplicate/lower IDs are ignored by the sync layer, and abort ends without reporting a network failure.

- [ ] **Step 2: Run focused tests and verify missing modules**

Run: `cd frontend && npm test -- src/api/sse.test.ts src/hooks/useChangeSync.test.tsx`

Expected: FAIL because parser and hook do not exist.

- [ ] **Step 3: Implement Fetch-based authenticated streaming**

Reuse `ApiClient` token acquisition, add `Accept: text/event-stream`, add `Last-Event-ID` only when present, and expose the successful `Response.body`. Never put a token or last event ID in a bearer query parameter.

- [ ] **Step 4: Implement event-driven cache refresh**

Map channel events to `['channels']`; root post events to `['posts', channelId]`; reply events to both root timeline and `['thread', threadRootId]`; reaction events to both post and thread keys. Coalesce invalidations in a microtask so a burst performs one refetch per key.

- [ ] **Step 5: Implement reconnect and fallback**

On stream failure, call `/health`. If health succeeds, mark `degraded`, fetch `/v1/events?after=<lastID>` to exhaustion, invalidate affected caches, and reconnect with exponential delays capped at 30 seconds. If health fails or `navigator.onLine` is false, mark `offline`. On browser `online` or visibility return, immediately run diff recovery and invalidate active channel/tree/thread queries.

- [ ] **Step 6: Run frontend sync tests**

Run: `cd frontend && npm test -- src/api/sse.test.ts src/hooks/useChangeSync.test.tsx src/api/client.test.ts`

Expected: PASS.

### Task 7: Online-only mutation controls without draft loss

**Files:**
- Modify: `frontend/src/hooks/useChannels.ts`
- Modify: `frontend/src/hooks/usePosts.ts`
- Modify: `frontend/src/hooks/useReactions.ts`
- Modify: `frontend/src/components/channels/ChannelTree.tsx`
- Modify: `frontend/src/components/composer/Composer.tsx`
- Modify: `frontend/src/components/timeline/Timeline.tsx`
- Modify: `frontend/src/components/thread/ThreadPanel.tsx`
- Modify: `frontend/src/components/reactions/ReactionBar.tsx`
- Modify: `frontend/src/components/reactions/EmojiPicker.tsx`
- Test: `frontend/src/components/composer/Composer.test.tsx`
- Test: `frontend/src/App.test.tsx`
- Test: `frontend/src/components/reactions/Reactions.test.tsx`

**Interfaces:**
- Consumes: Task 6 `canMutate` and connection state.
- Produces: all mutation entry points reject with `ConnectionUnavailableError` while offline, while composer text remains enabled and persisted.

- [ ] **Step 1: Add failing offline behavior tests**

Set connection state to offline, type a draft, assert textarea value remains editable, and assert send/upload/channel/reaction/edit/delete controls do not invoke API mutations. Restore live state and assert the same draft remains and can be sent.

- [ ] **Step 2: Run focused tests and verify current controls still mutate**

Run: `cd frontend && npm test -- src/components/composer/Composer.test.tsx src/components/reactions/Reactions.test.tsx src/App.test.tsx`

Expected: FAIL on offline guard assertions.

- [ ] **Step 3: Separate composition from mutation availability**

Replace Composer's single disabled state with `channelDisabled` and `mutationDisabled`. Keep the textarea enabled whenever a channel exists; disable submit, attachments, uploads, reaction toggles, DnD, edit/delete, and channel create/rename/delete/move when `canMutate` is false. Mutation hooks independently call `requireMutationConnection()` so keyboard shortcuts or stale callbacks cannot bypass UI guards.

- [ ] **Step 4: Add non-color connection messaging**

Show “リアルタイム更新へ再接続中” for degraded mode and “接続されていません。変更操作は利用できません” with retry for offline mode. Use a polite live region for degraded state and `role="alert"` only for true offline state.

- [ ] **Step 5: Run offline and regression component tests**

Run: `cd frontend && npm test`

Expected: all component and utility tests pass.

### Task 8: Actual Nginx SSE acceptance and end-to-end scenarios

**Files:**
- Create: `infra/tests/sse-upstream.go`
- Create: `infra/tests/docker-compose.sse.yml`
- Create: `infra/scripts/verify-sse-proxy.sh`
- Modify: `infra/nginx/templates/default.conf.template` only if the acceptance test exposes a missing directive.
- Modify: `frontend/e2e/mock.ts`
- Modify: `frontend/e2e/app.spec.ts`
- Modify: `Makefile`

**Interfaces:**
- Produces: `make test-sse-proxy` acceptance command using the real PostAll Nginx image/template.
- Produces: Playwright coverage for search-to-source, SSE refresh, reconnect recovery, and draft preservation.

- [ ] **Step 1: Create a failing real-proxy acceptance harness**

The upstream writes one SSE frame immediately, flushes it, then keeps the connection open. The Compose file names that service `api`, builds the actual `infra/nginx` image, mounts development certificates, and maps HTTPS to a test-only host port. The verifier runs curl unbuffered with a timeout shorter than upstream close and asserts the immediate frame appears.

- [ ] **Step 2: Run the proxy test and verify it detects buffering/configuration errors**

Run: `infra/scripts/verify-sse-proxy.sh`

Expected before a correct route: non-zero exit because the first frame is absent or delayed. With the existing M0 route, record that it already passes and retain the test as regression coverage.

- [ ] **Step 3: Extend the Playwright API mock**

Mock `/v1/search`, `/v1/events`, and `/v1/events/stream`. Keep an event subscriber per page and expose test helpers that create external post/reply/reaction/channel events. Search results include an older root and a reply so both navigation paths are exercised.

- [ ] **Step 4: Add browser scenarios**

Assert Japanese search, one-character validation, filters, `<mark>` output, load-more, root scroll/focus, reply thread focus, external SSE updates, forced disconnect banner, mutation blocking, draft persistence, and recovery refresh.

- [ ] **Step 5: Run all focused acceptance tests**

Run: `cd frontend && npm run test:e2e`

Run: `infra/scripts/verify-sse-proxy.sh`

Expected: PASS.

### Task 9: Full verification and OpenSpec completion

**Files:**
- Modify: `openspec/changes/slack-style-memo-app/tasks.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: M7 tasks 8.1–8.15 checked only after their evidence passes.

- [ ] **Step 1: Run generated-code and formatting checks**

Run: `cd backend && make generate && make sqlc && gofmt -w internal cmd migrations`

Run: `cd frontend && npm run generate`

Expected: generated files are current and formatting succeeds.

- [ ] **Step 2: Run complete backend verification**

Run: `cd backend && go test ./... && go vet ./...`

Expected: PASS.

- [ ] **Step 3: Run complete frontend verification**

Run: `cd frontend && npm test && npm run lint && npm run typecheck && npm run build && npm run test:e2e`

Expected: PASS; pre-existing Fast Refresh and chunk-size warnings may remain warnings only.

- [ ] **Step 4: Run deployment and SSE checks**

Run: `docker compose -f infra/docker-compose.yml config`

Run: `infra/scripts/verify-sse-proxy.sh`

Expected: PASS.

- [ ] **Step 5: Validate OpenSpec and mark M7 complete**

Run: `openspec validate slack-style-memo-app --strict`

After all evidence passes, mark tasks 8.1 through 8.15 as `- [x]` and rerun strict validation.

Expected: M7 complete with OpenSpec progress 145/176.
