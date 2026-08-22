/**
 * Better Auth, self-hosted in the project Postgres (D40): passwordless magic
 * link only. The provider's tables ("user", "session", "account",
 * "verification") are auth plumbing owned by Better Auth; the application
 * links through users.auth_subject and nothing outside this directory (plus
 * dal/auth-provider.ts) knows which provider is in use.
 *
 * Login non-disclosure: the magic-link send callback silently skips emails
 * that do not belong to a registered, non-disabled user, so the wrapper
 * endpoint can return an identical response either way.
 */
import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { pool, SYSTEM } from "../db/client";
import * as usersDal from "../dal/users";
import * as authProvider from "../dal/auth-provider";
import { sendEmail, EMAIL_HEADER_CID_URL, getEmailHeaderAttachment } from "../email/send";
import { finalizeHtml } from "../email/render";
import { renderMagicLinkEmail } from "../email/templates/auth-magic-link";

/**
 * Absolute base URL for auth links and redirects.
 *
 * Resolution order:
 *  1. APP_BASE_URL env var (explicit override — required for custom domains).
 *  2. REPLIT_DOMAINS (first entry) when running as a Replit deployment
 *     (REPLIT_DEPLOYMENT=1).  This is the published app's canonical origin.
 *  3. REPLIT_DEV_DOMAIN — the workspace dev-tunnel URL.
 *  4. http://localhost:5000 — last-resort local fallback.
 */
export function appBaseUrl(): string {
  const explicit = process.env.APP_BASE_URL;
  if (explicit && explicit.trim() !== "") return explicit.trim().replace(/\/+$/, "");

  // Replit deployment: REPLIT_DOMAINS holds the production hostname(s).
  const isDeployment = process.env.REPLIT_DEPLOYMENT === "1";
  const replitDomains = process.env.REPLIT_DOMAINS;
  if (isDeployment && replitDomains && replitDomains.trim() !== "") {
    const first = replitDomains.split(",")[0]?.trim();
    if (first) return `https://${first}`;
  }

  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (devDomain && devDomain.trim() !== "") return `https://${devDomain.trim()}`;
  return "http://localhost:5000";
}

/**
 * Origins that Better Auth will accept for cross-origin auth requests
 * (sign-out, magic-link, etc.).  Always includes the resolved base URL.
 * Additional comma-separated origins can be injected via TRUSTED_ORIGINS.
 */
export function authTrustedOrigins(): string[] {
  const origins = new Set<string>();
  origins.add(appBaseUrl());

  // All Replit-managed domains for this deployment (including custom domains)
  // are in REPLIT_DOMAINS as a comma-separated list.  Trust every entry so
  // that auth requests from any served domain (e.g. a custom domain alongside
  // the default *.replit.app domain) are accepted.
  const replitDomains = process.env.REPLIT_DOMAINS;
  if (replitDomains) {
    for (const d of replitDomains.split(",")) {
      const trimmed = d.trim();
      if (trimmed) origins.add(`https://${trimmed}`);
    }
  }

  // In the workspace, also trust the dev-tunnel origin so that local testing
  // works alongside a configured APP_BASE_URL or production domain.
  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (devDomain && devDomain.trim() !== "") origins.add(`https://${devDomain.trim()}`);

  // Extra origins from env (e.g. staging domains, custom domains not in REPLIT_DOMAINS).
  const extra = process.env.TRUSTED_ORIGINS;
  if (extra) {
    for (const o of extra.split(",")) {
      const trimmed = o.trim().replace(/\/+$/, "");
      if (trimmed) origins.add(trimmed);
    }
  }

  return [...origins];
}

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set. Auth cannot start without it.");
  return secret;
}

export const auth = betterAuth({
  database: pool,
  secret: sessionSecret(),
  baseURL: appBaseUrl(),
  trustedOrigins: authTrustedOrigins(),
  emailAndPassword: { enabled: false },
  plugins: [
    magicLink({
      expiresIn: 60 * 15,
      sendMagicLink: async ({ email, url }) => {
        // Gate: only registered app users get a link. Unknown or disabled
        // accounts are skipped silently — same outward behavior either way.
        const user = await usersDal.findByEmail(SYSTEM, email);
        if (!user || user.status === "disabled") return;
        const rendered = renderMagicLinkEmail({ firstName: user.firstName, url });
        // LIA header banner: embedded via CID so mail clients never need to
        // fetch from the app's origin (same approach as product sends).
        const html = finalizeHtml(rendered.html, EMAIL_HEADER_CID_URL);
        await sendEmail({
          templateKey: "auth_magic_link",
          toEmail: email,
          toPersonId: user.personId,
          // No entity binding: login links are repeatable by design.
          entityType: null,
          entityId: null,
          payload: { userId: user.id },
          subject: rendered.subject,
          html,
          text: rendered.text,
          attachments: [await getEmailHeaderAttachment()],
        });
      },
    }),
  ],
  databaseHooks: {
    session: {
      create: {
        after: async (session) => {
          // Successful authentication: link users.auth_subject to the
          // provider's stable subject id and stamp last_login_at.
          try {
            const email = await authProvider.getAuthUserEmail(session.userId);
            if (!email) return;
            const appUser = await usersDal.findByEmail(SYSTEM, email);
            if (!appUser || appUser.status === "disabled") return;
            if (appUser.authSubject !== session.userId) {
              await usersDal.linkAuthSubject(SYSTEM, appUser.id, session.userId);
            }
            await usersDal.setLastLoginAt(SYSTEM, appUser.id);
          } catch (err) {
            // Linking must never break login; it is retried on next session.
            console.error("auth: session-create linking failed:", err);
          }
        },
      },
    },
  },
});
