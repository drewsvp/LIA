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
import type { Express, Request, Response } from "express";
import { toNodeHandler } from "better-auth/node";
import { auth } from "../auth/auth";
import { resolveSessionInfo, ACTIVE_ORG_COOKIE } from "../auth/session";
import { NOT_FOUND_BODY, requireStaff } from "../auth/guards";
import { magicLinkEmailLimiter, magicLinkIpLimiter } from "../auth/rate-limit";
import { PUBLIC } from "../db/client";
import * as dal from "../dal";
import * as storage from "../storage/object-storage";
import { LEGACY_ROUTES } from "../../shared/routes";
import { registerPublicRoutes } from "./public";
import { registerMemberRoutes } from "./member";
import { registerAdminRoutes } from "./admin";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
