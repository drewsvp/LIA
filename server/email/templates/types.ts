/**
 * Product template contract (docs/email/TEMPLATES.md).
 *
 * `required` lists the variables that MUST resolve for the send to go out:
 * an empty/missing one blocks the send, which is logged failed with the
 * reason (Handbook section 13, the blank-name fix). Variables typed
 * `string | null` are optional: the rendering omits their line entirely
 * when null. Structured list variables (items/roles) count as unresolved
 * when the array is empty.
 */
import type { Rendered } from "../render";

export type ProductEntityType =
  | "organization"
  | "item_request"
  | "volunteer_request"
  | "org_membership"
  | "item_pledge"
  | "volunteer_signup";

export type ProductTemplate<V extends Record<string, unknown>> = {
  key: string;
  entityType: ProductEntityType;
  /** Variables that block the send when they do not resolve. */
  required: readonly (keyof V & string)[];
  render: (vars: V) => Rendered;
};

export type ItemLine = { name: string; quantity: number };
