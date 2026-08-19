/**
 * Users — auth plumbing only, one-to-one optional with people, no permissions.
 * auth_subject holds the auth provider's stable subject id; nothing else in
 * the application knows which provider is in use.
 */
import type { PoolClient } from "pg";
import { q, withDbContext, type DbContext } from "../db/client";
import type { User, UserWithPerson, UserStatus, UserKind } from "../../shared/types";

const COLS = `u.id, u.person_id as "personId", u.auth_subject as "authSubject", u.status, u.kind,
  u.last_login_at as "lastLoginAt", u.created_at as "createdAt", u.updated_at as "updatedAt"`;
const PERSON_JOIN_COLS = `${COLS}, p.first_name as "firstName", p.last_name as "lastName", p.email`;

export type CreateUserInput = {
  /** Links the user to its person — a user cannot exist without one. */
  personId: string;
  status?: UserStatus;
  /** 'member' (default) or 'supporter' — supporter accounts have no org membership. */
  kind?: UserKind;
};

/** Find by the auth provider's stable subject identifier. */
export async function findByAuthSubject(ctx: DbContext, authSubject: string): Promise<UserWithPerson | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<UserWithPerson>(
      c,
      `select ${PERSON_JOIN_COLS} from users u join people p on p.id = u.person_id
        where u.auth_subject = $1`,
      [authSubject],
    ),
  );
  return rows[0] ?? null;
}

/** Find the user whose person has this email (case-insensitive). */
export async function findByEmail(ctx: DbContext, email: string): Promise<UserWithPerson | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<UserWithPerson>(
      c,
      `select ${PERSON_JOIN_COLS} from users u join people p on p.id = u.person_id
        where lower(p.email) = lower($1)`,
      [email],
    ),
  );
  return rows[0] ?? null;
}

export async function findByPersonId(ctx: DbContext, personId: string): Promise<User | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<User>(c, `select ${COLS} from users u where u.person_id = $1`, [personId]),
  );
  return rows[0] ?? null;
}

/** Plain primary-key lookup — ADMIN-02 resolves created_by to a person via user.personId. */
export async function getById(ctx: DbContext, userId: string): Promise<User | null> {
  const rows = await withDbContext(ctx, (c) => q<User>(c, `select ${COLS} from users u where u.id = $1`, [userId]));
  return rows[0] ?? null;
}

/** Create a user linked to its person. Defaults to status 'invited'. */
export async function create(ctx: DbContext, input: CreateUserInput): Promise<User> {
  return withDbContext(ctx, (c) => createInTx(c, input));
}

/** Transaction-composable variant (MP-03 one-tx signup). */
export async function createInTx(c: PoolClient, input: CreateUserInput): Promise<User> {
  const rows = await q<User>(
    c,
    `insert into users (person_id, status, kind) values ($1, $2, $3)
     returning id, person_id as "personId", auth_subject as "authSubject", status, kind,
               last_login_at as "lastLoginAt", created_at as "createdAt", updated_at as "updatedAt"`,
    [input.personId, input.status ?? "invited", input.kind ?? "member"],
  );
  const user = rows[0];
  if (!user) throw new Error("users.create returned no row");
  return user;
}

/** Transaction-composable find by person (MP-03 one-tx signup). */
export async function findByPersonIdInTx(c: PoolClient, personId: string): Promise<User | null> {
  const rows = await q<User>(c, `select ${COLS} from users u where u.person_id = $1`, [personId]);
  return rows[0] ?? null;
}

/** Record the auth provider's subject id on first successful login. */
export async function linkAuthSubject(ctx: DbContext, userId: string, authSubject: string): Promise<User> {
  const rows = await withDbContext(ctx, (c) =>
    q<User>(
      c,
      `update users set auth_subject = $2 where id = $1
       returning id, person_id as "personId", auth_subject as "authSubject", status, kind,
                 last_login_at as "lastLoginAt", created_at as "createdAt", updated_at as "updatedAt"`,
      [userId, authSubject],
    ),
  );
  const user = rows[0];
  if (!user) throw new Error(`users.linkAuthSubject: user not found: ${userId}`);
  return user;
}

/** Set last_login_at to now — written on every successful authentication. */
export async function setLastLoginAt(ctx: DbContext, userId: string): Promise<User> {
  const rows = await withDbContext(ctx, (c) =>
    q<User>(
      c,
      `update users set last_login_at = now() where id = $1
       returning id, person_id as "personId", auth_subject as "authSubject", status, kind,
                 last_login_at as "lastLoginAt", created_at as "createdAt", updated_at as "updatedAt"`,
      [userId],
    ),
  );
  const user = rows[0];
  if (!user) throw new Error(`users.setLastLoginAt: user not found: ${userId}`);
  return user;
}

/**
 * Delete a user row. Seed-migration support (legacy synthetic staff_admin
 * removal) — approvals/events referencing the user must be re-pointed first.
 */
export async function removeById(ctx: DbContext, userId: string): Promise<void> {
  const rows = await withDbContext(ctx, (c) =>
    q<{ id: string }>(c, `delete from users where id = $1 returning id`, [userId]),
  );
  if (!rows[0]) throw new Error(`users.removeById: user not found: ${userId}`);
}
