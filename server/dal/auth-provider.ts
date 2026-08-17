/**
 * The only place the application reads the auth provider's own tables.
 * Better Auth owns "user"/"session"/"account"/"verification"; these lookups
 * exist solely to link a provider session to our users.auth_subject.
 */
import { pool } from "../db/client";

/** Email address on the auth provider's user record, by provider user id. */
export async function getAuthUserEmail(authUserId: string): Promise<string | null> {
  const res = await pool.query<{ email: string }>(`select email from "user" where id = $1`, [authUserId]);
  return res.rows[0]?.email ?? null;
}
