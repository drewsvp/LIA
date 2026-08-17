/**
 * Integrity checks backed by database objects from migration 0001.
 */
import { q, withDbContext, type DbContext } from "../db/client";

export type CounterDriftRow = {
  kind: string;
  id: string;
  stored: number;
  actual: number;
};

/** Rows from the counter_drift view. Healthy = empty array. */
export async function counterDrift(ctx: DbContext): Promise<CounterDriftRow[]> {
  return withDbContext(ctx, (c) => q<CounterDriftRow>(c, `select kind, id, stored, actual from counter_drift`));
}
