# Memory index

- [Better Auth on Replit](better-auth-setup.md) — use ^1.6 (firewall blocks 1.4.x, CLI unusable); hand-write auth tables; verification.identifier is the magic-link token for provider-free E2E tests.
- [TypeScript version pin](typescript-version-pin.md) — "latest" typescript is the 7.x native preview; pin ~5.9, keep tsconfig baseUrl-free; tsx scripts are CJS — async main, no top-level await.
- [RLS is bypassed at runtime](rls-bypassed-at-runtime.md) — BYPASSRLS defeats policies, not triggers: visibility stays in route/SQL; counter + member-transition rules are trigger-enforced (GUC-gated).
- [Authed E2E session recipe](auth-e2e-recipes.md) — mint session jars via magic-link + verification.identifier; jars die when the dev domain rotates; Resend test-mode 500s are expected and non-blocking.
- [Email template entity defaults](email-template-entity-type.md) — shared templates default entity_type per-template; cross-entity call sites must override per call or logs mislabel silently.
- [Legacy NULL required fields](legacy-null-required-fields.md) — seeded volunteer requests predate required details; edit saves correctly refuse until a member fills them — never backfill invented content.
- [LA calendar-day semantics](la-calendar-day-semantics.md) — date filters and expiry compare `(col at time zone 'America/Los_Angeles')::date`, never UTC ::date; "today" is the LA date.
- [Staff-admin client gate lockstep](staff-admin-client-gate.md) — requireStaffAdmin surfaces must also join STAFF_ADMIN_ONLY_SURFACES in shared/routes.ts, or approvers can load the page shell.
- [Email dispatch claim](email-dispatch-claim.md) — queued→sending claim before every provider call; sweep re-dispatches stranded queued, never retries stranded sending (possible double send).
- [Test fixture conventions](test-fixture-conventions.md) — zz_fixture payload key / zz. email prefix mark deliberate rows; check markers before diagnosing "stuck" data as a bug.
- [App Storage bucket](app-storage-bucket.md) — sidecar default-bucket stays empty until manually created in the App Storage tool; no CLI/API path; Client() fails loudly.
- [Actor id mapping](actor-id-mapping.md) — Better Auth user.id is TEXT; approval_events/approved_by are uuid; pass the orgContext-mapped uuid in fixture scripts, never "user".id.
- [SPA identity switch](spa-identity-switch.md) — logout/quick-login must end in a full page reload; queryClient.clear() with mounted queries leaves stale session UI.
- [Email copy overrides](email-copy-overrides.md) — only free-text copy is editable, all-or-nothing override with defaultCopy fallback; disabled templates write visible skipped log rows, never silent drops.
- [Policy migrations vs bootstrap](policy-migration-bootstrap.md) — migrations run before apply-rls on fresh DBs: policy drops need 'if exists'; rls-policies.sql must mirror policy changes.
- [Digest run guard](digest-run-guard.md) — scheduled email jobs need a durable run-date claim + run-bound once-only fan-out, not the in-memory expiry guard; skipped weeks write visible rows.
