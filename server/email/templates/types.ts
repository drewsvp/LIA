/**
 * Product template contract (docs/email/TEMPLATES.md).
 *
 * `required` lists the variables that MUST resolve for the send to go out:
 * an empty/missing one blocks the send, which is logged failed with the
 * reason (Handbook section 13, the blank-name fix). Variables typed
 * `string | null` are optional: the rendering omits their line entirely
 * when null. Structured list variables (items/roles) count as unresolved
 * when the array is empty.
 *
 * ADMIN-10 additions: each template carries plain-words trigger/recipient
 * descriptions for the admin surface, `defaultCopy` (the editable free-text
 * copy — subject, heading, paragraphs — with {placeholder} tokens), and
 * `sample` variables for the rendered preview. `render` accepts an optional
 * copy override; the hardcoded defaultCopy is always the fallback.
 */
import type { Rendered, TemplateCopy, TemplateSectionDef, BodyBlock } from "../render";

export type ProductEntityType =
  | "organization"
  | "item_request"
  | "volunteer_request"
  | "org_membership"
  | "item_pledge"
  | "volunteer_signup"
  | "digest_run";

export type ProductTemplate<V extends Record<string, unknown>> = {
  key: string;
  entityType: ProductEntityType;
  /** Variables that block the send when they do not resolve. */
  required: readonly (keyof V & string)[];
  /** Plain-words description of what fires this email (admin surface). */
  trigger: string;
  /** Plain-words description of who receives it (admin surface). */
  recipients: string;
  /**
   * True only when the recipient list is genuinely configurable — the staff
   * notification templates. Structural recipients (the requesting org's
   * contact, the donor) are fixed and shown as such.
   */
  recipientsConfigurable: boolean;
  /** Editable copy defaults; the fallback when no override exists. */
  defaultCopy: TemplateCopy;
  /** Sample variables used to render the admin preview. */
  sample: V;
  /**
   * Named auto-generated sections the body editor can insert as chips.
   * Absent for templates whose structural content is not section-based.
   */
  sections?: TemplateSectionDef<V>[];
  /**
   * Default block ordering that exactly mirrors the legacy render() sequence.
   * Used by the body editor to initialise content when no stored bodyBlocks override exists.
   * Each paragraph block carries the raw template text (with {placeholder} tokens) from defaultCopy.
   */
  defaultBlocks?: BodyBlock[];
  render: (vars: V, copy?: TemplateCopy) => Rendered;
};

export type ItemLine = { name: string; quantity: number };
