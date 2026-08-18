/**
 * Route table — FINAL. Published by the foundation task; paths must not change.
 * Surface IDs map to Handbook.md section 11. Client page routes and server
 * routing both derive from this file so they can never disagree.
 */

export type SurfaceRoute = {
  /** Surface ID, e.g. "MP-04". MP-02 has no route of its own. */
  id: string;
  /** Path pattern in Express/wouter syntax. */
  path: string;
  /** Human-readable name used on placeholder pages. */
  title: string;
  /** Which shell the surface belongs to. */
  area: "member" | "public" | "admin";
};

export const SURFACE_ROUTES: readonly SurfaceRoute[] = [
  // Member portal
  { id: "MP-01", path: "/login", title: "Login", area: "member" },
  { id: "MP-03", path: "/signup", title: "Organization signup", area: "member" },
  { id: "MP-04", path: "/dashboard", title: "Member dashboard", area: "member" },
  { id: "MP-05", path: "/dashboard/organization", title: "My organization", area: "member" },
  { id: "MP-06", path: "/dashboard/members/new", title: "Invite member", area: "member" },
  { id: "MP-07", path: "/dashboard/items/new", title: "New item request", area: "member" },
  { id: "MP-08", path: "/dashboard/items/:id/add", title: "Add items", area: "member" },
  { id: "MP-09", path: "/dashboard/items/:id/edit", title: "Edit item request", area: "member" },
  { id: "MP-10", path: "/dashboard/volunteer/new", title: "New volunteer request", area: "member" },
  { id: "MP-11", path: "/dashboard/volunteer/:id/add", title: "Add volunteer roles", area: "member" },
  { id: "MP-12", path: "/dashboard/volunteer/:id/edit", title: "Edit volunteer request", area: "member" },
  { id: "MP-13", path: "/dashboard/supporters", title: "Supporters", area: "member" },

  // Public
  { id: "PB-00", path: "/", title: "Home", area: "public" },
  { id: "PB-01", path: "/items", title: "Provide an item", area: "public" },
  { id: "PB-02", path: "/items/:id", title: "Item request detail", area: "public" },
  { id: "PB-03", path: "/volunteer", title: "Volunteer your time", area: "public" },
  { id: "PB-04", path: "/volunteer/:id", title: "Volunteer request detail", area: "public" },
  { id: "PB-05", path: "/subscribe", title: "Subscribe to the digest", area: "public" },
  { id: "PB-05", path: "/unsubscribe/:token", title: "Unsubscribe", area: "public" },
  { id: "PB-06", path: "/about", title: "About", area: "public" },

  // Staff admin
  { id: "ADMIN-01", path: "/admin/organizations", title: "Organizations", area: "admin" },
  { id: "ADMIN-02", path: "/admin/requests", title: "Requests", area: "admin" },
  { id: "ADMIN-03", path: "/admin/members", title: "Members", area: "admin" },
  { id: "ADMIN-04", path: "/admin/people/review", title: "People review", area: "admin" },
  { id: "ADMIN-05", path: "/admin/populations", title: "Populations", area: "admin" },
  { id: "ADMIN-06", path: "/admin/email", title: "Email log", area: "admin" },
  { id: "ADMIN-07", path: "/admin/activity", title: "Activity", area: "admin" },
  { id: "ADMIN-08", path: "/admin/subscribers", title: "Subscribers", area: "admin" },
  { id: "ADMIN-09", path: "/admin/roles", title: "Roles", area: "admin" },
] as const;

/**
 * Legacy Wix paths. Resolve on legacy_wix_id and 301 to the new path.
 * An unmatched identifier returns the corresponding browse page, not a 404.
 */
export const LEGACY_ROUTES = {
  itemRequest: "/area-needs-request/:legacyId",
  volunteerRequest: "/area-needs-volunteer-request/:legacyId",
} as const;

/**
 * Admin surfaces whose server routes are gated requireStaffAdmin (ADMIN-04
 * people review, ADMIN-05 populations, ADMIN-08 subscribers). The client
 * mirrors that boundary: staff approvers get the not-found page instead of
 * the surface and no nav row, so it stays undiscoverable rather than
 * forbidden — same contract as the byte-identical API 404s.
 */
export const STAFF_ADMIN_ONLY_SURFACES: ReadonlySet<string> = new Set(["ADMIN-04", "ADMIN-05", "ADMIN-08", "ADMIN-09"]);
