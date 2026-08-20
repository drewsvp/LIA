/**
 * Shared volunteer categories and person-owned interest preferences.
 *
 * Category labels always sort alphabetically at query time; staff changes do
 * not carry a manual ordering field. Preference replacement validates and
 * writes one atomic diff so inactive saved choices can remain or be removed,
 * but can never be newly selected.
 */
import type { PoolClient } from "pg";
import type { VolunteerCategory } from "../../shared/types";
import { q, withDbContext, type DbContext } from "../db/client";

const CATEGORY_COLS = `id, name, is_active as "isActive"`;

export type VolunteerInterestOption = VolunteerCategory & { selected: boolean };
export type VolunteerCategoryWithUsage = VolunteerCategory & { interestCount: number };

export class VolunteerCategoryNotFoundError extends Error {
  constructor() {
    super("One or more volunteer categories no longer exist.");
    this.name = "VolunteerCategoryNotFoundError";
  }
}

export class InactiveVolunteerCategoryError extends Error {
  constructor() {
    super("An inactive volunteer category cannot be newly selected.");
    this.name = "InactiveVolunteerCategoryError";
  }
}

export class VolunteerInterestPersonScopeError extends Error {
  constructor() {
    super("Volunteer interests are scoped to the signed-in person.");
    this.name = "VolunteerInterestPersonScopeError";
  }
}

async function assertPersonScope(c: PoolClient, ctx: DbContext, personId: string): Promise<void> {
  if (ctx.kind !== "member") return;
  const rows = await q<{ allowed: boolean }>(
    c,
    `select exists (
       select 1 from users where id = $1 and person_id = $2
     ) as allowed`,
    [ctx.userId, personId],
  );
  if (rows[0]?.allowed !== true) throw new VolunteerInterestPersonScopeError();
}

/** Active choices plus this person's saved inactive choices, alphabetized. */
export async function listOptionsForPerson(
  ctx: DbContext,
  personId: string,
): Promise<VolunteerInterestOption[]> {
  return withDbContext(ctx, async (c) => {
    await assertPersonScope(c, ctx, personId);
    return q<VolunteerInterestOption>(
      c,
      `select vc.id, vc.name, vc.is_active as "isActive",
              (pvi.person_id is not null) as selected
         from volunteer_categories vc
         left join person_volunteer_interests pvi
           on pvi.category_id = vc.id and pvi.person_id = $1
        where vc.is_active or pvi.person_id is not null
        order by lower(vc.name), vc.name`,
      [personId],
    );
  });
}

export async function replaceForPersonInTx(c: PoolClient, personId: string, categoryIds: string[]): Promise<void> {
  const currentRows = await q<{ categoryId: string }>(
    c,
    `select category_id as "categoryId"
       from person_volunteer_interests
      where person_id = $1
      for update`,
    [personId],
  );
  const current = new Set(currentRows.map((row) => row.categoryId));

  const categories =
    categoryIds.length === 0
      ? []
      : await q<{ id: string; isActive: boolean }>(
          c,
          `select id, is_active as "isActive"
             from volunteer_categories
            where id = any($1::uuid[])
            for share`,
          [categoryIds],
        );
  if (categories.length !== categoryIds.length) throw new VolunteerCategoryNotFoundError();
  if (categories.some((category) => !category.isActive && !current.has(category.id))) {
    throw new InactiveVolunteerCategoryError();
  }
  const toAdd = categoryIds.filter((categoryId) => !current.has(categoryId));

  if (categoryIds.length === 0) {
    await c.query(`delete from person_volunteer_interests where person_id = $1`, [personId]);
    return;
  }
  await c.query(
    `delete from person_volunteer_interests
      where person_id = $1 and category_id <> all($2::uuid[])`,
    [personId, categoryIds],
  );
  if (toAdd.length > 0) {
    await c.query(
      `insert into person_volunteer_interests (person_id, category_id)
       select $1, unnest($2::uuid[])
       on conflict do nothing`,
      [personId, toAdd],
    );
  }
}

/** Replace exactly one signed-in person's preferences in one transaction. */
export async function replaceForPerson(ctx: DbContext, personId: string, categoryIds: string[]): Promise<void> {
  await withDbContext(ctx, async (c) => {
    await assertPersonScope(c, ctx, personId);
    await replaceForPersonInTx(c, personId, categoryIds);
  });
}

/** All categories with usage counts, alphabetized for the admin surface. */
export async function listWithUsage(ctx: DbContext): Promise<VolunteerCategoryWithUsage[]> {
  return withDbContext(ctx, (c) =>
    q<VolunteerCategoryWithUsage>(
      c,
      `select ${CATEGORY_COLS},
              (select count(*)::int
                 from person_volunteer_interests pvi
                where pvi.category_id = volunteer_categories.id) as "interestCount"
         from volunteer_categories
        order by lower(name), name`,
    ),
  );
}

export async function listAll(ctx: DbContext): Promise<VolunteerCategory[]> {
  return withDbContext(ctx, (c) =>
    q<VolunteerCategory>(c, `select ${CATEGORY_COLS} from volunteer_categories order by lower(name), name`),
  );
}

export async function create(ctx: DbContext, name: string): Promise<VolunteerCategory> {
  const rows = await withDbContext(ctx, (c) =>
    q<VolunteerCategory>(
      c,
      `insert into volunteer_categories (name) values ($1) returning ${CATEGORY_COLS}`,
      [name],
    ),
  );
  const row = rows[0];
  if (!row) throw new Error("volunteerInterests.create returned no row");
  return row;
}

export async function rename(ctx: DbContext, categoryId: string, name: string): Promise<VolunteerCategory> {
  const rows = await withDbContext(ctx, (c) =>
    q<VolunteerCategory>(
      c,
      `update volunteer_categories set name = $2 where id = $1 returning ${CATEGORY_COLS}`,
      [categoryId, name],
    ),
  );
  const row = rows[0];
  if (!row) throw new VolunteerCategoryNotFoundError();
  return row;
}

async function setActive(ctx: DbContext, categoryId: string, isActive: boolean): Promise<VolunteerCategory> {
  const rows = await withDbContext(ctx, (c) =>
    q<VolunteerCategory>(
      c,
      `update volunteer_categories set is_active = $2 where id = $1 returning ${CATEGORY_COLS}`,
      [categoryId, isActive],
    ),
  );
  const row = rows[0];
  if (!row) throw new VolunteerCategoryNotFoundError();
  return row;
}

export async function deactivate(ctx: DbContext, categoryId: string): Promise<VolunteerCategory> {
  return setActive(ctx, categoryId, false);
}

export async function reactivate(ctx: DbContext, categoryId: string): Promise<VolunteerCategory> {
  return setActive(ctx, categoryId, true);
}

/**
 * First-run seed. If staff has already configured any category, rerunning the
 * general seed leaves their vocabulary alone rather than recreating old names.
 */
export async function seedInitial(ctx: DbContext, names: readonly string[]): Promise<VolunteerCategory[]> {
  return withDbContext(ctx, async (c) => {
    await c.query(`lock table volunteer_categories in share row exclusive mode`);
    const countRows = await q<{ count: number }>(c, `select count(*)::int as count from volunteer_categories`);
    if (countRows[0]?.count === 0) {
      await c.query(
        `insert into volunteer_categories (name)
         select name from unnest($1::text[]) as seed(name)`,
        [names],
      );
    }
    return q<VolunteerCategory>(c, `select ${CATEGORY_COLS} from volunteer_categories order by lower(name), name`);
  });
}