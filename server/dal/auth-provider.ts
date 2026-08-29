/**
 * The only place the application reads the auth provider's own tables.
 * Better Auth owns "user"/"session"/"account"/"verification"; these lookups
 * exist solely to link a provider session to our users.auth_subject.
 */
import type { PoolClient } from "pg";
import { pool, q } from "../db/client";

/** Email address on the auth provider's user record, by provider user id. */
export async function getAuthUserEmail(authUserId: string): Promise<string | null> {
  const res = await pool.query<{ email: string }>(`select email from "user" where id = $1`, [authUserId]);
  return res.rows[0]?.email ?? null;
}

/** True when another Better Auth identity already owns this email address. */
export async function emailInUseByAnotherUserInTx(
  client: PoolClient,
  email: string,
  authUserId: string,
): Promise<boolean> {
  const rows = await q<{ inUse: boolean }>(
    client,
    `select exists(
       select 1 from "user"
        where lower(email) = lower($1) and id <> $2
     ) as "inUse"`,
    [email, authUserId],
  );
  return rows[0]?.inUse === true;
}

/**
 * Keep Better Auth's email identity and display name aligned with the
 * application person row. This is transaction-composable so a profile save
 * cannot leave the two identity stores half-updated.
 */
export async function updateUserContactInTx(
  client: PoolClient,
  authUserId: string,
  email: string,
  name: string,
  emailVerified?: boolean,
): Promise<void> {
  const rows = await q<{ id: string }>(
    client,
    `update "user"
        set email = $2, name = $3,
            "emailVerified" = coalesce($4::boolean, "emailVerified"),
            "updatedAt" = now()
      where id = $1
      returning id`,
    [authUserId, email, name, emailVerified ?? null],
  );
  if (!rows[0]) throw new Error(`auth-provider.updateUserContactInTx: user not found: ${authUserId}`);
}

export type PendingProfileEmailChange = {
  userId: string;
  personId: string;
  authUserId: string;
  newEmail: string;
  initiatedByUserId?: string;
};

export async function createProfileEmailChangeInTx(
  client: PoolClient,
  input: PendingProfileEmailChange & { tokenHash: string },
): Promise<void> {
  await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [input.userId]);
  await deleteProfileEmailChangesInTx(client, input.userId);
  const identifier = `profile-email-change:${input.tokenHash}`;
  await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 1))`, [identifier]);
  const duplicate = await q<{ exists: boolean }>(
    client,
    `select exists(select 1 from verification where identifier = $1) as exists`,
    [identifier],
  );
  if (duplicate[0]?.exists) {
    throw new Error("A profile email confirmation token collision was detected. Please retry.");
  }
  await client.query(
    `insert into verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
     values (gen_random_uuid(), $1, $2, now() + interval '1 hour', now(), now())`,
    [
      identifier,
      JSON.stringify({
        userId: input.userId,
        personId: input.personId,
        authUserId: input.authUserId,
        newEmail: input.newEmail,
        ...(input.initiatedByUserId ? { initiatedByUserId: input.initiatedByUserId } : {}),
      }),
    ],
  );
}

export async function cancelProfileEmailChangesInTx(client: PoolClient, userId: string): Promise<void> {
  await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [userId]);
  await deleteProfileEmailChangesInTx(client, userId);
}

export async function deleteProfileEmailChangeByTokenInTx(
  client: PoolClient,
  tokenHash: string,
): Promise<void> {
  await client.query(
    `delete from verification
      where identifier = $1`,
    [`profile-email-change:${tokenHash}`],
  );
}

export async function getProfileEmailChangeInTx(
  client: PoolClient,
  tokenHash: string,
): Promise<PendingProfileEmailChange | null> {
  const result = await client.query<{ value: string }>(
    `select value
       from verification
      where identifier = $1 and "expiresAt" > now()
      for update`,
    [`profile-email-change:${tokenHash}`],
  );
  const rows = result.rows;
  if (rows.length !== 1) return null;
  const row = rows[0];
  if (!row) return null;
  try {
    const value = JSON.parse(row.value) as Partial<PendingProfileEmailChange>;
    if (
      typeof value.userId !== "string" ||
      typeof value.personId !== "string" ||
      typeof value.authUserId !== "string" ||
      typeof value.newEmail !== "string"
    ) return null;
    return value as PendingProfileEmailChange;
  } catch {
    return null;
  }
}

export async function deleteProfileEmailChangesInTx(client: PoolClient, userId: string): Promise<void> {
  await client.query(
    `delete from verification
      where identifier like 'profile-email-change:%'
        and value is json object
        and value::jsonb ->> 'userId' = $1`,
    [userId],
  );
}
