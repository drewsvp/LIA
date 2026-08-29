import { HEADER_IMAGE_MARKER, escapeHtml, getBrand } from "../render";

export function renderProfileEmailChange(vars: {
  firstName: string;
  url: string;
}): { subject: string; html: string; text: string } {
  const brand = getBrand();
  const subject = `Confirm your new email for ${brand.programName}`;
  const text = [
    `Hi ${vars.firstName},`,
    "",
    "Open the page below, then press Confirm email. The link expires in one hour.",
    "",
    vars.url,
    "",
    "If you did not make this change, ignore this email and your current sign-in address will remain active.",
  ].join("\n");
  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f5f5f5;font-family:${escapeHtml(brand.fontStack)};color:#333;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:5px;padding:32px;">
    ${HEADER_IMAGE_MARKER}
    <h1 style="color:${escapeHtml(brand.primaryColor)};font-size:20px;">Confirm your new email</h1>
    <p>Hi ${escapeHtml(vars.firstName)},</p>
    <p>Open the confirmation page, then press <strong>Confirm email</strong>. This link expires in one hour.</p>
    <p><a href="${escapeHtml(vars.url)}" style="display:inline-block;background:rgb(2,146,143);color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:5px;">Confirm email</a></p>
    <p style="font-size:12px;color:#666;">If you did not make this change, ignore this email and your current sign-in address will remain active.</p>
  </div>
</body></html>`;
  return { subject, html, text };
}