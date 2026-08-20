/** Pacific-clock helpers shared by digest scheduling, APIs, and admin UI data. */
export const PACIFIC_TIME_ZONE = "America/Los_Angeles";
export const DIGEST_TEMPLATE_KEY = "digest_new_needs";
export const SCHEDULABLE_TEMPLATE_KEYS: ReadonlySet<string> = new Set([DIGEST_TEMPLATE_KEY]);

export type ScheduleFields = {
  active: boolean;
  weeklyWeekday: number;
  weeklyMinutes: number;
  oneTimeAt: string | null;
};

export type PacificClock = { date: string; minutesOfDay: number; weekday: number };

export function pacificClock(now: Date): PacificClock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PACIFIC_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  const hour = Number(get("hour")) % 24; // Some ICU builds return 24 at midnight.
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutesOfDay: hour * 60 + Number(get("minute")),
    weekday,
  };
}

export function weekdayLabel(weekday: number): string {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][weekday] ?? "Unknown day";
}

export function localDateAndTime(iso: string): { date: string; time: string } {
  const clock = pacificClock(new Date(iso));
  const hour = String(Math.floor(clock.minutesOfDay / 60)).padStart(2, "0");
  const minute = String(clock.minutesOfDay % 60).padStart(2, "0");
  return { date: clock.date, time: `${hour}:${minute}` };
}
