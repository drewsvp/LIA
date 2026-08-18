/**
 * Application entry point. One Express server on port 5000 serves the API,
 * the auth handler, storage URLs, legacy redirects, and the SPA shell.
 */
import http from "node:http";
import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import { registerRoutes, checkQuickLoginSeed } from "./routes/index";
import { appBaseUrl, authTrustedOrigins } from "./auth/auth";
import { startExpiryScheduler } from "./jobs/expiry";
import { startEmailSweep } from "./jobs/email-sweep";
import { startDigestScheduler } from "./jobs/digest";
import { setupVite, serveStatic } from "./vite";

const app = express();
app.set("trust proxy", 1);

// Better Auth's handler is registered inside registerRoutes BEFORE these
// parsers would matter — it reads its own request body. JSON parsing applies
// to the application's own /api routes.
const jsonParser = express.json({ limit: "1mb" });
const urlencodedParser = express.urlencoded({ extended: false });
app.use((req, res, next) => {
  if (req.path.startsWith("/api/auth/")) {
    next();
    return;
  }
  jsonParser(req, res, (err) => {
    if (err) {
      next(err);
      return;
    }
    urlencodedParser(req, res, next);
  });
});

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) throw new Error("SESSION_SECRET is not set.");
app.use(cookieParser(sessionSecret));

// Concise API request logging.
app.use((req, res, next) => {
  if (!req.path.startsWith("/api")) {
    next();
    return;
  }
  const startedAt = Date.now();
  res.on("finish", () => {
    console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - startedAt}ms`);
  });
  next();
});

registerRoutes(app);

// Central error handler: loud, JSON, no HTML stack pages.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status =
    typeof err === "object" && err !== null && "status" in err && typeof (err as { status: unknown }).status === "number"
      ? (err as { status: number }).status
      : 500;
  // Review fix: never echo internal error text (SQL, stack fragments) to
  // public clients on 5xx. 4xx errors that carry an explicit status (e.g.
  // body-parser JSON syntax errors) keep their message.
  const message =
    status >= 500 ? "Internal server error" : err instanceof Error ? err.message : "Bad request";
  console.error("request failed:", err);
  if (!res.headersSent) res.status(status).json({ message });
});

const server = http.createServer(app);
const port = 5000;

async function start(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    await setupVite(app, server);
  }
  server.listen({ port, host: "0.0.0.0", reusePort: true }, () => {
    console.log(`serving on port ${port}`);
    // Log auth origin config so misconfiguration is visible in server logs
    // rather than silent 403s on sign-out / magic-link from the wrong domain.
    const baseUrl = appBaseUrl();
    const trusted = authTrustedOrigins();
    const isDeployment = process.env.REPLIT_DEPLOYMENT === "1";
    console.log(`[auth] base URL: ${baseUrl}`);
    console.log(`[auth] trusted origins: ${trusted.join(", ")}`);
    if (isDeployment && (baseUrl.includes("localhost") || baseUrl.includes("replit.dev"))) {
      console.warn(
        "[auth] ⚠  Production deployment resolved to a non-production base URL.\n" +
          "         Set APP_BASE_URL to the published origin (e.g. https://myapp.replit.app)\n" +
          "         or ensure REPLIT_DOMAINS is populated in the deployment environment.",
      );
    }
  });
  startExpiryScheduler();
  startEmailSweep();
  startDigestScheduler();

  // Startup check: warn if quick login is enabled but seed accounts are missing.
  if (process.env.NODE_ENV === "development" || process.env.QUICK_LOGIN_ENABLED === "true") {
    checkQuickLoginSeed()
      .then(({ seeded, missing }) => {
        if (!seeded) {
          console.warn(
            `[quick-login] ⚠  Seed accounts missing: ${missing.join(", ")}.\n` +
              `             Quick login buttons will be disabled until you run: npm run db:seed`,
          );
        }
      })
      .catch(() => {
        // Non-fatal: DB may still be initialising; the per-request check will catch it.
      });
  }
}

start().catch((err) => {
  console.error("failed to start server:", err);
  process.exit(1);
});
