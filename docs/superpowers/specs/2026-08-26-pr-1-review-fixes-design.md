# PR #1 Review Fixes Design

## Goal

Resolve every actionable review finding on PR #1 while preserving the existing HTTP/OpenAPI contract and existing client behavior. Changes stay focused on correctness, resource bounds, durable cleanup, client feature parity, and diagnosability.

## Constraints

- Keep body-only post edits valid; attachment selection is optional and additive.
- Do not change generated OpenAPI models or existing SSE JSON decoding requirements.
- Use one bounded PostgreSQL LISTEN connection per server process, not per browser/client.
- Never discard durable attachment cleanup state before object-store deletion succeeds.
- Return the same generic 500 response while logging unexpected errors without request bodies, query strings, authorization data, or signed URLs.

## Design

### OAuth and JWT verification

Browser/PWA sign-in navigates the current tab to Cognito so the callback returns to the same tab and retains the PKCE verifier in `sessionStorage`. Native shells keep using their external-browser adapter, and ordinary external links keep opening separately.

JWT key refreshes are coalesced through one singleflight operation. A bounded, expiring negative-key cache and short successful-miss cooldown prevent random unknown `kid` values from forcing network traffic on every request. A newly published key still succeeds immediately when the refresh response contains it.

### SSE connection ownership and initial synchronization

The HTTP server owns one lazy event broker. The broker acquires one PostgreSQL connection, completes `LISTEN`, and fans wake-up notifications to all local subscribers. Each stream reads durable change rows through the normal pool, so notifications remain hints and heartbeat reads recover from missed/coalesced notifications.

Subscription readiness is the barrier: a stream subscribes and waits for `LISTEN` before choosing its initial cursor. When no `Last-Event-ID` is supplied, the server emits a named `postall.sync` SSE frame at the current durable watermark. Its JSON remains a valid `ChangeEvent` sentinel (all entity IDs absent), preserving old decoders. New Web and iOS clients recognize it and reload visible data, closing the REST-before-SSE race. Streams with a cursor retain ordered replay semantics.

### Transactional edits and durable attachment cleanup

When an edit includes `attachmentIds`, the body update and attachment replacement run on the same pgx transaction and roll back together. Body-only edits keep the existing path.

Attachments gain durable deletion state (`deletion_pending_at`, attempt count, and last error). Deleting a post detaches and marks referenced attachments in the same database transaction, including channel-cascade deletion of soft-deleted posts. The reaper first marks eligible rows, then deletes the object, and only then deletes the database row. Failures retain the row and record retry information; retries are idempotent.

### Client editing, rendering, and upload behavior

Web timeline posts and thread replies share the same edit/delete actions. The edit dialog sends optional attachment IDs and permits deselecting existing attachments. iOS uses the same checklist behavior while keeping its existing body-only API calls source-compatible.

Flutter Mermaid documents carry source as UTF-8 base64 and decode it inside JavaScript, preventing source text from terminating the inline script. Web Composer constructs upload commands outside React state updaters and executes each accepted file exactly once, including under StrictMode.

### Diagnostics

A middleware assigns or propagates a request ID and returns it in `X-Request-ID`. Central error helpers log only unexpected failures with request ID, method, and path; typed application errors keep their current responses without error-level logs. Attachment reaper failures are logged instead of discarded.

## Verification

Each finding receives a focused regression test. Backend integration tests cover transaction rollback, one-listener behavior under a two-connection pool, synchronization barriers, channel deletion, and cleanup retry. Web tests cover same-tab PKCE, sync invalidation, reply actions, attachment removal, and StrictMode uploads. Flutter tests cover attachment removal, sync reload, and hostile Mermaid input. Final verification runs Go tests/vet, Web unit/lint/type/build/E2E checks, Flutter tests/analyze, generated SQL checks, and a clean diff review.

