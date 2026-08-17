/**
 * Populations — the shared vocabulary (11 seeded values), linked to
 * organizations through organization_populations.
 */
import type { PoolClient } from "pg";
import { q, withDbContext, type DbContext } from "../db/client";
import type { Population } from "../../shared/types";

const COLS = `id, name, slug, sort_order as "sortOrder", is_active as "isActive"`;

/** All populations in sort order, including inactive (RLS hides inactive from non-staff). */
export async function listAll(ctx: DbContext): Promise<Population[]> {
  return withDbContext(ctx, (c) =>
    q<Population>(c, `select ${COLS} from populations order by sort_order asc, name asc`),
  );
}

export async function findBySlug(ctx: DbContext, slug: string): Promise<Population | null> {
  const rows = await withDbContext(ctx, (c) =>
    q<Population>(c, `select ${COLS} from populations where slug = $1`, [slug]),
  );
  return rows[0] ?? null;
}

/** Populations linked to one organization, in sort order. */
export async function listByOrganization(ctx: DbContext, orgId: string): Promise<Population[]> {
  return withDbContext(ctx, (c) =>
    q<Population>(
      c,
      `select p.id, p.name, p.slug, p.sort_order as "sortOrder", p.is_active as "isActive"
         from populations p
         join organization_populations op on op.population_id = p.id
        where op.org_id = $1 order by p.sort_order asc, p.name asc`,
      [orgId],
    ),
  );
}

/**
 * Replace an organization's population links with exactly `populationIds`.
 * Diff-based sync on the join table (join rows are links, not workflow
 * records — the no-DELETE rule governs workflow entities).
 */
export async function setForOrganization(ctx: DbContext, orgId: string, populationIds: string[]): Promise<void> {
  await withDbContext(ctx, (c) => setForOrganizationInTx(c, orgId, populationIds));
}

/** Transaction-composable variant (MP-03 one-tx signup). */
export async function setForOrganizationInTx(c: PoolClient, orgId: string, populationIds: string[]): Promise<void> {
  if (populationIds.length === 0) {
    await c.query(`delete from organization_populations where org_id = $1`, [orgId]);
    return;
  }
  await c.query(`delete from organization_populations where org_id = $1 and population_id <> all($2::uuid[])`, [
    orgId,
    populationIds,
  ]);
  await c.query(
    `insert into organization_populations (org_id, population_id)
     select $1, unnest($2::uuid[]) on conflict do nothing`,
    [orgId, populationIds],
  );
}

export type CreatePopulationInput = {
  name: string;
  slug: string;
  sortOrder?: number;
  isActive?: boolean;
};

/**
 * Create a population (ADMIN-05). Without an explicit sortOrder it lands at
 * the END of the list (§6 Add) — never 0, which would jump the queue.
 */
export async function create(ctx: DbContext, input: CreatePopulationInput): Promise<Population> {
  const rows = await withDbContext(ctx, (c) =>
    q<Population>(
      c,
      `insert into populations (name, slug, sort_order, is_active)
       values ($1, $2, coalesce($3, (select coalesce(max(sort_order), 0) + 1 from populations)), $4)
       returning ${COLS}`,
      [input.name, input.slug, input.sortOrder ?? null, input.isActive ?? true],
    ),
  );
  const population = rows[0];
  if (!population) throw new Error("populations.create returned no row");
  return population;
}

export type PopulationWithCount = Population & { orgCount: number };

/** All populations with how many organizations hold each (ADMIN-05 §3). */
export async function listWithCounts(ctx: DbContext): Promise<PopulationWithCount[]> {
  return withDbContext(ctx, (c) =>
    q<PopulationWithCount>(
      c,
      `select ${COLS},
              (select count(*)::int from organization_populations op where op.population_id = populations.id) as "orgCount"
         from populations
        order by sort_order asc, name asc`,
    ),
  );
}

/**
 * Rewrite sort_order to match the given id order, 1-based (§6 Reorder).
 * The route validates the set is exactly the current population ids.
 */
