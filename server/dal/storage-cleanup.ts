import { q, withDbContext, type DbContext } from "../db/client";

export type StorageCleanupRow = {
  id: string;
  objectUrl: string;
  reason: string;
  attempts: number;
};

export async function enqueue(
  ctx: DbContext,
  input: { objectUrl: string; reason: string; error: string },
): Promise<void> {
  await withDbContext(ctx, async (c) => {
    await c.query(
      `insert into storage_cleanup_queue (object_url, reason, last_error)
       values ($1, $2, $3)
       on conflict (object_url) do update
         set reason = excluded.reason,
             last_error = excluded.last_error,
             next_attempt_at = least(storage_cleanup_queue.next_attempt_at, now())`,
      [input.objectUrl, input.reason, input.error],
    );
  });
}

export async function listDue(ctx: DbContext, limit = 100): Promise<StorageCleanupRow[]> {
  return withDbContext(ctx, (c) =>
    q<StorageCleanupRow>(
      c,
      `select id, object_url as "objectUrl", reason, attempts
         from storage_cleanup_queue
        where next_attempt_at <= now()
        order by created_at
        limit $1`,
      [limit],
    ),
  );
}

export async function remove(ctx: DbContext, id: string): Promise<void> {
  await withDbContext(ctx, async (c) => {
    await c.query(`delete from storage_cleanup_queue where id = $1`, [id]);
  });
}

export async function recordFailure(ctx: DbContext, id: string, error: string): Promise<void> {
  await withDbContext(ctx, async (c) => {
    await c.query(
      `update storage_cleanup_queue
          set attempts = attempts + 1,
              last_error = $2,
              next_attempt_at = now() + interval '15 minutes'
        where id = $1`,
      [id, error],
    );
  });
}