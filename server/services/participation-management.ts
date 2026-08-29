import { q, withDbContext, type DbContext } from "../db/client";

export type ParticipationKind = "donation" | "volunteer";
export type ParticipationAction = "edit" | "cancel" | "reinstate";

export type ManageDonationInput = {
  kind: "donation";
  id: string;
  action: ParticipationAction;
  lines?: Array<{ itemId: string; quantity: number }>;
  notes?: string | null;
  reason: string;
  actorUserId: string;
  expectedUpdatedAt: string;
  expectedVersion: number;
};

export type ManageVolunteerInput = {
  kind: "volunteer";
  id: string;
  action: ParticipationAction;
  roleIds?: string[];
  notes?: string | null;
  reason: string;
  actorUserId: string;
  expectedUpdatedAt: string;
  expectedVersion: number;
};

export type ManageParticipationInput = ManageDonationInput | ManageVolunteerInput;

export type ParticipationManagementErrorCode =
  | "not_found"
  | "stale"
  | "already_cancelled"
  | "already_active"
  | "insufficient_quantity"
  | "role_full"
  | "invalid_relationship"
  | "invalid_input";

export class ParticipationManagementError extends Error {
  constructor(public readonly code: ParticipationManagementErrorCode, message: string) {
    super(message);
    this.name = "ParticipationManagementError";
  }
}

function mapError(error: unknown): never {
  const message = typeof error === "object" && error !== null
    ? String((error as { message?: unknown }).message ?? "")
    : "";
  const mappings: Array<[string, ParticipationManagementErrorCode, string]> = [
    ["participation_not_found", "not_found", "Participation record not found."],
    ["participation_stale", "stale", "This participation record changed while you were editing. Reload it and try again."],
    ["participation_already_cancelled", "already_cancelled", "This participation record is already cancelled."],
    ["participation_already_active", "already_active", "This participation record is already active."],
    ["participation_insufficient_quantity", "insufficient_quantity", "There is not enough remaining item quantity for that change."],
    ["participation_role_full", "role_full", "One of the selected volunteer roles no longer has room."],
    ["participation_item_not_in_request", "invalid_relationship", "One of the selected items does not belong to this request."],
    ["participation_role_not_in_request", "invalid_relationship", "One of the selected roles does not belong to this request."],
  ];
  for (const [prefix, code, readable] of mappings) {
    if (message.startsWith(prefix)) throw new ParticipationManagementError(code, readable);
  }
  if (message.startsWith("participation_") || message.includes("invalid input syntax for type uuid")) {
    throw new ParticipationManagementError("invalid_input", "The participation change is invalid.");
  }
  throw error;
}

export async function manageParticipation(input: ManageParticipationInput): Promise<void> {
  const ctx: DbContext = { kind: "staff", userId: input.actorUserId };
  try {
    await withDbContext(ctx, async (client) => {
      const versionRows = await q<{ version: number }>(
        client,
        `select participation_version::int as version
           from ${input.kind === "donation" ? "item_pledges" : "volunteer_signups"}
          where id = $1
          for update`,
        [input.id],
      );
      if (versionRows.length === 0) throw new ParticipationManagementError("not_found", "Participation record not found.");
      if (versionRows[0]!.version !== input.expectedVersion) {
        throw new ParticipationManagementError("stale", "This participation record changed while you were editing. Reload it and try again.");
      }
      if (input.kind === "donation") {
        const lines = input.lines?.map((line) => ({ itemId: line.itemId, quantity: line.quantity })) ?? null;
        await q(
          client,
          `select manage_item_pledge($1, $2, $3::jsonb, $4, $5, $6, $7::timestamptz)`,
          [
            input.id,
            input.action,
            lines === null ? null : JSON.stringify(lines),
            input.notes ?? null,
            input.reason,
            input.actorUserId,
            null,
          ],
        );
      } else {
        await q(
          client,
          `select manage_volunteer_signup($1, $2, $3::uuid[], $4, $5, $6, $7::timestamptz)`,
          [
            input.id,
            input.action,
            input.roleIds ?? null,
            input.notes ?? null,
            input.reason,
            input.actorUserId,
            null,
          ],
        );
      }
    });
  } catch (error) {
    mapError(error);
  }
}