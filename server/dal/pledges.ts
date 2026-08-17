/**
 * Item pledges — public donor commitments. The ONLY write path is
 * record_item_pledge(), the SQL function from migration 0001: it locks rows,
 * revalidates quantities, upserts the person, moves quantity_claimed, and
 * auto-archives a fully claimed request with its approval event. The DAL
 * never updates counters itself (replit.md rule 2).
 */
import { q, withDbContext, SYSTEM, type DbContext } from "../db/client";
import type { ItemPledge, PledgeWithSupporter } from "../../shared/types";

const COLS = `ip.id, ip.legacy_wix_id as "legacyWixId", ip.person_id as "personId",
  ip.item_request_id as "itemRequestId", ip.notes, ip.created_at as "createdAt", ip.updated_at as "updatedAt"`;

export type PledgeLineInput = { itemId: string; quantity: number };

export type RecordItemPledgeInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  requestId: string;
  notes?: string | null;
  lines: PledgeLineInput[];
};

/** Error codes raised by record_item_pledge(), surfaced as readable failures. */
export type PledgeErrorCode =
  | "request_not_found"
  | "request_not_active"
  | "no_lines"
  | "invalid_quantity"
  | "item_not_in_request"
  | "insufficient_quantity";

const PLEDGE_ERROR_CODES: readonly PledgeErrorCode[] = [
  "request_not_found",
  "request_not_active",
  "no_lines",
  "invalid_quantity",
  "item_not_in_request",
  "insufficient_quantity",
];

export class PledgeError extends Error {
  readonly code: PledgeErrorCode;
  constructor(code: PledgeErrorCode, message: string) {
    super(message);
    this.name = "PledgeError";
    this.code = code;
  }
}

function toPledgeError(err: unknown): PledgeError | null {
  if (typeof err !== "object" || err === null) return null;
  const message = String((err as { message?: unknown }).message ?? "");
  for (const code of PLEDGE_ERROR_CODES) {
    if (message.startsWith(code)) return new PledgeError(code, message);
  }
  return null;
}

/**
 * Record a pledge through the SQL function. Runs in system context regardless
 * of caller — the function itself revalidates everything under row locks, and
 * public browsers have no direct write access by design. Concurrency-safe:
 * a competing pledge that empties an item makes this throw
 * PledgeError('insufficient_quantity') — show the refreshed quantities.
 */
export async function recordItemPledge(_ctx: DbContext, input: RecordItemPledgeInput): Promise<{ pledgeId: string }> {
  const lines = input.lines.map((l) => ({ item_id: l.itemId, quantity: l.quantity }));
  try {
    const rows = await withDbContext(SYSTEM, (c) =>
      q<{ pledgeId: string }>(
        c,
        `select record_item_pledge($1, $2, $3, $4, $5, $6, $7::jsonb) as "pledgeId"`,
        [
          input.firstName,
          input.lastName,
          input.email,
          input.phone ?? null,
          input.requestId,
          input.notes ?? null,
          JSON.stringify(lines),
        ],
      ),
    );
    const row = rows[0];
    if (!row) throw new Error("record_item_pledge returned no row");
    return { pledgeId: row.pledgeId };
  } catch (err) {
    const pledgeError = toPledgeError(err);
    if (pledgeError) throw pledgeError;
    throw err;
  }
}

/** One person's pledge on one request, if any (duplicate checks, seeding). */
export async function findByPersonAndRequest(
  ctx: DbContext,
  personId: string,
  requestId: string,
): Promise<ItemPledge | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<ItemPledge>(c, `select ${COLS} from item_pledges ip where ip.person_id = $1 and ip.item_request_id = $2`, [
      personId,
      requestId,
    ]),
  );
  return rows[0] ?? null;
}

const SUPPORTER_SELECT = `
  select ${COLS}, p.first_name as "firstName", p.last_name as "lastName", p.email, p.phone,
         r.title as "requestTitle",
         coalesce(
           (select json_agg(json_build_object('itemId', l.item_id, 'itemName', i.name, 'quantity', l.quantity)
                            order by i.sort_order)
              from item_pledge_lines l join items i on i.id = l.item_id
             where l.item_pledge_id = ip.id),
           '[]'::json) as lines
    from item_pledges ip
    join people p on p.id = ip.person_id
    join item_requests r on r.id = ip.item_request_id`;

/** All pledges across an organization's requests, newest first (MP-13). */
export async function listByOrganization(ctx: DbContext, orgId: string): Promise<PledgeWithSupporter[]> {
  return withDbContext(ctx, (c) =>
    q<PledgeWithSupporter>(c, `${SUPPORTER_SELECT} where r.org_id = $1 order by ip.created_at desc`, [orgId]),
  );
}

/** Pledges on one request of the organization, newest first. */
export async function listByRequest(ctx: DbContext, orgId: string, requestId: string): Promise<PledgeWithSupporter[]> {
  return withDbContext(ctx, (c) =>
    q<PledgeWithSupporter>(
      c,
      `${SUPPORTER_SELECT} where r.org_id = $1 and ip.item_request_id = $2 order by ip.created_at desc`,
      [orgId, requestId],
    ),
  );
}

/** Flat pledge lines for one request — who pledged how many of which item. */
export async function resolveLinesForRequest(
  ctx: DbContext,
  orgId: string,
  requestId: string,
): Promise<{ pledgeId: string; personId: string; itemId: string; itemName: string; quantity: number }[]> {
  return withDbContext(ctx, (c) =>
    q<{ pledgeId: string; personId: string; itemId: string; itemName: string; quantity: number }>(
      c,
      `select ip.id as "pledgeId", ip.person_id as "personId", l.item_id as "itemId",
              i.name as "itemName", l.quantity
         from item_pledges ip
         join item_requests r on r.id = ip.item_request_id
         join item_pledge_lines l on l.item_pledge_id = ip.id
         join items i on i.id = l.item_id
        where r.org_id = $1 and ip.item_request_id = $2
        order by ip.created_at asc, i.sort_order asc`,
      [orgId, requestId],
    ),
  );
}
