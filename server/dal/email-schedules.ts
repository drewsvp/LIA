/** Template-keyed recurring and one-time email schedule configuration. */
import { q, withDbContext, type DbContext } from "../db/client";
import {
  DIGEST_TEMPLATE_KEY,
  PACIFIC_TIME_ZONE,
  pacificClock,
  type ScheduleFields,
} from "../digest-schedule";

export type EmailSchedule = ScheduleFields & {
  templateKey: string;
  updatedAt: string;
  updatedBy: string | null;
  updatedByName: string | null;
};

const COLS = `
  s.template_key as "templateKey", s.active,
  s.weekly_weekday as "weeklyWeekday", s.weekly_minutes as "weeklyMinutes",
  s.one_time_at as "oneTimeAt", s.updated_at as "updatedAt", s.updated_by as "updatedBy",
  case when p.id is not null then p.first_name || ' ' || p.last_name else null end as "updatedByName"`;
const RETURNING_COLS = `
  template_key as "templateKey", active,
  weekly_weekday as "weeklyWeekday", weekly_minutes as "weeklyMinutes",
  one_time_at as "oneTimeAt", updated_at as "updatedAt", updated_by as "updatedBy",
  null::text as "updatedByName"`;

async function ensureDigestSchedule(ctx: DbContext): Promise<void> {
  await withDbContext(ctx, (c) =>
    q(
      c,
      `insert into email_schedules (template_key, active, weekly_weekday, weekly_minutes)
       values ($1, true, 4, 540) on conflict (template_key) do nothing`,
      [DIGEST_TEMPLATE_KEY],
    ),
  );
}

export async function listSchedules(ctx: DbContext): Promise<EmailSchedule[]> {
  await ensureDigestSchedule(ctx);
  return withDbContext(ctx, (c) =>
    q<EmailSchedule>(
      c,
      `select ${COLS} from email_schedules s
       left join users u on u.id = s.updated_by
       left join people p on p.id = u.person_id`,
    ),
  );
}

export async function getSchedule(ctx: DbContext, templateKey: string): Promise<EmailSchedule | null> {
  if (templateKey === DIGEST_TEMPLATE_KEY) await ensureDigestSchedule(ctx);
  const rows = await withDbContext(ctx, (c) =>
    q<EmailSchedule>(
      c,
      `select ${COLS} from email_schedules s
       left join users u on u.id = s.updated_by
       left join people p on p.id = u.person_id
       where s.template_key = $1`,
      [templateKey],
    ),
  );
  return rows[0] ?? null;
}

export async function saveSchedule(
  ctx: DbContext,
  templateKey: string,
  input: ScheduleFields & { updatedByUserId: string },
): Promise<EmailSchedule> {
  const rows = await withDbContext(ctx, (c) =>
    q<EmailSchedule>(
      c,
      `insert into email_schedules (template_key, active, weekly_weekday, weekly_minutes, one_time_at, updated_by)
       values ($1, $2, $3, $4, $5::timestamptz, $6)
       on conflict (template_key) do update set
         active = excluded.active, weekly_weekday = excluded.weekly_weekday,
         weekly_minutes = excluded.weekly_minutes, one_time_at = excluded.one_time_at,
         updated_at = now(), updated_by = excluded.updated_by
       returning ${RETURNING_COLS}`,
      [templateKey, input.active, input.weeklyWeekday, input.weeklyMinutes, input.oneTimeAt, input.updatedByUserId],
    ),
  );
  const row = rows[0];
  if (!row) throw new Error("emailSchedules.saveSchedule returned no row");
  return row;
}

/** Converts and validates a Pacific wall-clock value, including DST gaps. */
export async function pacificLocalToInstant(ctx: DbContext, date: string, time: string): Promise<string | null> {
  const local = `${date} ${time}`;
  const rows = await withDbContext(ctx, (c) =>
    q<{ instant: string; roundTrip: string }>(
      c,
      `select ($1::timestamp at time zone $2) as instant,
              to_char(($1::timestamp at time zone $2) at time zone $2, 'YYYY-MM-DD HH24:MI') as "roundTrip"`,
      [local, PACIFIC_TIME_ZONE],
    ),
  );
  const row = rows[0];
  return row?.roundTrip === local ? row.instant : null;
}

