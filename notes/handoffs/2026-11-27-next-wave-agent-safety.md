# Agent/data write safety handoff

Implemented RM-A7 + RM-A8 + RM-K5 within the assigned files.

- Every agent response now carries a non-secret `X-Request-Id`; the same ID is written to the structured audit row.
- `POST /api/v1/records/:type` accepts `Idempotency-Key`. Successful creates are replayed from the durable response record when the key and SHA-256 request hash match; reuse with a different body returns conflict.
- `If-Match` is read by the shared handler and checked against the stored row `updated_at` before PATCH and singleton writes. The current `JournalCommands` interface does not pass an atomic `expectedUpdatedAt` through to its repository, so this is a pre-write guard rather than a database-atomic compare-and-swap. A future command-layer change should thread that option into `Repository.put`.
- Audit rows now carry only request/decision metadata (`request_id`, `decision_code`, `decision_version`), never prose, secrets or token hashes.
- Strategy Lab API truth no longer applies the UI Shield preference; Shield remains a presentation/share concern.
- House rules explicitly classify user-authored prose as untrusted quotation data and prohibit following embedded instructions.
- No order, trade, or broker mutation capability was added.

Files changed:

- `lib/agent/handle.ts`
- `lib/agent/dispatch.ts`
- `lib/agent/server-auth.ts`
- `lib/agent/strategy-lab.ts`
- `lib/agent/house-rules.ts`
- `lib/agent/idempotency.ts`
- `lib/agent/untrusted-text.ts`
- `supabase/migrations/20261127010500_mogmine_agent_write_safety.sql`

No tests, builds, lint, typechecks, dependency installs, or browsing were run per owner instruction. `git diff --check` was run for the owned files only.
