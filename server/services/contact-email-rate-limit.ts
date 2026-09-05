import {
  profileEmailChangeCooldownLimiter,
  profileEmailChangeIpLimiter,
  profileEmailChangeTargetLimiter,
  profileEmailChangeUserLimiter,
  type FixedWindowLimiter,
} from "../auth/rate-limit";

type Reservation = readonly [FixedWindowLimiter, string];

function reservations(userId: string, email: string, ip: string): Reservation[] {
  return [
    [profileEmailChangeUserLimiter, userId],
    [profileEmailChangeTargetLimiter, email],
    [profileEmailChangeIpLimiter, ip],
    [profileEmailChangeCooldownLimiter, `${userId}:${email}`],
  ];
}

export function reserveContactEmailSend(userId: string, email: string, ip: string): boolean {
  const taken: Reservation[] = [];
  for (const entry of reservations(userId, email, ip)) {
    if (!entry[0].consume(entry[1])) {
      // FixedWindowLimiter increments before reporting an exhausted bucket.
      // Roll that failed attempt back as well as every earlier reservation.
      entry[0].unconsume(entry[1]);
      for (const prior of taken) prior[0].unconsume(prior[1]);
      return false;
    }
    taken.push(entry);
  }
  return true;
}

export function refundContactEmailSend(userId: string, email: string, ip: string): void {
  for (const entry of reservations(userId, email, ip)) entry[0].unconsume(entry[1]);
}