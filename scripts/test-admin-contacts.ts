/**
 * Regression coverage for ADMIN-04's contact-management extension.
 *
 * This deliberately exercises the public HTTP surface rather than reaching
 * into route handlers.  It creates disposable people, while the one seeded
 * linked account used for the confirmation path is restored in finally.
 *
 * Usage: npm run test:admin-contacts
 * The development server and seeded database must be available.
 */
import { createHash } from "node:crypto";
import { auth } from "../server/auth/auth";
import { pool, SYSTEM, withDbContext } from "../server/db/client";
import * as authProvider from "../server/dal/auth-provider";
import * as people from "../server/dal/people";
import * as users from "../server/dal/users";
import {
  profileEmailChangeCooldownLimiter,
  profileEmailChangeIpLimiter,
  profileEmailChangeTargetLimiter,
  profileEmailChangeUserLimiter,
} from "../server/auth/rate-limit";
import { refundContactEmailSend, reserveContactEmailSend } from "../server/services/contact-email-rate-limit";

const BASE = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : "http://127.0.0.1:5000";
const runId = `${process.pid}-${Date.now()}`;
const marker = `zz.admin-contacts.${runId}`;

type Json = Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function cookieHeader(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookies =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (headers.get("set-cookie") ?? "").split(/,(?=\s*\w+=)/);
  return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

async function session(email: string): Promise<string> {
  const token = `${marker}.${email}`;
  await pool.query(
    `insert into verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
     values (gen_random_uuid(), $1, $2, now() + interval '2 minutes', now(), now())`,
    [token, JSON.stringify({ email })],
  );
  try {
    type MagicLinkApi = {
      magicLinkVerify(input: { query: { token: string; callbackURL: string }; headers: Headers; asResponse: true }): Promise<Response>;
    };
    const response = await (auth.api as unknown as MagicLinkApi).magicLinkVerify({
      query: { token, callbackURL: "/admin/people/review" },
      headers: new Headers(),
      asResponse: true,
    });
    const cookie = cookieHeader(response);
    assert(cookie !== "", `session is minted for ${email}`);
    return cookie;
  } finally {
    await pool.query(`delete from verification where identifier = $1`, [token]);
  }
}

async function request(
  path: string,
  cookie?: string,
  method = "GET",
  body?: Json,
): Promise<{ response: Response; body: Json }> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    redirect: "manual",
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed: Json = {};
  try {
    parsed = (await response.json()) as Json;
  } catch {
    // Some confirmation routes intentionally return an HTML form/redirect.
  }
  return { response, body: parsed };
}