/**
 * Recurring DST policy: PostgreSQL shifts a nonexistent spring time forward
 * by the size of the gap and resolves a repeated fall time to standard time
 * (the second occurrence). The scheduler and next-send display both use this
 * exact conversion.
 */
export async function pacificWeeklyLocalToInstant(ctx: DbContext, date: string, minutes: number): Promise<string> {
  const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const rows = await withDbContext(ctx, (c) =>
    q<{ instant: string }>(c, `select ($1::timestamp at time zone $2) as instant`, [
      `${date} ${time}`,
      PACIFIC_TIME_ZONE,
    ]),
  );
  const instant = rows[0]?.instant;
  if (!instant) throw new Error(`emailSchedules.pacificWeeklyLocalToInstant returned no instant for ${date} ${time}`);
  return instant;
}

/** Earliest active scheduled send, returned as an absolute instant for the API. */
export async function nextSendAt(ctx: DbContext, schedule: EmailSchedule, now = new Date()): Promise<string | null> {
  if (!schedule.active) return null;
  const minutes = schedule.weeklyMinutes;
  const clock = pacificClock(now);
  const addDays = (date: string, days: number): string => {
    const [year, month, day] = date.split("-").map(Number);
    return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
  };
  const daysSinceWeekday = (clock.weekday - schedule.weeklyWeekday + 7) % 7;
  let latestDate = addDays(clock.date, -daysSinceWeekday);
  let latestAt = await pacificWeeklyLocalToInstant(ctx, latestDate, minutes);
  if (new Date(latestAt).getTime() > now.getTime()) {
    latestDate = addDays(latestDate, -7);
    latestAt = await pacificWeeklyLocalToInstant(ctx, latestDate, minutes);
  }
  const latestWasConfigured = new Date(latestAt).getTime() >= new Date(schedule.updatedAt).getTime();
  let weeklyCatchUp: string | null = null;
  if (latestWasConfigured) {
    const claimed = await withDbContext(ctx, (c) =>
      q<{ claimed: boolean }>(
        c,
        `select exists(
           select 1 from digest_runs where occurrence_key = $1
         ) as claimed`,
        [`weekly:${latestDate}`],
      ),
    );
    // Use "now" rather than a past timestamp: the missed occurrence is due
    // immediately on the next scheduler pass.
    if (!claimed[0]?.claimed) weeklyCatchUp = now.toISOString();
  }
  const daysUntilWeekday = (schedule.weeklyWeekday - clock.weekday + 7) % 7;
  let recurringDate = addDays(clock.date, daysUntilWeekday);
  let recurring = await pacificWeeklyLocalToInstant(ctx, recurringDate, minutes);
  // Compare absolute instants, not wall-clock minutes: on spring-forward day
  // a configured 02:30 recurs at 03:30, not at 03:00 or next week.
  if (new Date(recurring).getTime() <= now.getTime()) {
    recurringDate = addDays(recurringDate, 7);
    recurring = await pacificWeeklyLocalToInstant(ctx, recurringDate, minutes);
  }
  // An overdue one-time schedule is due immediately (commonly after resume).
  const oneTime =
    schedule.oneTimeAt === null
      ? null
      : new Date(schedule.oneTimeAt).getTime() <= now.getTime()
        ? now.toISOString()
        : schedule.oneTimeAt;
  return [weeklyCatchUp, oneTime, recurring]
    .filter((value): value is string => value !== null)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0]!;
}

/** Clear exactly the one-time value this due pass observed; concurrent callers are harmless. */
export async function consumeOneTimeIfMatches(ctx: DbContext, templateKey: string, oneTimeAt: string): Promise<void> {
  await withDbContext(ctx, (c) =>
    q(c, `update email_schedules set one_time_at = null, updated_at = now() where template_key = $1 and one_time_at = $2::timestamptz`, [
      templateKey,
      oneTimeAt,
    ]),
  );
}