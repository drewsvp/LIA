/**
 * Regression coverage for the authenticated self-service profile.
 *
 * Uses the three seeded account types and temporary history rows. Contact
 * changes are restored in finally so a failed assertion cannot leave a seeded
 * login renamed.
 */
import { createHash, randomUUID } from "node:crypto";
import { auth } from "../server/auth/auth";
import { pool } from "../server/db/client";
import * as users from "../server/dal/users";
import { SYSTEM } from "../server/db/client";
import { FixedWindowLimiter } from "../server/auth/rate-limit";

const BASE = "http://localhost:5000";
const runId = `${process.pid}-${Date.now()}`;
const emails = {
  staff: "tiffany@defendingthecause.org",
  member: "dana@heartsandhands.example.org",
  supporter: "supporter@example.org",
} as const;

type Json = Record<string, unknown>;
type Profile = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  pledges: Array<{ id: string }>;
  signups: Array<{ id: string }>;
  recentlyViewed: Array<{ requestKind: string; requestId: string }>;
  volunteerInterests: unknown[];
  matchingVolunteerAlertsEligible: boolean;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
  console.log(`  ✓ ${message}`);
}

function cookieHeader(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (headers.get("set-cookie") ?? "").split(/,(?=\s*\w+=)/);
  return values.map((value) => value.split(";")[0]).join("; ");
}