async function main(): Promise<void> {
  console.log("Admin contact-management regression checks");
  const staff = await users.findByEmail(SYSTEM, "tiffany@defendingthecause.org");
  const approver = await users.findByEmail(SYSTEM, "approver@thealliance.example.org");
  const linked = await users.findByEmail(SYSTEM, "supporter@example.org");
  assert(staff && approver && linked?.authSubject, "seeded staff, approver, and linked supporter exist");
  const staffActorName = (
    await pool.query<{ name: string }>(
      `select trim(concat_ws(' ', p.first_name, p.last_name)) as name
         from users u join people p on p.id = u.person_id
        where u.id = $1`,
      [staff.id],
    )
  ).rows[0]?.name;
  assert(staffActorName, "staff administrator name is available");

  const created: string[] = [];
  const staffCookie = await session("tiffany@defendingthecause.org");
  const approverCookie = await session("approver@thealliance.example.org");
  const original = (
    await pool.query<{ firstName: string; lastName: string; email: string; phone: string | null; authEmail: string }>(
      `select p.first_name as "firstName", p.last_name as "lastName", p.email, p.phone, a.email as "authEmail"
         from people p join users u on u.person_id = p.id join "user" a on a.id = u.auth_subject
        where p.id = $1`,
      [linked.personId],
    )
  ).rows[0];
  assert(original, "linked identity snapshot is available for restoration");
  const historicalEmailLog = (
    await pool.query<{ id: string }>(
      `insert into email_log
         (template_key, to_email, to_person_id, entity_type, entity_id, payload, status, sent_at)
       values ('zz_fixture_admin_contact_history', $1, $2, null, null, $3::jsonb, 'sent', now())
       returning id`,
      [original.email, linked.personId, JSON.stringify({ zz_fixture: marker })],
    )
  ).rows[0];
  assert(historicalEmailLog, "historical recipient snapshot fixture is available");

  const unlinked = await withDbContext(SYSTEM, (client) =>
    people.createInTx(client, {
      firstName: "Unlinked",
      lastName: "Contact",
      email: `${marker}.unlinked@example.invalid`,
      phone: "555-0100",
      sourceNote: marker,
    }),
  );
  created.push(unlinked.id);
  const flagged = await withDbContext(SYSTEM, async (client) => {
    const person = await people.createInTx(client, {
      firstName: "Flagged",
      lastName: "Review",
      email: `${marker}.flagged@example.invalid`,
      sourceNote: marker,
    });
    await client.query(`update people set needs_review = true, review_note = $2 where id = $1`, [person.id, marker]);
    return person;
  });
  created.push(flagged.id);
  const mergeDuplicate = await withDbContext(SYSTEM, async (client) => {
    const person = await people.createInTx(client, {
      firstName: "Merge", lastName: "Duplicate", email: `${marker}.merge-duplicate@example.invalid`, sourceNote: marker,
    });
    await client.query(`update people set needs_review = true, review_note = $2 where id = $1`, [person.id, marker]);
    return person;
  });
  const mergeSurvivor = await withDbContext(SYSTEM, (client) =>
    people.createInTx(client, {
      firstName: "Merge", lastName: "Survivor", email: `${marker}.merge-survivor@example.invalid`, sourceNote: marker,
    }),
  );
  created.push(mergeDuplicate.id, mergeSurvivor.id);
  const raceUnlinked = await withDbContext(SYSTEM, (client) =>
    people.createInTx(client, {
      firstName: "Race",
      lastName: "Loser",
      email: `${marker}.race-loser@example.invalid`,
      sourceNote: marker,
    }),
  );
  created.push(raceUnlinked.id);

  try {
    const denied = await request(`/api/admin/people/${unlinked.id}`, approverCookie);
    assert(denied.response.status === 404, "staff approvers cannot open the contacts directory detail");

    const directory = await request(`/api/admin/people?search=${encodeURIComponent(marker)}`, staffCookie);
    assert(directory.response.status === 200, "staff administrators can search the all-contact directory");
    const directoryRows = directory.body.people;
    assert(
      Array.isArray(directoryRows) && directoryRows.some((row) => (row as Json).id === unlinked.id),
      "an unflagged contact is returned by directory search",
    );

    const unflaggedDetail = await request(`/api/admin/people/${unlinked.id}`, staffCookie);
    assert(unflaggedDetail.response.status === 200, "staff administrators can reopen an unflagged contact");

    const unlinkedEmail = `${marker}.renamed@example.invalid`;
    const saved = await request(`/api/admin/people/${unlinked.id}/contact`, staffCookie, "PUT", {
      firstName: "Edited",
      lastName: "Contact",
      email: ` ${unlinkedEmail.toUpperCase()} `,
      phone: "555-0199",
    });
    assert(saved.response.status === 200, "ordinary contact fields save through the unified contact endpoint");
    const unlinkedAfter = await pool.query<{ firstName: string; lastName: string; email: string; phone: string | null }>(
      `select first_name as "firstName", last_name as "lastName", email, phone from people where id = $1`,
      [unlinked.id],
    );
    assert(
      unlinkedAfter.rows[0]?.firstName === "Edited" &&
        unlinkedAfter.rows[0]?.email === unlinkedEmail &&
        unlinkedAfter.rows[0]?.phone === "555-0199",
      "an unlinked person's normalized email and ordinary edits take effect immediately",
    );
    await pool.query(
      `insert into contact_admin_audit (actor_user_id, person_id, action, outcome, details)
       values (null, $1, 'contact_edit', 'success', $2::jsonb)`,
      [unlinked.id, JSON.stringify({ zz_fixture: marker, unavailableActor: true })],
    );
    const editedDetail = await request(`/api/admin/people/${unlinked.id}`, staffCookie);
    assert(
      editedDetail.response.status === 200 && Array.isArray(editedDetail.body.history),
      "contact detail exposes auditable contact-change history",
    );
    const history = editedDetail.body.history as Json[];
    assert(
      history.some((entry) => entry.actorName === staffActorName),
      "contact history identifies the acting administrator",
    );
    assert(
      history.some((entry) => (entry.details as Json | undefined)?.unavailableActor === true && entry.actorName === null),
      "contact history safely represents a deleted or unavailable administrator",
    );

    const collision = await request(`/api/admin/people/${unlinked.id}/contact`, staffCookie, "PUT", {
      firstName: "Edited", lastName: "Contact", email: original.email, phone: "555-0199",
    });
    assert(collision.response.status === 409, "a contact email collision is rejected");
    assert(
      (await pool.query<{ email: string }>(`select email from people where id = $1`, [unlinked.id])).rows[0]?.email === unlinkedEmail,
      "a rejected collision leaves the previous contact identity intact",
    );

    const contestedEmail = `${marker}.contested@example.invalid`;
    const [firstClaim, secondClaim] = await Promise.all([
      request(`/api/admin/people/${unlinked.id}/contact`, staffCookie, "PUT", {
        firstName: "Edited", lastName: "Contact", email: contestedEmail, phone: "555-0199",
      }),
      request(`/api/admin/people/${raceUnlinked.id}/contact`, staffCookie, "PUT", {
        firstName: "Race", lastName: "Loser", email: ` ${contestedEmail.toUpperCase()} `, phone: "",
      }),
    ]);
    assert(
      [firstClaim.response.status, secondClaim.response.status].filter((status) => status === 200).length === 1 &&
        [firstClaim.response.status, secondClaim.response.status].filter((status) => status === 409).length === 1,
      "two simultaneous unlinked normalized-email claims yield exactly one success and one conflict",
    );
    const raceEmails = await pool.query<{ id: string; email: string }>(
      `select id, email from people where id = any($1::uuid[])`,
      [[unlinked.id, raceUnlinked.id]],
    );
    const winner = raceEmails.rows.filter((row) => row.email === contestedEmail);
    const loser = raceEmails.rows.find((row) => row.email !== contestedEmail);
    assert(
      winner.length === 1 &&
        loser !== undefined &&
        loser.email === (loser.id === unlinked.id ? unlinkedEmail : `${marker}.race-loser@example.invalid`),
      "the losing simultaneous claimant retains its original email",
    );

    const requestedEmail = `${marker}.linked@example.invalid`;
    const pending = await request(`/api/admin/people/${linked.personId}/contact`, staffCookie, "PUT", {
      firstName: "Linked", lastName: "Edited", email: requestedEmail, phone: "555-0188",
    });
    assert(
      (pending.response.status === 200 && pending.body.pendingEmail === requestedEmail) ||
        pending.response.status === 502,
      "linked email changes either remain pending or report provider delivery failure",
    );
    const beforeConfirm = await pool.query<{ personEmail: string; authEmail: string }>(
      `select p.email as "personEmail", a.email as "authEmail" from people p join users u on u.person_id = p.id join "user" a on a.id = u.auth_subject where p.id = $1`,
      [linked.personId],
    );
    assert(beforeConfirm.rows[0]?.personEmail === original.email && beforeConfirm.rows[0]?.authEmail === original.authEmail,
      "pending confirmation does not partially move either identity store");

    if (pending.response.status === 502) {
      const failedPending = await pool.query(
        `select id from verification
          where identifier like 'profile-email-change:%'
            and value is json object
            and value::jsonb ->> 'personId' = $1`,
        [linked.personId],
      );
      assert(failedPending.rows.length === 0, "a failed confirmation send removes the unusable pending token");
    }

    const controlToken = `${marker}.controls`;
    await pool.query(
      `insert into verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
       values (gen_random_uuid(), $1, $2, now() + interval '1 hour', now(), now())`,
      [
        `profile-email-change:${createHash("sha256").update(controlToken).digest("hex")}`,
        JSON.stringify({
          userId: linked.id,
          personId: linked.personId,
          authUserId: linked.authSubject,
          newEmail: requestedEmail,
          initiatedByUserId: staff.id,
        }),
      ],
    );
    await fetch(`${BASE}/api/dev/reset-rate-limits`, { method: "POST" });
    const resend = await request(`/api/admin/people/${linked.personId}/email/resend`, staffCookie, "POST");
    assert(
      resend.response.status === 200 || resend.response.status === 502,
      "an administrator can request a replacement for the one pending confirmation",
    );
    if (resend.response.status === 502) {
      assert(
        (await pool.query(
          `select id from verification
            where identifier like 'profile-email-change:%'
              and value is json object
              and value::jsonb ->> 'personId' = $1`,
          [linked.personId],
        )).rows.length === 0,
        "a failed resend cleans up the replacement token",
      );
    }
    await pool.query(
      `insert into verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
       values (gen_random_uuid(), $1, $2, now() + interval '1 hour', now(), now())`,
      [
        `profile-email-change:${createHash("sha256").update(`${marker}.cancel`).digest("hex")}`,
        JSON.stringify({
          userId: linked.id,
          personId: linked.personId,
          authUserId: linked.authSubject,
          newEmail: requestedEmail,
          initiatedByUserId: staff.id,
        }),
      ],
    );
    const cancelled = await request(`/api/admin/people/${linked.personId}/email/cancel`, staffCookie, "POST");
    assert(cancelled.response.status === 200, "an administrator can cancel a pending confirmation");

    // Exercise the same reservation helper used by both admin endpoints.
    profileEmailChangeUserLimiter.resetAll();
    profileEmailChangeTargetLimiter.resetAll();
    profileEmailChangeIpLimiter.resetAll();
    profileEmailChangeCooldownLimiter.resetAll();
    const limiterTarget = `${marker}.rate-limit@example.invalid`;
    assert(
      reserveContactEmailSend(linked.id, limiterTarget, marker),
      "the first contact email send reserves every rate-limit budget",
    );
    assert(
      !reserveContactEmailSend(linked.id, limiterTarget, marker),
      "the shared contact email send helper enforces the one-minute cooldown",
    );
    refundContactEmailSend(linked.id, limiterTarget, marker);
    assert(
      reserveContactEmailSend(linked.id, limiterTarget, marker),
      "refunding a failed contact email send permits an immediate retry",
    );
    profileEmailChangeUserLimiter.resetAll();
    profileEmailChangeTargetLimiter.resetAll();
    profileEmailChangeIpLimiter.resetAll();
    profileEmailChangeCooldownLimiter.resetAll();

    // The local regression environment deliberately has no delivery provider;
    // the first request must therefore take the route's send-failure branch.
    // Its immediate retry proves all four limiter reservations were refunded,
    // rather than being rejected by the one-minute cooldown.
    const failedTarget = `${marker}.send-failure@example.invalid`;
    const sendFailure = await request(`/api/admin/people/${linked.personId}/contact`, staffCookie, "PUT", {
      firstName: "Linked", lastName: "Edited", email: failedTarget, phone: "555-0188",
    });
    assert(sendFailure.response.status === 502, "a delivery failure is reported after saving ordinary contact fields");
    const refundedRetry = await request(`/api/admin/people/${linked.personId}/contact`, staffCookie, "PUT", {
      firstName: "Linked", lastName: "Edited", email: failedTarget, phone: "555-0188",
    });
    assert(refundedRetry.response.status !== 429, "a failed delivery refunds the route rate-limit reservation for immediate retry");

    const concurrentTargetA = `${marker}.pending-a@example.invalid`;
    const concurrentTargetB = `${marker}.pending-b@example.invalid`;
    await Promise.all([
      withDbContext(SYSTEM, (client) => authProvider.createProfileEmailChangeInTx(client, {
        userId: linked.id, personId: linked.personId, authUserId: linked.authSubject!,
        newEmail: concurrentTargetA, tokenHash: createHash("sha256").update(`${marker}.pending-a`).digest("hex"),
      })),
      withDbContext(SYSTEM, (client) => authProvider.createProfileEmailChangeInTx(client, {
        userId: linked.id, personId: linked.personId, authUserId: linked.authSubject!,
        newEmail: concurrentTargetB, tokenHash: createHash("sha256").update(`${marker}.pending-b`).digest("hex"),
      })),
    ]);
    const activePending = await pool.query<{ newEmail: string }>(
      `select value::jsonb ->> 'newEmail' as "newEmail"
         from verification
        where identifier like 'profile-email-change:%'
          and value is json object
          and value::jsonb ->> 'userId' = $1`,
      [linked.id],
    );
    assert(
      activePending.rows.length === 1 && [concurrentTargetA, concurrentTargetB].includes(activePending.rows[0]?.newEmail ?? ""),
      "concurrent pending-change writes for one account leave exactly one active token",
    );

    let rollbackError = false;
    try {
      await withDbContext(SYSTEM, async (client) => {
        await people.updateEmailInTx(client, linked.personId, `${marker}.rollback@example.invalid`);
        await authProvider.updateUserContactInTx(
          client,
          "00000000-0000-0000-0000-000000000000",
          `${marker}.rollback@example.invalid`,
          "Rollback Expected",
        );
      });
    } catch {
      rollbackError = true;
    }
    assert(rollbackError, "a forced Better Auth write failure aborts the identity transaction");
    await unchangedIdentity("a failed atomic identity update");
    const pendingAfterRollback = await pool.query(
      `select id from verification
        where identifier like 'profile-email-change:%'
          and value is json object
          and value::jsonb ->> 'userId' = $1`,
      [linked.id],
    );
    assert(pendingAfterRollback.rows.length === 1, "a failed identity transaction preserves the preexisting pending token");
    await pool.query(
      `delete from verification
        where identifier like 'profile-email-change:%'
          and value is json object
          and value::jsonb ->> 'userId' = $1`,
      [linked.id],
    );

    async function unchangedIdentity(label: string): Promise<void> {
      const identity = await pool.query<{ personEmail: string; authEmail: string }>(
        `select p.email as "personEmail", a.email as "authEmail" from people p join users u on u.person_id = p.id join "user" a on a.id = u.auth_subject where p.id = $1`,
        [linked!.personId],
      );
      assert(
        identity.rows[0]?.personEmail === original!.email && identity.rows[0]?.authEmail === original!.authEmail,
        `${label} leaves both identity stores unchanged`,
      );
    }
    const expiredToken = `${marker}.expired`;
    await pool.query(
      `insert into verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
       values (gen_random_uuid(), $1, $2, now() - interval '1 second', now(), now())`,
      [`profile-email-change:${createHash("sha256").update(expiredToken).digest("hex")}`, JSON.stringify({
        userId: linked.id, personId: linked.personId, authUserId: linked.authSubject, newEmail: requestedEmail,
      })],
    );
    const expired = await fetch(`${BASE}/api/profile/email/confirm`, {
      method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: expiredToken }),
    });
    assert(expired.headers.get("location")?.includes("invalid"), "an expired pending email token fails closed");
    await unchangedIdentity("an expired token");

    const collisionToken = `${marker}.collision`;
    const collisionIdentifier = `profile-email-change:${createHash("sha256").update(collisionToken).digest("hex")}`;
    const collisionValue = JSON.stringify({
      userId: linked.id, personId: linked.personId, authUserId: linked.authSubject, newEmail: requestedEmail,
    });
    await pool.query(
      `insert into verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
       values (gen_random_uuid(), $1, $2, now() + interval '2 minutes', now(), now()),
              (gen_random_uuid(), $1, $2, now() + interval '2 minutes', now(), now())`,
      [collisionIdentifier, collisionValue],
    );
    const duplicateToken = await fetch(`${BASE}/api/profile/email/confirm`, {
      method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: collisionToken }),
    });
    assert(duplicateToken.headers.get("location")?.includes("invalid"), "a duplicate confirmation token fails closed");
    await unchangedIdentity("a duplicate token");
    await pool.query(`delete from verification where identifier = $1`, [collisionIdentifier]);

    // The confirmation handler consumes the same generic pending-email row.
    // Insert a deterministic fixture token so this test never needs to read a
    // real email delivery body.
    const token = `${marker}.confirm`;
    const hash = createHash("sha256").update(token).digest("hex");
    await pool.query(
      `insert into verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
       values (gen_random_uuid(), $1, $2, now() + interval '2 minutes', now(), now())`,
      [`profile-email-change:${hash}`, JSON.stringify({
        userId: linked.id, personId: linked.personId, authUserId: linked.authSubject, newEmail: requestedEmail,
        initiatedByUserId: staff.id,
      })],
    );
    const confirmed = await fetch(`${BASE}/api/profile/email/confirm`, {
      method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
    assert(confirmed.headers.get("location")?.includes("confirmed"), "a valid pending linked email confirms once");
    const afterConfirm = await pool.query<{ personEmail: string; authEmail: string }>(
      `select p.email as "personEmail", a.email as "authEmail" from people p join users u on u.person_id = p.id join "user" a on a.id = u.auth_subject where p.id = $1`,
      [linked.personId],
    );
    assert(afterConfirm.rows[0]?.personEmail === requestedEmail && afterConfirm.rows[0]?.authEmail === requestedEmail,
      "confirmation updates person and Better Auth identity together");
    const historicalSnapshot = await pool.query<{ toEmail: string }>(
      `select to_email as "toEmail" from email_log where id = $1`,
      [historicalEmailLog.id],
    );
    assert(
      historicalSnapshot.rows[0]?.toEmail === original.email,
      "historical email delivery keeps the address used at send time",
    );
    const replay = await fetch(`${BASE}/api/profile/email/confirm`, {
      method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }),
    });
    assert(replay.headers.get("location")?.includes("invalid"), "a confirmed token cannot be replayed");

    const merged = await request(`/api/admin/people/review/${mergeDuplicate.id}/merge`, staffCookie, "POST", {
      duplicateId: mergeDuplicate.id, survivorId: mergeSurvivor.id, confirm: "MERGE",
    });
    assert(merged.response.status === 200, "existing reviewed-person merge workflow remains available");
    const mergeCheck = await pool.query(`select id from people where id = $1`, [mergeDuplicate.id]);
    assert(mergeCheck.rows.length === 0, "merge still removes only the selected duplicate record");

    const cleared = await request(`/api/admin/people/review/${flagged.id}/clear-flag`, staffCookie, "POST");
    assert(cleared.response.status === 200, "existing review clear-flag workflow remains available");
  } finally {
    await withDbContext(SYSTEM, async (client) => {
      await client.query(`delete from verification where value like $1`, [`%${marker}%`]);
      await people.updateEmailInTx(client, linked.personId, original.email);
      await client.query(`update people set first_name = $2, last_name = $3, phone = $4 where id = $1`,
        [linked.personId, original.firstName, original.lastName, original.phone]);
      await client.query(`update "user" set email = $2 where id = $1`, [linked.authSubject, original.authEmail]);
      await client.query(`delete from email_log where id = $1`, [historicalEmailLog.id]);
      await client.query(`delete from contact_admin_audit where details ->> 'zz_fixture' = $1`, [marker]);
    });
    if (created.length) await pool.query(`delete from people where id = any($1::uuid[])`, [created]);
  }
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });