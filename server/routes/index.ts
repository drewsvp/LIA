/**
 * Route registration — the foundation's route table scaffold.
 *
 * API surface here is the auth/session/storage/legacy plumbing every parallel
 * task builds on. Surface tasks add their own /api routes behind the guards:
 *   member portal: app.get("/api/dashboard/…", requireOrganization, handler)
 *   staff admin:   app.get("/api/admin/…", requireStaff, handler)
 *
 * Page routes (the MP, PB, and ADMIN paths in shared/routes.ts) are served by
 * the SPA shell; each currently renders a placeholder component. Unknown /api
 * paths and non-staff /api/admin requests return the identical 404 body.
 */
import { randomBytes } from "node:crypto";
import type { Express, Request, Response } from "express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "../auth/auth";
import { resolveSessionInfo, ACTIVE_ORG_COOKIE } from "../auth/session";
import { NOT_FOUND_BODY, requireStaff } from "../auth/guards";
import { magicLinkEmailLimiter, magicLinkIpLimiter, magicLinkVerifyIpLimiter } from "../auth/rate-limit";
import { PUBLIC, SYSTEM, pool } from "../db/client";
import * as usersDal from "../dal/users";
import * as dal from "../dal";
import * as storage from "../storage/object-storage";
import { LEGACY_ROUTES } from "../../shared/routes";
import { registerPublicRoutes } from "./public";
import { registerMemberRoutes } from "./member";
import { registerAdminRoutes } from "./admin";
import { registerEmailTemplateAdminRoutes } from "./admin-email-templates";
import { registerEngagementReportingRoutes } from "./engagement-reporting";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Magic-link confirmation (D66).
//
// Better Auth's GET /api/auth/magic-link/verify consumes the verification row
// on sight, so any mail scanner or link prefetcher that followed the URL
// invalidated the link before the member clicked it. Verification is split:
// the GET only renders a confirmation surface, and this POST performs the
// real work. Within its 15-minute window the token stays replayable — the row
// is restored after each successful confirmation — so a double click, a
// reload, or a second device all return a session instead of an error. Only
// an expired token, or one superseded by a newer link for the same email, is
// refused.
// ---------------------------------------------------------------------------

type VerifyFailure = "invalid" | "expired" | "superseded";

const VERIFY_FAILURE_MESSAGE: Record<VerifyFailure, string> = {
  invalid: "That sign-in link is no longer valid. Request a new one below and it will work right away.",
  expired: "That sign-in link has expired — links are good for 15 minutes. Request a new one below.",
  superseded: "A newer sign-in link was sent to your email. Open the most recent one, or request another below.",
};

type ConfirmResult =
  | { ok: true; cookies: string[]; redirectTo: string }
  | { ok: false; reason: VerifyFailure };

/**
 * Timestamps stay in Postgres's hands. `verification` stores `timestamp
 * without time zone` at microsecond precision; round-tripping those through a
 * JS Date truncates to milliseconds (and reinterprets them in the process
 * timezone), which made a token look *newer than itself* and report as
 * superseded. Every comparison below is evaluated in SQL, and the two stamps
 * are carried as text purely so the row can be restored byte-for-byte.
 */
type VerificationRow = {
  id: string;
  identifier: string;
  value: string;
  expired: boolean;
  expiresAtText: string;
  createdAtText: string;
};

/** Email carried in a verification row's JSON value; null when unparseable. */
function verificationEmail(value: string): string | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return null;
    const email = (parsed as { email?: unknown }).email;
    return typeof email === "string" && email.trim() !== "" ? email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * True when a newer, still-valid link exists for the same email. Requesting a
 * fresh link is the documented way to retire an old one, so the previous
 * token stops working the moment its replacement is issued.
 *
 * The whole decision is made in SQL, against the stored row by id: matching
 * the email in Node over a capped page of candidates would let a newer token
 * fall outside the page and quietly revive a superseded link. The JSON cast is
 * guarded by a shape test so a non-JSON row can never abort the query.
 */
