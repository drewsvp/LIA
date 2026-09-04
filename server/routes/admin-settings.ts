/**
 * ADMIN-13 — Settings (staff-admin only, STAFF_ADMIN_ONLY_SURFACES lockstep).
 *
 * Three editable site-wide copy fields: site name, public contact email, and
 * response-time language. All backed by the site_settings singleton table.
 *
 * Also hosts the public GET /api/site-settings endpoint consumed by member and
 * public pages (no auth required — reads from in-process cache only).
 */
import type { Express, Request, Response } from "express";
import { requireStaffAdmin, staffContext } from "../auth/guards";
import * as dal from "../dal";
import { getBrand } from "../email/render";
import type { DbContext } from "../db/client";

const EMAILISH_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SAVE_FAILURE = "That did not save. Nothing was changed.";

function staffCtx(req: Request): DbContext {
  return { kind: "staff", userId: staffContext(req).userId };
}

export function registerSettingsAdminRoutes(app: Express): void {
  // ---- Public endpoint: returns settings needed by client pages.
  // No auth required — reads from in-process cache, no DB hit.
  app.get("/api/site-settings", (_req: Request, res: Response) => {
    const site = dal.siteSettings.getCachedSiteSettings();
    const brand = getBrand();
    res.json({
      siteName: site.siteName,
      contactEmail: site.contactEmail,
      responseTimeLanguage: site.responseTimeLanguage,
      imageGenerationEnabled: site.imageGenerationEnabled,
      directorName: brand.directorName,
      directorEmail: brand.directorEmail,
    });
  });

  // ---- Read the current site settings row (admin).
  app.get("/api/admin/site-settings", requireStaffAdmin, async (req: Request, res: Response, next) => {
    try {
      const settings = await dal.siteSettings.getSiteSettingsAdmin(staffCtx(req));
      res.json({ settings });
    } catch (err) {
      next(err);
    }
  });

  // ---- Save site settings. All three fields are required.
  app.put("/api/admin/site-settings", requireStaffAdmin, async (req: Request, res: Response, next) => {
    try {
      const body = req.body as Record<string, unknown>;
      const errors: string[] = [];

      if (typeof body.siteName !== "string" || body.siteName.trim() === "") {
        errors.push("Site name is required.");
      }
      if (typeof body.contactEmail !== "string" || !EMAILISH_RE.test(body.contactEmail.trim())) {
        errors.push("Contact email must be a valid email address.");
      }
      if (typeof body.responseTimeLanguage !== "string" || body.responseTimeLanguage.trim() === "") {
        errors.push("Response-time language is required.");
      }
      if (typeof body.imageGenerationEnabled !== "boolean") {
        errors.push("Image generation setting must be on or off.");
      }

      if (errors.length > 0) {
        res.status(400).json({ message: "Settings were not saved.", errors });
        return;
      }

      const saved = await dal.siteSettings.upsertSiteSettings(staffCtx(req), {
        siteName: (body.siteName as string).trim(),
        contactEmail: (body.contactEmail as string).trim(),
        responseTimeLanguage: (body.responseTimeLanguage as string).trim(),
        imageGenerationEnabled: body.imageGenerationEnabled as boolean,
        updatedByUserId: staffContext(req).userId,
      });
      res.json({ ok: true, settings: saved });
    } catch (err) {
      next(err);
    }
  });

  // ---- Reset site settings to the hardcoded defaults.
  app.post("/api/admin/site-settings/reset", requireStaffAdmin, async (req: Request, res: Response, next) => {
    try {
      const saved = await dal.siteSettings.resetSiteSettingsToDefaults(
        staffCtx(req),
        staffContext(req).userId,
      );
      res.json({ ok: true, settings: saved });
    } catch (err) {
      next(err);
    }
  });
}
