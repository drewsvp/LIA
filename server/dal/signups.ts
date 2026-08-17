/**
 * Volunteer signups — public volunteer interest. The ONLY write path is
 * record_volunteer_signup(), the SQL function from migration 0001. It locks
 * roles, revalidates capacity, upserts the person, and moves
 * quantity_interested. Signups never auto-archive a request.
 */
import { q, withDbContext, SYSTEM, type DbContext } from "../db/client";
import type { SignupWithSupporter, VolunteerSignup } from "../../shared/types";

const COLS = `vs.id, vs.legacy_wix_id as "legacyWixId", vs.person_id as "personId",
  vs.volunteer_request_id as "volunteerRequestId", vs.notes, vs.created_at as "createdAt",
  vs.updated_at as "updatedAt"`;

export type RecordVolunteerSignupInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  requestId: string;
  notes?: string | null;
  roleIds: string[];
};

/** Error codes raised by record_volunteer_signup(). */
export type SignupErrorCode =
  | "request_not_found"
  | "request_not_active"
  | "no_roles"
  | "role_not_in_request"
  | "role_full"
  | "duplicate_role";

const SIGNUP_ERROR_CODES: readonly SignupErrorCode[] = [
  "request_not_found",
  "request_not_active",
  "no_roles",
  "role_not_in_request",
  "role_full",
  "duplicate_role",
];

export class SignupError extends Error {
  readonly code: SignupErrorCode;
  constructor(code: SignupErrorCode, message: string) {
    super(message);
    this.name = "SignupError";
    this.code = code;
  }
}

function toSignupError(err: unknown): SignupError | null {
  if (typeof err !== "object" || err === null) return null;
  const message = String((err as { message?: unknown }).message ?? "");
  for (const code of SIGNUP_ERROR_CODES) {
    if (message.startsWith(code)) return new SignupError(code, message);
  }
  return null;
}

/**
 * Record a signup through the SQL function. Runs in system context regardless
 * of caller; the function revalidates capacity under row locks. A competing
 * signup that fills a role makes this throw SignupError('role_full').
 */
export async function recordVolunteerSignup(
  _ctx: DbContext,
  input: RecordVolunteerSignupInput,
): Promise<{ signupId: string }> {
  try {
    const rows = await withDbContext(SYSTEM, (c) =>
      q<{ signupId: string }>(
        c,
        `select record_volunteer_signup($1, $2, $3, $4, $5, $6, $7::uuid[]) as "signupId"`,
        [
          input.firstName,
          input.lastName,
          input.email,
          input.phone ?? null,
          input.requestId,
          input.notes ?? null,
          input.roleIds,
        ],
      ),
    );
    const row = rows[0];
    if (!row) throw new Error("record_volunteer_signup returned no row");
    return { signupId: row.signupId };
  } catch (err) {
    const signupError = toSignupError(err);
    if (signupError) throw signupError;
    throw err;
  }
}

/** One person's signup on one request, if any (duplicate checks, seeding). */
export async function findByPersonAndRequest(
  ctx: DbContext,
  personId: string,
  requestId: string,
): Promise<VolunteerSignup | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<VolunteerSignup>(
      c,
      `select ${COLS} from volunteer_signups vs where vs.person_id = $1 and vs.volunteer_request_id = $2`,
      [personId, requestId],
    ),
  );
  return rows[0] ?? null;
}

const SUPPORTER_SELECT = `
  select ${COLS}, p.first_name as "firstName", p.last_name as "lastName", p.email, p.phone,
         r.title as "requestTitle",
         coalesce(
           (select json_agg(json_build_object('roleId', sr.volunteer_role_id, 'roleName', vr.name)
                            order by vr.sort_order)
              from volunteer_signup_roles sr join volunteer_roles vr on vr.id = sr.volunteer_role_id
             where sr.volunteer_signup_id = vs.id),
           '[]'::json) as roles
    from volunteer_signups vs
    join people p on p.id = vs.person_id
    join volunteer_requests r on r.id = vs.volunteer_request_id`;

/** All signups across an organization's requests, newest first (MP-13). */
export async function listByOrganization(ctx: DbContext, orgId: string): Promise<SignupWithSupporter[]> {
  return withDbContext(ctx, (c) =>
    q<SignupWithSupporter>(c, `${SUPPORTER_SELECT} where r.org_id = $1 order by vs.created_at desc`, [orgId]),
  );
}

/** Signups on one request of the organization, newest first. */
export async function listByRequest(ctx: DbContext, orgId: string, requestId: string): Promise<SignupWithSupporter[]> {
  return withDbContext(ctx, (c) =>
    q<SignupWithSupporter>(
      c,
      `${SUPPORTER_SELECT} where r.org_id = $1 and vs.volunteer_request_id = $2 order by vs.created_at desc`,
      [orgId, requestId],
    ),
  );
}

/** Flat signup roles for one request — who signed up for which role. */
export async function resolveRolesForRequest(
  ctx: DbContext,
  orgId: string,
  requestId: string,
): Promise<{ signupId: string; personId: string; roleId: string; roleName: string }[]> {
  return withDbContext(ctx, (c) =>
    q<{ signupId: string; personId: string; roleId: string; roleName: string }>(
      c,
      `select vs.id as "signupId", vs.person_id as "personId", sr.volunteer_role_id as "roleId", vr.name as "roleName"
         from volunteer_signups vs
         join volunteer_requests r on r.id = vs.volunteer_request_id
         join volunteer_signup_roles sr on sr.volunteer_signup_id = vs.id
         join volunteer_roles vr on vr.id = sr.volunteer_role_id
        where r.org_id = $1 and vs.volunteer_request_id = $2
        order by vs.created_at asc, vr.sort_order asc`,
      [orgId, requestId],
    ),
  );
}
