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
import { sendEmail, absoluteUrl, EMAIL_HEADER_PATH } from "../email/send";
import { finalizeHtml } from "../email/render";
import { renderMagicLinkEmail } from "../email/templates/auth-magic-link";

/**
 * Absolute base URL for auth links and redirects. APP_BASE_URL wins when set
 * (required in production); in the Replit workspace the current dev domain is
 * the correct default.
 */
export function appBaseUrl(): string {
  const explicit = process.env.APP_BASE_URL;
  if (explicit && explicit.trim() !== "") return explicit.trim().replace(/\/+$/, "");
  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (devDomain && devDomain.trim() !== "") return `https://${devDomain.trim()}`;
  return "http://localhost:5000";
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
        // LIA header banner: same slot-swap the product path uses (send.ts).
        const html = finalizeHtml(rendered.html, absoluteUrl(EMAIL_HEADER_PATH));
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
