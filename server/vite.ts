/**
 * Vite integration: middleware mode in development (single port, HMR through
 * the Replit proxy), prebuilt static files in production.
 */
import type { Express } from "express";
import type { Server } from "node:http";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { sharePreviewFor, applySharePreview } from "./share-preview";

export async function setupVite(app: Express, server: Server): Promise<void> {
  const { createServer } = await import("vite");
  const vite = await createServer({
    configFile: path.resolve(import.meta.dirname, "..", "vite.config.ts"),
    appType: "custom",
    server: {
      middlewareMode: true,
      hmr: { server },
      // The preview iframe reaches the dev server through the Replit proxy,
      // which presents a different Host header on every workspace.
      allowedHosts: true,
    },
  });
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    try {
      const templatePath = path.resolve(import.meta.dirname, "..", "client", "index.html");
      const template = fs.readFileSync(templatePath, "utf8");
      const html = await vite.transformIndexHtml(req.originalUrl, template);
      // Share previews for the three public detail surfaces. Every other path
      // — and any record that does not resolve — gets this HTML untouched.
      const preview = await sharePreviewFor(req.originalUrl);
      const body = preview ? applySharePreview(html, preview) : html;
      res.status(200).setHeader("Content-Type", "text/html").send(body);
    } catch (err) {
      vite.ssrFixStacktrace(err as Error);
      next(err);
    }
  });
}

export function serveStatic(app: Express): void {
  const dist = path.resolve(import.meta.dirname, "..", "dist", "public");
  if (!fs.existsSync(dist)) {
    throw new Error(`Production build not found at ${dist}. Run \`npm run build\` first.`);
  }
  app.use(express.static(dist));
  const indexPath = path.resolve(dist, "index.html");
  // Read once: the built shell cannot change while the process is running.
  const indexHtml = fs.readFileSync(indexPath, "utf8");
  app.use("*", (req, res) => {
    // Same share-preview handling as the dev path, so link previews cannot
    // work in the workspace and silently fail on the deployed site.
    void sharePreviewFor(req.originalUrl)
      .then((preview) => {
        if (!preview) {
          res.sendFile(indexPath);
          return;
        }
        res.status(200).setHeader("Content-Type", "text/html").send(applySharePreview(indexHtml, preview));
      })
      .catch(() => {
        res.sendFile(indexPath);
      });
  });
}