async function mintCookie(email: string, label: string): Promise<string> {
  const token = `zz-profile-${runId}-${label}`;
  await pool.query(
    `insert into verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
     values (gen_random_uuid(), $1, $2, now() + interval '2 minutes', now(), now())`,
    [token, JSON.stringify({ email })],
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response: Response = await (auth.api as any).magicLinkVerify({
    query: { token, callbackURL: "/profile" },
    headers: new Headers(),
    asResponse: true,
  });
  const cookie = cookieHeader(response);
  assert(cookie.includes("session_token"), `${label} session is established`);
  return cookie;
}

async function request(
  path: string,
  options: { cookie?: string; method?: string; body?: Json } = {},
): Promise<{ response: Response; body: Json }> {
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.body ? { "content-type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let body: Json = {};
  try {
    body = (await response.json()) as Json;
  } catch {
    // Assertions below report the status and expected shape.
  }
  return { response, body };
}

async function main(): Promise<void> {
  console.log("Self-service profile regression checks");
  const dispatchLimiter = new FixedWindowLimiter(1, 60_000);
  assert(dispatchLimiter.consume("user:target"), "the first email-change confirmation is allowed");
  assert(!dispatchLimiter.consume("user:target"), "a repeated confirmation send is bounded by cooldown");
  dispatchLimiter.resetKey("user:target");
  assert(dispatchLimiter.consume("user:target"), "a legitimate retry is allowed after the cooldown bucket resets");
  const [staff, member, supporter] = await Promise.all([
    users.findByEmail(SYSTEM, emails.staff),
    users.findByEmail(SYSTEM, emails.member),
    users.findByEmail(SYSTEM, emails.supporter),
  ]);
  assert(staff?.authSubject, "seeded staff account is linked to Better Auth");
  assert(member?.authSubject, "seeded member account is linked to Better Auth");
  assert(supporter?.authSubject, "seeded supporter account is linked to Better Auth");
  const limiterReset = await request("/api/dev/reset-rate-limits", { method: "POST" });
  assert(limiterReset.response.status === 200, "development email-dispatch limits are reset for an isolated run");

  const originalPerson = await pool.query<{
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
  }>(
    `select first_name as "firstName", last_name as "lastName", email, phone
       from people where id = $1`,
    [supporter.personId],
  );
  const originalAuth = await pool.query<{ name: string; email: string }>(
    `select name, email from "user" where id = $1`,
    [supporter.authSubject],
  );
  const original = originalPerson.rows[0];
  const originalProvider = originalAuth.rows[0];
  assert(original && originalProvider, "supporter identity snapshots are available for safe restoration");

  const pledgeId = randomUUID();
  const signupId = randomUUID();
  const itemViewId = randomUUID();
  const volunteerViewId = randomUUID();
  const changedEmail = `zz.fixture.profile.${runId}@example.org`;

  try {
    const itemTarget = await pool.query<{ requestId: string; itemId: string }>(
      `select r.id as "requestId", i.id as "itemId"
         from item_requests r join items i on i.item_request_id = r.id
        order by r.created_at desc, i.sort_order
        limit 1`,
    );
    const volunteerTarget = await pool.query<{ requestId: string; roleId: string }>(
      `select r.id as "requestId", vr.id as "roleId"
         from volunteer_requests r join volunteer_roles vr on vr.volunteer_request_id = r.id
        order by r.created_at desc, vr.sort_order
        limit 1`,
    );
    const item = itemTarget.rows[0];
    const volunteer = volunteerTarget.rows[0];
    assert(item && volunteer, "seed data contains item and volunteer history targets");

    await pool.query(
      `insert into item_pledges (id, person_id, item_request_id, notes)
       values ($1, $2, $3, 'zz_fixture profile regression')`,
      [pledgeId, supporter.personId, item.requestId],
    );
    await pool.query(
      `insert into item_pledge_lines (item_pledge_id, item_id, quantity)
       values ($1, $2, 1)`,
      [pledgeId, item.itemId],
    );
    await pool.query(
      `insert into volunteer_signups (id, person_id, volunteer_request_id, notes)
       values ($1, $2, $3, 'zz_fixture profile regression')`,
      [signupId, supporter.personId, volunteer.requestId],
    );
    await pool.query(
      `insert into volunteer_signup_roles (volunteer_signup_id, volunteer_role_id)
       values ($1, $2)`,
      [signupId, volunteer.roleId],
    );
    await pool.query(
      `insert into request_engagement_events
         (client_event_id, event_type, request_kind, item_request_id, user_id)
       values ($1, 'detail_view', 'item', $2, $3)`,
      [itemViewId, item.requestId, supporter.id],
    );
    await pool.query(
      `insert into request_engagement_events
         (client_event_id, event_type, request_kind, volunteer_request_id, user_id)
       values ($1, 'detail_view', 'volunteer', $2, $3)`,
      [volunteerViewId, volunteer.requestId, supporter.id],
    );

    const [staffCookie, memberCookie, supporterCookie] = await Promise.all([
      mintCookie(emails.staff, "staff"),
      mintCookie(emails.member, "member"),
      mintCookie(emails.supporter, "supporter"),
    ]);

    console.log("\nProfile access by account type");
    for (const [label, cookie, eligible] of [
      ["staff", staffCookie, false],
      ["member", memberCookie, false],
      ["supporter", supporterCookie, true],
    ] as const) {
      const result = await request("/api/supporter/profile", { cookie });
      assert(result.response.status === 200, `${label} can load their own profile`);
      const profile = result.body as unknown as Profile;
      assert(Array.isArray(profile.pledges) && Array.isArray(profile.signups), `${label} receives self-history lists`);
      assert(Array.isArray(profile.recentlyViewed), `${label} receives recently viewed needs`);
      assert(Array.isArray(profile.volunteerInterests), `${label} receives volunteer interests`);
      assert(profile.matchingVolunteerAlertsEligible === eligible, `${label} retains the correct alert eligibility`);
    }

    const before = (await request("/api/supporter/profile", { cookie: supporterCookie })).body as unknown as Profile;
    assert(before.pledges.some((row) => row.id === pledgeId), "supporter profile includes the fixture donation");
    assert(before.signups.some((row) => row.id === signupId), "supporter profile includes the fixture volunteer signup");
    assert(
      before.recentlyViewed.some((row) => row.requestKind === "item" && row.requestId === item.requestId) &&
        before.recentlyViewed.some(
          (row) => row.requestKind === "volunteer" && row.requestId === volunteer.requestId,
        ),
      "supporter profile includes both fixture recently viewed needs",
    );

    console.log("\nValidation, conflicts, and self-only updates");
    const invalid = await request("/api/supporter/profile/contact", {
      cookie: supporterCookie,
      method: "PUT",
      body: { firstName: "", lastName: original.lastName, email: "not-an-email", phone: "" },
    });
    assert(invalid.response.status === 400 && typeof invalid.body.fieldErrors === "object", "invalid fields return clear validation errors");

    const conflict = await request("/api/supporter/profile/contact", {
      cookie: supporterCookie,
      method: "PUT",
      body: {
        firstName: original.firstName,
        lastName: original.lastName,
        email: member.email,
        phone: original.phone ?? "",
      },
    });
    assert(conflict.response.status === 409, "an email owned by another person is rejected");

    const otherBefore = await pool.query(`select first_name, last_name, email, phone from people where id = $1`, [
      member.personId,
    ]);
    const saved = await request("/api/supporter/profile/contact", {
      cookie: supporterCookie,
      method: "PUT",
      body: {
        personId: member.personId,
        firstName: "Profile",
        lastName: "Regression",
        email: original.email,
        phone: "555-0109",
      },
    });
    assert(saved.response.status === 200, "valid personal contact information saves");
    const otherAfter = await pool.query(`select first_name, last_name, email, phone from people where id = $1`, [
      member.personId,
    ]);
    assert(
      JSON.stringify(otherAfter.rows) === JSON.stringify(otherBefore.rows),
      "request data cannot redirect a contact update to another person",
    );
    const updated = await pool.query<{ id: string; email: string }>(
      `select id, email from people where id = $1`,
      [supporter.personId],
    );
    assert(updated.rows[0]?.id === supporter.personId && updated.rows[0].email === original.email, "the existing person row is updated in place");
    const provider = await pool.query<{ email: string }>(`select email from "user" where id = $1`, [
      supporter.authSubject,
    ]);
    assert(provider.rows[0]?.email === original.email, "an unconfirmed email cannot replace the login identity");

    const staleToken = `zz-profile-stale-${runId}`;
    await pool.query(
      `insert into verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
       values (gen_random_uuid(), $1, $2, now() + interval '2 minutes', now(), now())`,
      [
        `profile-email-change:${createHash("sha256").update(staleToken).digest("hex")}`,
        JSON.stringify({
          userId: supporter.id,
          personId: supporter.personId,
          authUserId: supporter.authSubject,
          newEmail: changedEmail,
        }),
      ],
    );
    const cancelled = await request("/api/supporter/profile/contact", {
      cookie: supporterCookie,
      method: "PUT",
      body: {
        firstName: "Profile",
        lastName: "Regression",
        email: original.email,
        phone: "555-0109",
      },
    });
    assert(cancelled.response.status === 200, "saving the active email cancels a pending email change");
    const staleConfirmation = await fetch(
      `${BASE}/api/profile/email/confirm?token=${encodeURIComponent(staleToken)}`,
    );
    assert(staleConfirmation.status === 200, "opening a superseded confirmation page does not mutate identity");
    const staleSubmit = await fetch(`${BASE}/api/profile/email/confirm`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: staleToken }),
    });
    assert(staleSubmit.headers.get("location") === "/profile?emailChange=invalid", "a superseded confirmation cannot move the identity");

    const expiredToken = `zz-profile-expired-${runId}`;
    await pool.query(
      `insert into verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
       values (gen_random_uuid(), $1, $2, now() - interval '1 second', now(), now())`,
      [
        `profile-email-change:${createHash("sha256").update(expiredToken).digest("hex")}`,
        JSON.stringify({
          userId: supporter.id,
          personId: supporter.personId,
          authUserId: supporter.authSubject,
          newEmail: changedEmail,
        }),
      ],
    );
    const expired = await fetch(`${BASE}/api/profile/email/confirm`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: expiredToken }),
    });
    assert(expired.headers.get("location") === "/profile?emailChange=invalid", "an expired confirmation cannot move the identity");

    const collisionToken = `zz-profile-collision-${runId}`;
    const collisionIdentifier = `profile-email-change:${createHash("sha256").update(collisionToken).digest("hex")}`;
    const collisionValue = JSON.stringify({
      userId: supporter.id,
      personId: supporter.personId,
      authUserId: supporter.authSubject,
      newEmail: changedEmail,
    });
    await pool.query(
      `insert into verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
       values
         (gen_random_uuid(), $1, $2, now() + interval '2 minutes', now(), now()),
         (gen_random_uuid(), $1, $2, now() + interval '2 minutes', now(), now())`,
      [collisionIdentifier, collisionValue],
    );
    const collision = await fetch(`${BASE}/api/profile/email/confirm`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: collisionToken }),
    });
    assert(collision.headers.get("location") === "/profile?emailChange=invalid", "a duplicate token hash fails closed");
    const collisionIdentity = await pool.query<{ email: string }>(
      `select email from people where id = $1`,
      [supporter.personId],
    );
    assert(collisionIdentity.rows[0]?.email === original.email, "a token collision cannot move another identity");
    await pool.query(`delete from verification where identifier = $1`, [collisionIdentifier]);

    const after = (await request("/api/supporter/profile", { cookie: supporterCookie })).body as unknown as Profile;
    assert(
      after.pledges.some((row) => row.id === pledgeId) && after.signups.some((row) => row.id === signupId),
      "donation and signup history remain attached after the contact edit",
    );

    const unconfirmedToken = `zz-profile-${runId}-unconfirmed-email`;
    await pool.query(
      `insert into verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
       values (gen_random_uuid(), $1, $2, now() + interval '2 minutes', now(), now())`,
      [unconfirmedToken, JSON.stringify({ email: changedEmail })],
    );
    const unconfirmedLogin = await request("/api/login/magic-link/verify", {
      method: "POST",
      body: { token: unconfirmedToken },
    });
    assert(unconfirmedLogin.response.status === 400, "an unconfirmed new email cannot establish a session");

    const confirmationToken = `zz-profile-confirm-${runId}`;
    await pool.query(
      `insert into verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
       values (gen_random_uuid(), $1, $2, now() + interval '2 minutes', now(), now())`,
      [
        `profile-email-change:${createHash("sha256").update(confirmationToken).digest("hex")}`,
        JSON.stringify({
          userId: supporter.id,
          personId: supporter.personId,
          authUserId: supporter.authSubject,
          newEmail: changedEmail,
        }),
      ],
    );
    const inertGet = await fetch(
      `${BASE}/api/profile/email/confirm?token=${encodeURIComponent(confirmationToken)}`,
    );
    assert(inertGet.status === 200, "opening the emailed link is inert until the user confirms");
    const beforeConfirmation = await pool.query<{ email: string }>(`select email from people where id = $1`, [
      supporter.personId,
    ]);
    assert(beforeConfirmation.rows[0]?.email === original.email, "GET scanners cannot transfer the login identity");
    const confirmation = await fetch(`${BASE}/api/profile/email/confirm`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: confirmationToken }),
    });
    assert(
      confirmation.status === 302 && confirmation.headers.get("location") === "/profile?emailChange=confirmed",
      "a valid single-use confirmation transfers the email identity",
    );
    const confirmedPerson = await pool.query<{ email: string }>(`select email from people where id = $1`, [
      supporter.personId,
    ]);
    const confirmedProvider = await pool.query<{ email: string }>(`select email from "user" where id = $1`, [
      supporter.authSubject,
    ]);
    assert(
      confirmedPerson.rows[0]?.email === changedEmail && confirmedProvider.rows[0]?.email === changedEmail,
      "confirmation updates the shared person and login identity atomically",
    );
    const replay = await fetch(`${BASE}/api/profile/email/confirm`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: confirmationToken }),
    });
    assert(replay.headers.get("location") === "/profile?emailChange=invalid", "a confirmation link cannot be replayed");

    const oldToken = `zz-profile-${runId}-old-email`;
    await pool.query(
      `insert into verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
       values (gen_random_uuid(), $1, $2, now() + interval '2 minutes', now(), now())`,
      [oldToken, JSON.stringify({ email: original.email })],
    );
    const oldLogin = await request("/api/login/magic-link/verify", { method: "POST", body: { token: oldToken } });
    assert(oldLogin.response.status === 400, "the old email can no longer establish a session after confirmation");
    await mintCookie(changedEmail, "new-email");
    console.log("  ✓ the new email establishes a future magic-link session");
  } finally {
    await pool.query(`delete from request_engagement_events where client_event_id = any($1::uuid[])`, [
      [itemViewId, volunteerViewId],
    ]);
    await pool.query(`delete from volunteer_signup_roles where volunteer_signup_id = $1`, [signupId]);
    await pool.query(`delete from volunteer_signups where id = $1`, [signupId]);
    await pool.query(`delete from item_pledge_lines where item_pledge_id = $1`, [pledgeId]);
    await pool.query(`delete from item_pledges where id = $1`, [pledgeId]);
    await pool.query(
      `update people
          set first_name = $2, last_name = $3, email = $4, phone = $5
        where id = $1`,
      [supporter.personId, original.firstName, original.lastName, original.email, original.phone],
    );
    await pool.query(
      `update "user" set name = $2, email = $3, "updatedAt" = now() where id = $1`,
      [supporter.authSubject, originalProvider.name, originalProvider.email],
    );
    await pool.query(`delete from verification where identifier like $1`, [`zz-profile-${runId}-%`]);
    await pool.query(`delete from verification where identifier like 'profile-email-change:%' and value like $1`, [
      `%${runId}%`,
    ]);
  }
}

main()
  .then(() => {
    console.log("\nAll self-service profile checks passed.");
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });