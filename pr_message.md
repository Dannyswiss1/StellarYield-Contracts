## Summary

Implements four backend features for operator fee reporting and GDPR compliance, and fixes a batch of pre-existing CI breakage on `main` that was unrelated to these issues but left the build red (rust fmt/clippy/test, backend lint, and several dead/broken modules) — a green CI was part of the ask, so it's included here rather than built on top of a broken baseline.

### #794 — Fee dashboard endpoint
- `GET /api/v1/admin/fees/dashboard` returns per-vault fee metrics: `contractId`, `name`, `totalOperatorFees`, `epochCount`, `feeBps`, `lastEpochFee`.
- Ordered by `totalOperatorFees DESC`; accepts optional `from`/`to` date filters that bound the fee computation.
- Returns all vaults via a `LEFT JOIN`, including ones with no fee history yet.

### #795 — GDPR data export endpoint
- `GET /api/v1/users/:address/data-export` streams a ZIP containing `user.json`, `positions.json`, `yield-history.json`, `events.json`, with `Content-Type: application/zip` and `Content-Disposition: attachment`. Admin-key protected.
- Fixed a real bug in the hand-rolled ZIP encoder: the central-directory record was byte-misaligned (wrong field offsets and compression-method value), producing an archive that failed to extract. Corrected the offsets to match the ZIP spec and verified with `unzip` and Python's `zipfile`.

### #796 — User deletion (right to erasure)
- `DELETE /api/v1/admin/users/:address` deletes the `users` row, anonymises `user_address` to `[REDACTED]` in `user_vault_positions`, `share_balance_snapshots`, and `redemption_requests`, and returns `{ address, deletedAt, recordsAffected }`. Admin-key protected. `GET /api/v1/users/:address` returns 404 afterward.
- Fixed `recordsAffected` counting every `[REDACTED]` row ever written (across all past deletions) instead of just this call's affected rows.
- Added anonymisation of the historical event log (`indexed_events.payload`), which was previously untouched despite "historical event data is anonymised, not deleted" being an explicit acceptance criterion.

### #797 — Admin audit log
- New `admin_audit_log` table: `id`, `api_key_label`, `action`, `target`, `ip_address`, `created_at`, `request_body_hash`.
- Logged on every admin write (backfill trigger, API key deletion, user deletion) with the API key label, client IP, and a SHA-256 hex hash of the request body (never the raw body).
- `GET /api/v1/admin/audit-log` returns entries ordered by `created_at DESC`, paginated.

### Unrelated CI fixes
- Removed five dead pre-refactor directories (`backend/src/routes`, `src/database`, `src/middleware`, `src/indexer`, `src/tasks`) never imported by the live app, plus the dangling npm scripts pointing at them.
- Restored `ErrorCode`/`AppError`, an `EventEmitter` import, an SSE handler, and a `CORS_MAX_AGE` config field — all dropped by a bad merge on `main`.
- Fixed 9 pre-existing ESLint errors and a flaky test caused by an unmocked real DNS lookup.
- Rust: `cargo fmt`, one clippy lint, a contract error discriminant defined as `= 2` instead of `= 52`, missing `VaultInfo` struct fields, a missing `default_operator_fee_bps` getter, and several test bugs (wrong `redeem_at_maturity` args, deposits below the funding target, a test relying on the ledger's default zero timestamp colliding with a "no deposit" sentinel).

## Tests Ran

- `backend`: `npm run lint`, `npm run build`, `npm run test` — all pass (288/288 tests, 31/31 files).
- `sdk`: `npm run lint`, `npm run build` — pass.
- `soroban-contracts`: `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace` — all pass (393 + 40 tests).
- Added/extended unit tests for `getAdminFeesDashboard`, `deleteUser`, and `getAdminAuditLog`.
- Added a structural ZIP-validity check (parses local file headers, inflates each entry, verifies CRC/size) to the export test — this is what caught the ZIP corruption bug.

Closes #794
Closes #795
Closes #796
Closes #797
