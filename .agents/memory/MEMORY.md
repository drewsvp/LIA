# Memory index

- [Better Auth on Replit](better-auth-setup.md) — use ^1.6 (firewall blocks 1.4.x, CLI unusable); hand-write auth tables; verification.identifier is the magic-link token for provider-free E2E tests.
- [TypeScript version pin](typescript-version-pin.md) — "latest" typescript is the 7.x native preview; pin ~5.9, keep tsconfig baseUrl-free; tsx scripts are CJS — async main, no top-level await.
- [RLS is bypassed at runtime](rls-bypassed-at-runtime.md) — DB role has BYPASSRLS: even FORCE policies filter nothing; visibility must be explicit route/SQL checks; psql probes prove nothing.
- [Authed E2E session recipe](auth-e2e-recipes.md) — mint session jars via magic-link + verification.identifier; jars die when the dev domain rotates; Resend test-mode 500s are expected and non-blocking.
- [Email template entity defaults](email-template-entity-type.md) — shared templates default entity_type per-template; cross-entity call sites must override per call or logs mislabel silently.
- [Legacy NULL required fields](legacy-null-required-fields.md) — seeded volunteer requests predate required details; edit saves correctly refuse until a member fills them — never backfill invented content.
- [LA calendar-day semantics](la-calendar-day-semantics.md) — date filters and expiry compare `(col at time zone 'America/Los_Angeles')::date`, never UTC ::date; "today" is the LA date.
- [Staff-admin client gate lockstep](staff-admin-client-gate.md) — requireStaffAdmin surfaces must also join STAFF_ADMIN_ONLY_SURFACES in shared/routes.ts, or approvers can load the page shell.
- [Email dispatch claim](email-dispatch-claim.md) — queued→sending claim before every provider call; sweep re-dispatches stranded queued, never retries stranded sending (possible double send).
- [Test fixture conventions](test-fixture-conventions.md) — zz_fixture payload key / zz. email prefix mark deliberate rows; check markers before diagnosing "stuck" data as a bug.
- [Git push from broken shallow clone](shallow-clone-push-fix.md) — if the shallow boundary's parent object is gone, reinit + fresh commit + force-push; history rewrites diverge from task merges. Push via temp deploy key.
- [App Storage bucket](app-storage-bucket.md) — sidecar default-bucket stays empty until manually created in the App Storage tool; no CLI/API path; Client() fails loudly.
- [Actor id mapping](actor-id-mapping.md) — Better Auth user.id is TEXT; approval_events/approved_by are uuid; pass the orgContext-mapped uuid in fixture scripts, never "user".id.