async function hasNewerToken(email: string, rowId: string): Promise<boolean> {
  const { rows } = await pool.query<{ superseded: boolean }>(
    `SELECT EXISTS (
              SELECT 1
                FROM verification v
                JOIN verification t ON t.id = $1
               WHERE v.id <> t.id
                 AND v."createdAt" > t."createdAt"
                 AND v."expiresAt" > NOW()
                 AND lower(
                       CASE WHEN v.value IS JSON OBJECT THEN v.value::jsonb ->> 'email' END
                     ) = $2
            ) AS "superseded"`,
    [rowId, email],
  );
  return rows[0]?.superseded === true;
}

/**
 * Serializes confirmations of the same token.
 *
 * Better Auth's consume deletes *every* row sharing the identifier, so the
 * token is genuinely absent between the provider call and the restore below —
 * a second confirmation landing in that gap would read nothing and report a
 * perfectly good link as invalid. Chaining per token closes the gap: the
 * follower runs after the leader has put the row back, and sees a valid token.
 *
 * Entries are dropped once a token's chain drains, so the map tracks only
 * in-flight work. There is no await between reading the tail and replacing it,
 * so no two callers can attach to the same tail.
 */
const confirmChains = new Map<string, Promise<unknown>>();

function withTokenLock<T>(token: string, fn: () => Promise<T>): Promise<T> {
  const tail = confirmChains.get(token) ?? Promise.resolve();
  const run = tail.then(fn, fn);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  confirmChains.set(token, settled);
  void settled.then(() => {
    if (confirmChains.get(token) === settled) confirmChains.delete(token);
  });
  return run;
}

/**
 * Consume the token through Better Auth's own code path (session hooks and
 * subject linking included), then restore the verification row so the link
 * remains usable for the rest of its window.
 */
function confirmMagicLink(token: string): Promise<ConfirmResult> {
  return withTokenLock(token, () => confirmMagicLinkExclusive(token));
}

