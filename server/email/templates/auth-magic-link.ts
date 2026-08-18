/**
 * Magic-link login email. This is new auth infrastructure (D40 replaced the
 * legacy password flow), so it has no captured legacy copy; wording is
 * intentionally minimal. Design tokens from docs/Design.md.
 *
 * Carries the shared LIA header banner slot: like the product templates, the
 * html embeds HEADER_IMAGE_MARKER and the caller (auth.ts) swaps in the
 * absolute image URL via finalizeHtml() before sending.
 */
import { HEADER_IMAGE_MARKER } from "../render";

export type MagicLinkEmailVars = {
  firstName: string;
  url: string;
};

export function renderMagicLinkEmail(vars: MagicLinkEmailVars): { subject: string; html: string; text: string } {
  const subject = "Your sign-in link for Love in Action";
  const text = [
    `Hi ${vars.firstName},`,
    "",
    "Use the link below to sign in to the Love in Action member portal. It expires in 15 minutes.",
    "",
    vars.url,
    "",
    "If you did not request this link, you can ignore this email.",
    "The Alliance",
  ].join("\n");
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:'Open Sans',Arial,sans-serif;color:#333333;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:5px;padding:32px;">
      ${HEADER_IMAGE_MARKER}
      <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:rgb(6,54,93);">Sign in to Love in Action</h1>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">Hi ${escapeHtml(vars.firstName)},</p>
      <p style="margin:0 0 24px;font-size:14px;line-height:1.6;">
        Use the button below to sign in to the member portal. This link expires in 15 minutes.
      </p>
      <p style="margin:0 0 24px;">
        <a href="${vars.url}"
           style="display:inline-block;background:rgb(2,146,143);color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 24px;border-radius:5px;">
          Sign in
        </a>
      </p>
      <p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:#666666;">
        If the button does not work, copy this link into your browser:
      </p>
      <p style="margin:0 0 24px;font-size:12px;line-height:1.6;word-break:break-all;">
        <a href="${vars.url}" style="color:rgb(2,146,143);">${vars.url}</a>
      </p>
      <p style="margin:0;font-size:12px;color:#666666;">
        If you did not request this link, you can ignore this email.<br />The Alliance
      </p>
    </div>
  </body>
</html>`;
  return { subject, html, text };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