export async function updateSortOrders(ctx: DbContext, orderedIds: string[]): Promise<void> {
  await withDbContext(ctx, (c) =>
    c.query(
      `update populations p set sort_order = x.ord
         from (select * from unnest($1::uuid[]) with ordinality) as x(id, ord)
        where p.id = x.id`,
      [orderedIds],
    ),
  );
}

export type OtherValueGroup = {
  groupKey: string;
  value: string;
  orgCount: number;
  orgs: { id: string; name: string; raw: string }[];
};

/**
 * Distinct free-text populations_other values, grouped case-insensitively
 * on trimmed whitespace (D20) — variants promote together. The displayed
 * value is the most common raw variant.
 */
export async function listOtherValues(ctx: DbContext): Promise<OtherValueGroup[]> {
  return withDbContext(ctx, (c) =>
    q<OtherValueGroup>(
      c,
      `select lower(btrim(populations_other)) as "groupKey",
              mode() within group (order by btrim(populations_other)) as value,
              count(*)::int as "orgCount",
              json_agg(json_build_object('id', id, 'name', name, 'raw', populations_other) order by name) as orgs
         from organizations
        where populations_other is not null and btrim(populations_other) <> ''
        group by 1
        order by 3 desc, 2 asc`,
    ),
  );
}

export class PromoteNoOrganizationsError extends Error {
  constructor(groupKey: string) {
    super(`no organizations hold the value: ${groupKey}`);
    this.name = "PromoteNoOrganizationsError";
  }
}

export type PromoteResult = {
  population: Population;
  orgs: { id: string; name: string }[];
};

/**
 * Promote a free-text value to a real population (§6, D19, D20): create the
 * row at the end of the sort order, link every organization whose trimmed
 * lowercased populations_other matches the group key, and clear their
 * free-text field — one transaction. Organization status is never touched
 * (§3); archived organizations keep their new assignment like anyone else.
 */
export async function promoteOther(
  ctx: DbContext,
  input: { groupKey: string; name: string; slug: string },
): Promise<PromoteResult> {
  return withDbContext(ctx, async (c) => {
    const orgs = await q<{ id: string; name: string }>(
      c,
      `select id, name from organizations
        where populations_other is not null and lower(btrim(populations_other)) = $1
        order by name asc`,
      [input.groupKey],
    );
    if (orgs.length === 0) throw new PromoteNoOrganizationsError(input.groupKey);
    const created = await q<Population>(
      c,
      `insert into populations (name, slug, sort_order, is_active)
       values ($1, $2, (select coalesce(max(sort_order), 0) + 1 from populations), true)
       returning ${COLS}`,
      [input.name, input.slug],
    );
    const population = created[0];
    if (!population) throw new Error("populations.promoteOther: insert returned no row");
    await c.query(
      `insert into organization_populations (org_id, population_id)
       select o.id, $2 from organizations o
        where o.populations_other is not null and lower(btrim(o.populations_other)) = $1
       on conflict do nothing`,
      [input.groupKey, population.id],
    );
    await c.query(
      `update organizations set populations_other = null
        where populations_other is not null and lower(btrim(populations_other)) = $1`,
      [input.groupKey],
    );
    return { population, orgs };
  });
}

/** Rename a population (ADMIN-05). Slug stays stable. */
export async function rename(ctx: DbContext, populationId: string, name: string): Promise<Population> {
  const rows = await withDbContext(ctx, (c) =>
    q<Population>(c, `update populations set name = $2 where id = $1 returning ${COLS}`, [populationId, name]),
  );
  const population = rows[0];
  if (!population) throw new Error(`populations.rename: not found: ${populationId}`);
  return population;
}

/** Deactivate (never delete) a population (ADMIN-05). */
export async function deactivate(ctx: DbContext, populationId: string): Promise<Population> {
  const rows = await withDbContext(ctx, (c) =>
    q<Population>(c, `update populations set is_active = false where id = $1 returning ${COLS}`, [populationId]),
  );
  const population = rows[0];
  if (!population) throw new Error(`populations.deactivate: not found: ${populationId}`);
  return population;
}
