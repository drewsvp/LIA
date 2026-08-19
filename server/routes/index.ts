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
import { magicLinkEmailLimiter, magicLinkIpLimiter } from "../auth/rate-limit";
import { PUBLIC, SYSTEM, pool } from "../db/client";
import * as usersDal from "../dal/users";
import * as dal from "../dal";
import * as storage from "../storage/object-storage";
import { LEGACY_ROUTES } from "../../shared/routes";
import { registerPublicRoutes } from "./public";
import { registerMemberRoutes } from "./member";
import { registerAdminRoutes } from "./admin";
import { registerEmailTemplateAdminRoutes } from "./admin-email-templates";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
      const [pledges, signups] = await Promise.all([
        dal.pledges.listByPerson(SYSTEM, personId),
        dal.signups.listByPerson(SYSTEM, personId),
      ]);
      res.json({
        firstName: session.user.firstName,
        lastName: session.user.lastName,
        email: session.user.email,
        pledges,
        signups,
      });
    } catch (err) {
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