async function confirmMagicLinkExclusive(token: string): Promise<ConfirmResult> {
  const { rows } = await pool.query<VerificationRow>(
    `SELECT id,
            identifier,
            value,
            ("expiresAt" <= NOW())  AS "expired",
            "expiresAt"::text       AS "expiresAtText",
            "createdAt"::text       AS "createdAtText"
       FROM verification
      WHERE identifier = $1
      LIMIT 1`,
    [token],
  );
  const row = rows[0];
  // No row: either never issued, or expired and already swept. Both read as
  // "ask for a new one" — neither discloses whether the email is registered.
  if (!row) return { ok: false, reason: "invalid" };

  if (row.expired) {
    await pool.query(`DELETE FROM verification WHERE id = $1`, [row.id]);
    return { ok: false, reason: "expired" };
  }

  const email = verificationEmail(row.value);
  if (email === null) return { ok: false, reason: "invalid" };

  // A disabled or deleted account must not be able to trade an old link for a
  // session, and the magic-link plugin would otherwise create a provider user
  // for an address the application does not know.
  const appUser = await usersDal.findByEmail(SYSTEM, email);
  if (!appUser || appUser.status === "disabled") return { ok: false, reason: "invalid" };

  if (await hasNewerToken(email, row.id)) return { ok: false, reason: "superseded" };

  let verifyRes: globalThis.Response;
  try {
    // No callbackURL: the endpoint answers with JSON and the session cookie
    // rather than a redirect, which is what this POST needs.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    verifyRes = await (auth.api as any).magicLinkVerify({
      query: { token },
      headers: new Headers(),
      asResponse: true,
    });
  } catch (err) {
    console.error("magic-link confirm failed:", err);
    return { ok: false, reason: "invalid" };
  }

  // Put the row back, preserving createdAt so supersession keeps comparing
  // against the original issue time rather than the time of this click. The
  // per-token chain above guarantees no other confirmation observes the gap.
  //
  // A failure here costs replay, not the sign-in: this member is already
  // authenticated, and the link simply reverts to single use. Losing it
  // outright needs a crash inside these few milliseconds, and the recovery is
  // the one the error page already offers — request a new link.
  await pool
    .query(
      `INSERT INTO verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4::timestamp, $5::timestamp, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [row.id, row.identifier, row.value, row.expiresAtText, row.createdAtText],
    )
    .catch((err: unknown) => {
      console.error("magic-link confirm: token restore failed:", err);
    });

  // Housekeeping: restored rows would otherwise outlive their usefulness.
  void pool
    .query(`DELETE FROM verification WHERE "expiresAt" < NOW() - INTERVAL '1 day'`)
    .catch(() => undefined);

  const setCookies: string[] =
    typeof (verifyRes.headers as { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (verifyRes.headers as { getSetCookie: () => string[] }).getSetCookie()
      : [];
  const hasSessionCookie = setCookies.some(
    (c) => c.startsWith("__Secure-better-auth.session_token") || c.startsWith("better-auth.session_token"),
  );
  if (!hasSessionCookie) {
    console.error("magic-link confirm: no session cookie returned by the provider");
    return { ok: false, reason: "invalid" };
  }

  // Supporters have no organization dashboard; MP-02 sends them to /profile.
  return {
    ok: true,
    cookies: setCookies,
    redirectTo: appUser.kind === "supporter" ? "/profile" : "/dashboard",
  };
}

// ---------------------------------------------------------------------------
// Quick-login configuration — module-level so startup checks can use it
// without going through a request.
// ---------------------------------------------------------------------------

const QUICK_LOGIN_ACCOUNTS: Record<string, { email: string; label: string }> = {
  staff_admin: { email: "tiffany@defendingthecause.org", label: "Staff Admin (Tiffany)" },
  staff_approver: { email: "approver@thealliance.example.org", label: "Staff Approver (Riley)" },
  org_owner: { email: "dana@heartsandhands.example.org", label: "Org Owner (Dana)" },
};

function isQuickLoginEnabled(): boolean {
  return process.env.NODE_ENV === "development" || process.env.QUICK_LOGIN_ENABLED === "true";
}

/**
 * Checks whether all quick-login seed accounts exist and are active.
 * Returns the list of missing account labels so callers can surface a
 * helpful message directing developers to run the seed script.
 */
export async function checkQuickLoginSeed(): Promise<{ seeded: boolean; missing: string[] }> {
  const missing: string[] = [];
  for (const acct of Object.values(QUICK_LOGIN_ACCOUNTS)) {
    const user = await usersDal.findByEmail(SYSTEM, acct.email);
    if (!user || user.status !== "active") {
      missing.push(acct.label);
    }
  }
  return { seeded: missing.length === 0, missing };
}

export function registerRoutes(app: Express): void {
  // ---- Magic-link GET interception (D66). MUST stay above the Better Auth
  // catch-all: the provider's own GET handler consumes the verification row,
  // so mail-security scanners and link prefetchers were burning links before
  // the human ever clicked. This handler has NO side effects — it only hands
  // the token to the confirmation surface, which finishes sign-in over POST.
  app.get("/api/auth/magic-link/verify", (req: Request, res: Response) => {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    if (token === "") {
      res.redirect(302, "/login?error=invalid");
      return;
    }
    // callbackURL is deliberately dropped: the POST step resolves the
    // destination from the account itself, so no caller-supplied redirect
    // target ever reaches the browser.
    res.redirect(302, `/login/verify?token=${encodeURIComponent(token)}`);
  });

  // ---- Better Auth handler. Mounted before body parsers (it reads its own body).
  app.all("/api/auth/*", toNodeHandler(auth));

  // ---- Uniform magic-link request (MP-01). Response NEVER discloses whether
  // an email is registered: identical body and status on every path.
  app.post("/api/login/magic-link", async (req: Request, res: Response) => {
    const email: unknown = (req.body as Record<string, unknown> | undefined)?.email;
    const uniform = { ok: true, message: "If that email belongs to a member account, a sign-in link is on its way." };
    if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
      // Invalid shape gets a visible validation error (not an existence hint).
      res.status(400).json({ message: "Enter a valid email address." });
      return;
    }
    // Respond BEFORE doing any account work: a registered email triggers a
    // lookup + template render + provider send, an unknown one returns fast —
    // awaiting that here would leak registration status through timing.
    // Identical body, status, and response time on every path.
    res.status(200).json(uniform);

    // Bounded dispatch (see rate-limit.ts): calling auth.api directly skips
    // Better Auth's HTTP rate limit, so the budget is enforced here. Throttled
    // requests got the same 200 above and simply do not dispatch.
    const normalized = email.trim().toLowerCase();
    if (!magicLinkIpLimiter.consume(req.ip ?? "unknown") || !magicLinkEmailLimiter.consume(normalized)) {
      return;
    }
    void auth.api
      .signInMagicLink({
        body: { email: normalized, callbackURL: "/dashboard" },
        headers: new Headers({ "content-type": "application/json" }),
      })
      .catch((err: unknown) => {
        // Send failures (config, provider) are recorded in email_log and here.
        console.error("magic-link request failed:", err);
      });
  });

  // ---- Magic-link confirmation (D66). The state-changing half of the split:
  // this is what actually consumes the token and establishes the session, and
  // it is only reachable by POST, which scanners and prefetchers do not issue.
  app.post("/api/login/magic-link/verify", async (req: Request, res: Response, next) => {
    try {
      const token: unknown = (req.body as Record<string, unknown> | undefined)?.token;
      if (typeof token !== "string" || token.trim() === "") {
        res.status(400).json({ reason: "invalid", message: VERIFY_FAILURE_MESSAGE.invalid });
        return;
      }
      if (!magicLinkVerifyIpLimiter.consume(req.ip ?? "unknown")) {
        res.status(429).json({
          reason: "throttled",
          message: "Too many sign-in attempts from this device. Please wait a few minutes and try again.",
        });
        return;
      }

      const outcome = await confirmMagicLink(token.trim());
      if (!outcome.ok) {
        res.status(400).json({ reason: outcome.reason, message: VERIFY_FAILURE_MESSAGE[outcome.reason] });
        return;
      }
      for (const cookie of outcome.cookies) {
        res.append("Set-Cookie", cookie);
      }
      res.status(200).json({ ok: true, redirectTo: outcome.redirectTo });
    } catch (err) {
      next(err);
    }
  });

  // ---- Quick Login (seeded test accounts only — see module-level allowlist).
  //
  // Disabled by default. Enabled when NODE_ENV=development OR the deployer has
  // explicitly set QUICK_LOGIN_ENABLED=true. When disabled every request to
  // these routes returns the standard unknown-API 404 so the surface is
  // invisible to anyone who has not opted in.
  //
  // Token generation bypasses the email-send path entirely: a one-off
  // verification row is written directly to the DB (same schema Better Auth
  // uses) and immediately consumed via magicLinkVerify. No email is dispatched.

  // Status endpoint — lets the client know whether to show the quick-login UI
  // and whether the seed accounts are present.
  app.get("/api/login/quick/status", async (_req: Request, res: Response) => {
    if (!isQuickLoginEnabled()) {
      res.status(404).json(NOT_FOUND_BODY);
      return;
    }
    const { seeded, missing } = await checkQuickLoginSeed();
    res.json({ enabled: true, seeded, missing });
  });

  app.post("/api/login/quick", async (req: Request, res: Response) => {
    // Environment gate: return identical 404 to an unknown route when disabled.
    if (!isQuickLoginEnabled()) {
      res.status(404).json(NOT_FOUND_BODY);
      return;
    }

    const role: unknown = (req.body as Record<string, unknown> | undefined)?.role;
    if (typeof role !== "string" || !(role in QUICK_LOGIN_ACCOUNTS)) {
      res.status(400).json({ message: "Unknown test role." });
      return;
    }
    // Same IP-based rate limit as magic link.
    if (!magicLinkIpLimiter.consume(req.ip ?? "unknown")) {
      res.status(429).json({ message: "Too many attempts. Try again later." });
      return;
    }
    const account = QUICK_LOGIN_ACCOUNTS[role]!;

    // Confirm the test user is present and active (seed not yet run → helpful error).
    const user = await usersDal.findByEmail(SYSTEM, account.email);
    if (!user || user.status !== "active") {
      res.status(404).json({
        message: `Test account not found (${account.label}). Run the seed script first.`,
      });
      return;
    }

    // Step 1: write a verification row directly — same schema Better Auth uses,
    // but WITHOUT calling signInMagicLink so no email is ever dispatched.
    const token = randomBytes(24).toString("base64url"); // 32 URL-safe chars
    await pool.query(
      `INSERT INTO verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, NOW() + INTERVAL '2 minutes', NOW(), NOW())`,
      [token, JSON.stringify({ email: account.email })],
    );

    // Step 2: verify the token via Better Auth's own handler so the session is
    // created through its normal code path (hooks, subject linking, etc.).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const verifyRes: globalThis.Response = await (auth.api as any).magicLinkVerify({
      query: { token, callbackURL: "/dashboard" },
      headers: new Headers(),
      asResponse: true,
    });

    const setCookies: string[] =
      typeof (verifyRes.headers as { getSetCookie?: () => string[] }).getSetCookie === "function"
        ? (verifyRes.headers as { getSetCookie: () => string[] }).getSetCookie()
        : [];

    // Guard: treat a missing session cookie as a hard failure rather than
    // silently returning an unauthenticated 200.
    const hasSessionCookie = setCookies.some(
      (c) =>
        c.startsWith("__Secure-better-auth.session_token") ||
        c.startsWith("better-auth.session_token"),
    );
    if (!hasSessionCookie) {
      res.status(500).json({ message: "Login setup failed — session not established. Please try again." });
      return;
    }

    for (const c of setCookies) {
      res.append("Set-Cookie", c);
    }
    res.status(200).json({ ok: true, redirectTo: "/dashboard" });
  });

  // ---- Session snapshot for the client (MP-02 routing, admin gate).
  app.get("/api/session", async (req: Request, res: Response, next) => {
    try {
      const session = await resolveSessionInfo(req);
      res.json(session);
    } catch (err) {
      next(err);
    }
  });

  // ---- Active-org choice for multi-org users (MP-02). Validated against
  // the user's own active memberships; stored in a signed cookie.
  app.post("/api/session/active-org", async (req: Request, res: Response, next) => {
    try {
      const session = await resolveSessionInfo(req);
      if (!session.authenticated) {
        res.status(401).json({ message: "Authentication required" });
        return;
      }
      const orgId: unknown = (req.body as Record<string, unknown> | undefined)?.orgId;
      if (typeof orgId !== "string" || !session.memberships.some((m) => m.orgId === orgId)) {
        res.status(400).json({ message: "Not one of your organizations." });
        return;
      }
      res.cookie(ACTIVE_ORG_COOKIE, orgId, {
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        signed: true,
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
      res.json({ ok: true, activeOrgId: orgId });
    } catch (err) {
      next(err);
    }
  });

  // ---- Supporter profile (SP-01): the signed-in user's own donation and
  // volunteer history, resolved through their linked person record. Any
  // authenticated user may read their own history; no membership required.
  app.get("/api/supporter/profile", async (req: Request, res: Response, next) => {
    try {
      const session = await resolveSessionInfo(req);
      if (!session.authenticated || session.user === null) {
        res.status(401).json({ message: "Authentication required" });
        return;
      }
      const personId = session.user.personId;
      const memberCtx = { kind: "member" as const, userId: session.user.id };
      const [pledges, signups, volunteerInterests, matchingVolunteerAlerts, recentlyViewed] = await Promise.all([
        dal.pledges.listByPerson(SYSTEM, personId),
        dal.signups.listByPerson(SYSTEM, personId),
        dal.volunteerInterests.listOptionsForPerson(memberCtx, personId),
        dal.volunteerAlerts.getForUser(memberCtx, session.user.id),
        dal.requestEngagement.listRecentlyViewedForUser(SYSTEM, session.user.id, personId),
      ]);
      res.json({
        firstName: session.user.firstName,
        lastName: session.user.lastName,
        email: session.user.email,
        pledges,
        signups,
        recentlyViewed,
        volunteerInterests,
        matchingVolunteerAlertsEnabled: matchingVolunteerAlerts.enabled,
        matchingVolunteerAlertsEligible: session.user.kind === "supporter" && session.user.status === "active",
      });
    } catch (err) {
      next(err);
    }
  });

  // The person id is always resolved from the authenticated session. The
  // request body carries category ids only, so it cannot target another human.
  app.put("/api/supporter/profile/volunteer-interests", async (req: Request, res: Response, next) => {
    try {
      const session = await resolveSessionInfo(req);
      if (!session.authenticated || session.user === null) {
        res.status(401).json({ message: "Authentication required" });
        return;
      }
      const rawIds: unknown = req.body?.categoryIds;
      if (
        !Array.isArray(rawIds) ||
        rawIds.length > 100 ||
        rawIds.some((id) => typeof id !== "string" || !UUID_RE.test(id)) ||
        new Set(rawIds).size !== rawIds.length
      ) {
        res.status(400).json({ message: "Choose each available volunteer interest at most once." });
        return;
      }
      const ctx = { kind: "member" as const, userId: session.user.id };
      const rawMatchingAlertsEnabled: unknown = req.body?.matchingVolunteerAlertsEnabled;
      if (rawMatchingAlertsEnabled !== undefined && typeof rawMatchingAlertsEnabled !== "boolean") {
        res.status(400).json({ message: "Choose whether matching volunteer alerts are on or off." });
        return;
      }
      const matchingVolunteerAlerts = await dal.volunteerAlerts.saveSupporterPreferences(ctx, {
        userId: session.user.id,
        personId: session.user.personId,
        categoryIds: rawIds as string[],
        matchingAlertsEnabled: rawMatchingAlertsEnabled as boolean | undefined,
      });
      const volunteerInterests = await dal.volunteerInterests.listOptionsForPerson(ctx, session.user.personId);
      res.json({
        message: "Volunteer interests and alert preference saved.",
        volunteerInterests,
        matchingVolunteerAlertsEnabled: matchingVolunteerAlerts.enabled,
      });
    } catch (err) {
      if (
        err instanceof dal.volunteerInterests.VolunteerCategoryNotFoundError ||
        err instanceof dal.volunteerInterests.InactiveVolunteerCategoryError
      ) {
        res.status(409).json({ message: "The volunteer interest choices changed. Refresh the page and try again." });
        return;
      }
      if (err instanceof dal.volunteerAlerts.VolunteerAlertSupporterOnlyError) {
        res.status(403).json({ message: "Matching volunteer alerts are available only for supporter profiles." });
        return;
      }
      next(err);
    }
  });

  // ---- Guard demonstration the admin lane replaces with real surfaces.
  app.get("/api/admin/ping", requireStaff, (req: Request, res: Response) => {
    res.json({ ok: true, scope: "staff" });
  });

  // ---- Image serving through the storage adapter (stable app URLs).
  app.get("/storage/*", async (req: Request, res: Response) => {
    try {
      const image = await storage.readImage(req.path);
      res.setHeader("Content-Type", image.contentType);
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.send(image.data);
    } catch {
      res.status(404).json(NOT_FOUND_BODY);
    }
  });

  // ---- Member-portal API for the MP surfaces (all behind requireOrganization).
  registerMemberRoutes(app);

  // ---- Staff admin API (ADMIN surfaces) behind requireStaff.
  registerAdminRoutes(app);

  // ---- ADMIN-10 Automated emails (staff-admin only).
  registerEmailTemplateAdminRoutes(app);

  // ---- Aggregate request analytics for organization members and staff admins.
  registerEngagementReportingRoutes(app);

  // ---- Public read/write API for the PB surfaces.
  registerPublicRoutes(app);

  // ---- Legacy Wix URLs: 301 on a legacy_wix_id match; otherwise the
  // corresponding browse page (302 — a later import could still match it).
  app.get(LEGACY_ROUTES.itemRequest, async (req: Request, res: Response, next) => {
    try {
      const legacyId = req.params.legacyId ?? "";
      const request = legacyId === "" ? null : await dal.itemRequests.getByLegacyWixId(PUBLIC, legacyId);
      if (request) {
        res.redirect(301, `/items/${request.id}`);
        return;
      }
      res.redirect(302, "/items");
    } catch (err) {
      next(err);
    }
  });
  app.get(LEGACY_ROUTES.volunteerRequest, async (req: Request, res: Response, next) => {
    try {
      const legacyId = req.params.legacyId ?? "";
      const request = legacyId === "" ? null : await dal.volunteerRequests.getByLegacyWixId(PUBLIC, legacyId);
      if (request) {
        res.redirect(301, `/volunteer/${request.id}`);
        return;
      }
      res.redirect(302, "/volunteer");
    } catch (err) {
      next(err);
    }
  });

  // ---- Unknown API routes: the same body the staff guard returns.
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json(NOT_FOUND_BODY);
  });
}
