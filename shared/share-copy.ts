/**
 * Share copy — the SINGLE source of the wording used when a public surface is
 * shared. The share button's pre-fill text and the server-rendered link-preview
 * description must be byte-identical per surface, so both the client component
 * and the server meta-tag renderer import from here rather than restating the
 * strings.
 */

/** Brand suffix used by every share title. */
export const SHARE_SITE_NAME = "Love in Action Database";

/** Query flag appended to shared links so shared traffic is distinguishable. */
export const SHARE_REF_PARAM = "ref";
export const SHARE_REF_VALUE = "share";

/** Canonical (un-tagged) paths of the three shareable public surfaces. */
export function organizationPath(slug: string): string {
  return `/o/${slug}`;
}

export function itemRequestPath(requestId: string): string {
  return `/items/${requestId}`;
}

export function volunteerRequestPath(requestId: string): string {
  return `/volunteer/${requestId}`;
}

// ---------------------------------------------------------------- titles

export function organizationShareTitle(orgName: string): string {
  return `${orgName} — ${SHARE_SITE_NAME}`;
}

export function itemShareTitle(requestTitle: string, orgName: string): string {
  return `${requestTitle} — ${orgName}`;
}

export function volunteerShareTitle(requestTitle: string, orgName: string): string {
  return `${requestTitle} — ${orgName}`;
}

// ---------------------------------------------------------------- descriptions

/** The org's own mission speaks for it; the fallback only covers a blank one. */
export function organizationShareDescription(orgName: string, mission: string | null): string {
  const trimmed = (mission ?? "").trim();
  if (trimmed !== "") return trimmed;
  return `See ${orgName}'s current needs and find out how you can help.`;
}

export function itemShareDescription(orgName: string): string {
  return `Help me help ${orgName} meet this need.`;
}

export function volunteerShareDescription(orgName: string): string {
  return `Help me help ${orgName} — they need volunteers like you.`;
}
