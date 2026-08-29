/**
 * Regression coverage for account email identity.
 *
 * Proves that names are display-only, normalized email is the reuse key,
 * multiple active organization memberships stay on one account, and blocked
 * contact/merge mutations leave every account and membership untouched.
 *
 * Usage: npm run test:account-email-identity
 */
import { pool, q, SYSTEM, withDbContext } from "../server/db/client";
import { auth } from "../server/auth/auth";
import { checkRequiredDbFunctions } from "../server/db/startup-checks";
import * as memberships from "../server/dal/memberships";
import * as people from "../server/dal/people";
import * as users from "../server/dal/users";
import { submitMemberInvite } from "../server/services/member-invite";
import { mergePeople, MergeAccountEmailChangeError } from "../server/services/person-merge";

const runId = `${process.pid}-${Date.now()}`;
const marker = `zz.account-email-identity.${runId}`;
const emailA = `${marker}.a@example.invalid`;
const emailB = `${marker}.b@example.invalid`;
const orphanEmail = `${marker}.orphan@example.invalid`;
const authEmail = `${marker}.auth-mismatch@example.invalid`;
const BASE = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : "http://127.0.0.1:5000";
let authSubject: string | null = null;

const personIds: string[] = [];
const userIds: string[] = [];
const membershipIds: string[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
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

async function mintSessionCookie(email: string): Promise<string> {
  const token = `zz-account-email-identity-${runId}`;
  await pool.query(
    `insert into verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
     values (gen_random_uuid(), $1, $2, now() + interval '2 minutes', now(), now())`,
    [token, JSON.stringify({ email })],
  );
  type MagicLinkApi = {
    magicLinkVerify(input: {
      query: { token: string; callbackURL: string };
      headers: Headers;
      asResponse: true;
    }): Promise<Response>;
  };
  let response: Response;
  try {
    response = await (auth.api as unknown as MagicLinkApi).magicLinkVerify({
      query: { token, callbackURL: "/dashboard" },
      headers: new Headers(),
      asResponse: true,
    });
  } finally {
    await pool.query(`delete from verification where identifier = $1`, [token]);
  }
  assert(response.ok || response.status === 302, "fixture magic-link session is created");
  const cookie = cookieHeader(response);
  assert(cookie !== "", "fixture magic-link session cookie is present");
  return cookie;
}

async function cleanup(): Promise<void> {
  try {
    if (authSubject) {
      await pool.query(`update users set auth_subject = null where auth_subject = $1`, [authSubject]);
      await pool.query(`delete from "session" where "userId" = $1`, [authSubject]);
      await pool.query(`delete from "account" where "userId" = $1`, [authSubject]);
      await pool.query(`delete from "user" where id = $1`, [authSubject]);
    }
    if (membershipIds.length > 0) {
      await pool.query(
        `delete from email_log
          where entity_type = 'org_membership'
            and entity_id = any($1::uuid[])`,
        [membershipIds],
      );
      await pool.query(
        `delete from approval_events
          where entity_type = 'org_membership'
            and entity_id = any($1::uuid[])`,
        [membershipIds],
      );
      await pool.query(`delete from org_memberships where id = any($1::uuid[])`, [membershipIds]);
    }
    if (userIds.length > 0) {
      await pool.query(`delete from users where id = any($1::uuid[])`, [userIds]);
    }
    if (personIds.length > 0) {
      await pool.query(`delete from people where id = any($1::uuid[])`, [personIds]);
    }
  } catch (err) {
    console.error("Fixture cleanup failed:", err);
  }
}

async function main(): Promise<void> {
  console.log("Account email identity regression test");
  console.log("======================================");

  const context = await pool.query<{
    actorUserId: string;
    actorEmail: string;
    orgOneId: string;
    orgTwoId: string;
  }>(
    `select actor.id as "actorUserId",
            actor_person.email as "actorEmail",
            orgs[1] as "orgOneId",
            orgs[2] as "orgTwoId"
       from users actor
       join people actor_person on actor_person.id = actor.person_id
       cross join lateral (
         select array_agg(id order by created_at, id) as orgs
           from organizations
          where kind = 'member_org' and status = 'approved'
       ) approved
      where array_length(orgs, 1) >= 2
      order by actor.created_at
      limit 1`,
  );
  const ids = context.rows[0];
  if (!ids) throw new Error("Seed data missing: two approved member organizations and one user are required.");

  try {
    const inviteAOne = await submitMemberInvite({
      orgId: ids.orgOneId,
      actorUserId: ids.actorUserId,
      actorEmail: ids.actorEmail,
      firstName: "Alex",
      lastName: "Rivera",
      email: `  ${emailA.toUpperCase()}  `,
      phone: "555-0101",
    });
    membershipIds.push(inviteAOne.membershipId);

    const inviteB = await submitMemberInvite({
      orgId: ids.orgOneId,
      actorUserId: ids.actorUserId,
      actorEmail: ids.actorEmail,
      firstName: "Alex",
      lastName: "Rivera",
      email: emailB,
      phone: "555-0102",
    });
    membershipIds.push(inviteB.membershipId);

    const inviteATwo = await submitMemberInvite({
      orgId: ids.orgTwoId,
      actorUserId: ids.actorUserId,
      actorEmail: ids.actorEmail,
      firstName: "Different",
      lastName: "Submitted Name",
      email: emailA.toUpperCase(),
      phone: "555-9999",
    });
    membershipIds.push(inviteATwo.membershipId);

    const accountRows = await pool.query<{
      personId: string;
      userId: string;
      email: string;
      firstName: string;
      lastName: string;
    }>(
      `select p.id as "personId", u.id as "userId", p.email,
              p.first_name as "firstName", p.last_name as "lastName"
         from people p
         join users u on u.person_id = p.id
        where lower(p.email) = any($1::text[])
        order by p.email`,
      [[emailA, emailB]],
    );
    assert(accountRows.rows.length === 2, "same name with two emails creates two separate accounts");
    for (const row of accountRows.rows) {
      personIds.push(row.personId);
      userIds.push(row.userId);
    }
    const accountA = accountRows.rows.find((row) => row.email === emailA);
    const accountB = accountRows.rows.find((row) => row.email === emailB);
    assert(accountA && accountB && accountA.personId !== accountB.personId, "each submitted email remains on its own person");
    assert(
      accountA.firstName === "Alex" && accountA.lastName === "Rivera",
      "reusing an email does not replace the established display name",
    );

    const membershipOwners = await pool.query<{ membershipId: string; userId: string }>(
      `select id as "membershipId", user_id as "userId"
         from org_memberships
        where id = any($1::uuid[])
        order by id`,
      [membershipIds],
    );
    const aMemberships = membershipOwners.rows.filter((row) => row.userId === accountA.userId);
    assert(aMemberships.length === 2, "case-insensitive shared email reuses one user in both organizations");

    for (const membershipId of membershipIds) {
      await memberships.activate(SYSTEM, membershipId, ids.actorUserId);
    }
    const chooserMemberships = await memberships.listActiveByUser(SYSTEM, accountA.userId);
    assert(
      chooserMemberships.length === 2 &&
        new Set(chooserMemberships.map((membership) => membership.orgId)).size === 2,
      "the existing chooser receives both active organizations for the shared-email account",
    );

    const before = await pool.query<{ email: string; memberships: number }>(
      `select p.email,
              (select count(*)::int from org_memberships m where m.user_id = u.id) as memberships
         from people p join users u on u.person_id = p.id
        where p.id = $1`,
      [accountA.personId],
    );
    let contactBlocked = false;
    try {
      await withDbContext(SYSTEM, (client) =>
        people.updateContactInTx(client, accountA.personId, {
          firstName: "Changed",
          lastName: "Name",
          email: emailB,
          phone: "555-7777",
        }),
      );
    } catch (err) {
      contactBlocked = err instanceof people.AccountEmailChangeError;
    }
    assert(contactBlocked, "contact editing clearly blocks changing an account email");
    const afterContact = await pool.query<{ email: string; firstName: string; memberships: number }>(
      `select p.email, p.first_name as "firstName",
              (select count(*)::int from org_memberships m where m.user_id = u.id) as memberships
         from people p join users u on u.person_id = p.id
        where p.id = $1`,
      [accountA.personId],
    );
    assert(
      afterContact.rows[0]?.email === before.rows[0]?.email &&
        afterContact.rows[0]?.firstName === "Alex" &&
        afterContact.rows[0]?.memberships === before.rows[0]?.memberships,
      "rejected contact collision leaves the account and memberships unchanged",
    );

    const orphan = await withDbContext(SYSTEM, (client) =>
      people.createInTx(client, {
        firstName: "Alex",
        lastName: "Rivera",
        email: orphanEmail,
        sourceNote: marker,
      }),
    );
    personIds.push(orphan.id);
    let mergeBlocked = false;
    try {
      await mergePeople(SYSTEM, {
        duplicateId: accountA.personId,
        survivorId: orphan.id,
        actorUserId: ids.actorUserId,
      });
    } catch (err) {
      mergeBlocked = err instanceof MergeAccountEmailChangeError;
    }
    assert(mergeBlocked, "merge blocks moving a login account onto a different email identity");
    const afterMerge = await pool.query<{ people: number; memberships: number }>(
      `select
         (select count(*)::int from people where id = any($1::uuid[])) as people,
         (select count(*)::int from org_memberships where user_id = $2) as memberships`,
      [[accountA.personId, orphan.id], accountA.userId],
    );
    assert(
      afterMerge.rows[0]?.people === 2 && afterMerge.rows[0]?.memberships === 2,
      "rejected merge preserves both people and all membership history",
    );

    let triggerBlocked = false;
    try {
      await withDbContext(SYSTEM, (client) =>
        q(client, `update people set email = $2 where id = $1`, [accountA.personId, orphanEmail]),
      );
    } catch (err) {
      triggerBlocked = err instanceof Error && err.message.includes("account_email_immutable");
    }
    assert(triggerBlocked, "database trigger blocks out-of-band account email changes");

    await withDbContext(SYSTEM, (client) =>
      q(client, `update people set email = $2 where id = $1`, [
        accountA.personId,
        `  ${emailA.toUpperCase()}  `,
      ]),
    );
    const canonical = await pool.query<{ email: string }>(`select email from people where id = $1`, [accountA.personId]);
    assert(canonical.rows[0]?.email === emailA, "direct case/whitespace variants are stored in canonical form");
    let normalizedDuplicateBlocked = false;
    try {
      await withDbContext(SYSTEM, (client) =>
        people.createInTx(client, {
          firstName: "Duplicate",
          lastName: "Normalized Email",
          email: ` ${emailA.toUpperCase()} `,
          sourceNote: marker,
        }),
      );
    } catch (err) {
      normalizedDuplicateBlocked =
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code?: unknown }).code === "23505";
    }
    assert(
      normalizedDuplicateBlocked,
      "database uniqueness prevents a second person with the same normalized email",
    );

    const sessionCookie = await mintSessionCookie(emailA);
    const linked = await pool.query<{ authSubject: string | null }>(
      `select auth_subject as "authSubject" from users where id = $1`,
      [accountA.userId],
    );
    authSubject = linked.rows[0]?.authSubject ?? null;
    assert(authSubject !== null, "successful login links the provider subject to the email-matched account");
    await pool.query(`update "user" set email = $2, "updatedAt" = now() where id = $1`, [authSubject, authEmail]);

    const deniedResponse = await fetch(`${BASE}/api/session`, {
      headers: { Cookie: sessionCookie },
    });
    const deniedSession = (await deniedResponse.json()) as { authenticated?: boolean; memberships?: unknown[] };
    assert(
      deniedResponse.ok && deniedSession.authenticated === false && deniedSession.memberships?.length === 0,
      "a provider/person email mismatch is denied during application session resolution",
    );

    const issues = await users.listEmailIdentityIssues(SYSTEM);
    const fixtureIssue = issues.find((issue) => issue.userId === accountA.userId);
    assert(
      fixtureIssue?.issue === "email_mismatch" &&
        fixtureIssue.personEmail === emailA &&
        fixtureIssue.authEmail === authEmail,
      "read-only integrity report identifies person/provider email mismatches without repairing them",
    );
    const unchangedMismatch = await pool.query<{ personEmail: string; authEmail: string }>(
      `select p.email as "personEmail", au.email as "authEmail"
         from users u join people p on p.id = u.person_id
         join "user" au on au.id = u.auth_subject
        where u.id = $1`,
      [accountA.userId],
    );
    assert(
      unchangedMismatch.rows[0]?.personEmail === emailA && unchangedMismatch.rows[0]?.authEmail === authEmail,
      "integrity reporting does not guess or rewrite either address",
    );

    const temporaryFunctionName = `zz_protect_account_email_identity_${process.pid}`;
    await pool.query(`alter function protect_account_email_identity() rename to ${temporaryFunctionName}`);
    try {
      const outcome = await checkRequiredDbFunctions();
      assert(
        !outcome.checkFailed && outcome.missing.includes("protect_account_email_identity"),
        "startup checks report the missing account-email protection function",
      );
    } finally {
      await pool.query(`alter function ${temporaryFunctionName}() rename to protect_account_email_identity`);
    }

    console.log("\nAll account email identity checks passed.");
  } finally {
    await cleanup();
    await pool.end();
  }
}

main().catch(async (err) => {
  console.error(err);
  await cleanup();
  await pool.end();
  process.exitCode = 1;
});