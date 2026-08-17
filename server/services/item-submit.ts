/**
 * Item-request submission emails + the MP-08 submit flow.
 *
 * MP-08 submit and MP-09's status move to pending share one email contract
 * (MP-09 §6: "submission emails when status moves to pending, same as
 * MP-08"): staff_new_item_request to both staff addresses and
 * org_request_received to the submitting member, all queued INSIDE the same
 * transaction as the status transition. Dispatch happens after commit — a
 * send failure is an operations problem recorded on the email_log row,
 * never a member-facing one.
 *
 * A request with zero items cannot be submitted (MP-08 §1, MP-09 §7);
 * prepareSubmissionBundle throws NoItemsError and the caller returns the
 * surface's failure copy.
 */
import type { PoolClient } from "pg";
import { SYSTEM, withDbContext } from "../db/client";
import * as organizations from "../dal/organizations";
import * as people from "../dal/people";
import * as items from "../dal/items";
import * as itemRequests from "../dal/item-requests";
import { queueProductEmailInTx, absoluteUrl, type PendingDispatch } from "../email/send";
import { SURFACE_ROUTES } from "../../shared/routes";
import type { ItemRequest, Item, Organization, Person } from "../../shared/types";

const ADMIN_ITEMS_PATH = SURFACE_ROUTES.find((r) => r.id === "ADMIN-02")?.path ?? "/admin";

/** §1: a request cannot be submitted with no items. */
export class NoItemsError extends Error {
  constructor() {
    super("request has no items");
    this.name = "NoItemsError";
  }
}

export type SubmissionBundle = {
  org: Organization;
  primaryContact: Person | null;
  items: Item[];
};

/**
 * Pre-transaction reads for the submission emails. Throws NoItemsError when
 * the request has nothing on it — checked here so both MP-08 and MP-09 hit
 * the same gate before any write.
 */
export async function prepareSubmissionBundle(request: ItemRequest): Promise<SubmissionBundle> {
  const [org, requestItems] = await Promise.all([
    organizations.getById(SYSTEM, request.orgId),
    items.listByRequest(SYSTEM, request.id),
  ]);
  if (org === null) throw new Error(`item-submit: organization not found: ${request.orgId}`);
  if (requestItems.length === 0) throw new NoItemsError();
  // Loud, not silent: a missing contact leaves required template variables
  // unresolved and aborts the enclosing transaction via EmailConfigError.
  const primaryContact = org.primaryContactPersonId ? await people.getById(SYSTEM, org.primaryContactPersonId) : null;
  return { org, primaryContact, items: requestItems };
}

export type QueueSubmissionEmailsArgs = {
  /** The post-transition request row — titles and ids in the emails reflect what was saved. */
  request: ItemRequest;
  org: Organization;
  primaryContact: Person | null;
  requestContact: Person | null;
  items: Item[];
  /** Session user's email — org_request_received goes to the submitting member. */
  actorEmail: string;
};

export async function queueItemSubmissionEmailsInTx(
  c: PoolClient,
  args: QueueSubmissionEmailsArgs,
): Promise<PendingDispatch[]> {
  const { request, org, primaryContact, requestContact } = args;

  // Staff notification to both addresses (D53 pattern); a missing env is loud.
  const staffPrimary = (process.env.STAFF_NOTIFY_PRIMARY ?? "").trim();
  const staffSecondary = (process.env.STAFF_NOTIFY_SECONDARY ?? "").trim();
  const staffRecipients = [...new Set([staffPrimary, staffSecondary].filter((e) => e !== ""))];
  if (staffPrimary === "" || staffSecondary === "") {
    console.error(
      `[item-submit] request ${request.id}: STAFF_NOTIFY_PRIMARY/SECONDARY not fully configured — staff_new_item_request copies incomplete`,
    );
  }

  const dispatches: PendingDispatch[] = [];
  for (const toEmail of staffRecipients) {
    dispatches.push(
      await queueProductEmailInTx(c, {
        key: "staff_new_item_request",
        entityId: request.id,
        toEmail,
        vars: {
          itemRequestName: request.title,
          organizationName: org.name,
          organizationPrimaryContact: primaryContact ? `${primaryContact.firstName} ${primaryContact.lastName}` : "",
          organizationPrimaryContactEmail: primaryContact?.email ?? "",
          adminUrl: absoluteUrl(ADMIN_ITEMS_PATH),
        },
      }),
    );
  }
  dispatches.push(
    await queueProductEmailInTx(c, {
      key: "org_request_received",
      entityId: request.id,
      toEmail: args.actorEmail,
      vars: {
        itemOrVolunteer: "Item",
        organizationName: org.name,
        requestName: request.title,
        requestDescription: request.description,
        requestContactName: requestContact ? `${requestContact.firstName} ${requestContact.lastName}` : "",
        requestContactEmail: requestContact?.email ?? "",
        requestContactPhone: requestContact?.phone ?? null,
        requestId: request.id,
        itemsOrRoles: {
          kind: "item",
          rows: args.items.map((i) => ({ name: i.name, quantity: i.quantityRequested })),
        },
      },
    }),
  );
  return dispatches;
}

export type SubmitItemRequestInput = {
  /** Already ownership-checked by the route (§11). */
  request: ItemRequest;
  actorUserId: string;
  actorEmail: string;
};

export type SubmitItemRequestResult = {
  dispatches: PendingDispatch[];
};

export async function submitItemRequest(input: SubmitItemRequestInput): Promise<SubmitItemRequestResult> {
  const bundle = await prepareSubmissionBundle(input.request);
  const requestContact = input.request.contactPersonId
    ? await people.getById(SYSTEM, input.request.contactPersonId)
    : null;

  return withDbContext(SYSTEM, async (c) => {
    const updated = await itemRequests.transitionStatusInTx(c, {
      requestId: input.request.id,
      to: "pending",
      actorUserId: input.actorUserId,
    });
    const dispatches = await queueItemSubmissionEmailsInTx(c, {
      request: updated,
      org: bundle.org,
      primaryContact: bundle.primaryContact,
      requestContact,
      items: bundle.items,
      actorEmail: input.actorEmail,
    });
    return { dispatches };
  });
}
