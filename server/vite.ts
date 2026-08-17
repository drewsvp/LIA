/**
 * Vite integration: middleware mode in development (single port, HMR through
 * the Replit proxy), prebuilt static files in production.
 */
import type { Express } from "express";
import type { Server } from "node:http";
import fs from "node:fs";
import path from "node:path";
import express from "express";

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
      res.status(200).setHeader("Content-Type", "text/html").send(html);
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
  app.use("*", (_req, res) => {
    res.sendFile(path.resolve(dist, "index.html"));
  });
}
