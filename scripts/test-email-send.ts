/**
 * One-shot diagnostic: send a magic-link email through the live Postmark
 * provider and print the email_log outcome.
 *
 * Usage (from workspace root):
 *   npx tsx scripts/test-email-send.ts <recipient>
 *
 * In Postmark "pending approval" mode the recipient must share the same
 * domain as EMAIL_FROM_ADDRESS.  Pass a real inbox you can check.
 */
import { sendEmail } from "../server/email/send";
import { renderMagicLinkEmail } from "../server/email/templates/auth-magic-link";
import * as emailLog from "../server/dal/email-log";
import { SYSTEM } from "../server/db/client";

async function main() {
  const toEmail = process.argv[2];
  if (!toEmail) {
    console.error("Usage: npx tsx scripts/test-email-send.ts <recipient-email>");
    process.exit(1);
  }

  const fromAddress = process.env.EMAIL_FROM_ADDRESS;
  const serverToken = process.env.POSTMARK_SERVER_TOKEN;
  console.log("From address :", fromAddress ?? "(not set)");
  console.log("Token set    :", !!serverToken);
  console.log("Sending to   :", toEmail);
  console.log("");

  const fakeUrl = `${process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://localhost:5000"}/auth/magic-link?token=test-diagnostic-token`;
  const rendered = renderMagicLinkEmail({ firstName: "Drew", url: fakeUrl });

  try {
    const result = await sendEmail({
      templateKey: "auth_magic_link",
      toEmail,
      toPersonId: null,
      entityType: null,
      entityId: null,
      payload: { diagnostic: true },
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    if (result.outcome === "sent") {
      console.log("✓ SENT — email_log id  :", result.emailLogId);
      console.log("✓ Postmark MessageID  :", result.providerMessageId);

      const row = await emailLog.getById(SYSTEM, result.emailLogId);
      console.log("✓ DB status           :", row?.status);
      console.log("✓ DB providerMessageId:", row?.providerMessageId);
    } else {
      console.log("Outcome:", result.outcome);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("✗ Send failed:", msg);
    process.exit(1);
  }
}

main();
