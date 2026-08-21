/**
 * Shared admin shell (ADMIN-01 §4) — built once, wraps all eight surfaces.
 *
 * Persistent left nav of the eight admin surfaces with the current one
 * marked; pending-count badges beside the three approval queues (zero = no
 * badge); a failed-email count for the trailing seven days linking to
 * ADMIN-06 filtered to failures, rendered only above zero. Dense, no
 * decoration: Design.md color/type tokens, no card shadow or radius.
 *
 * A DB-routine-health banner appears below the nav when the startup check
 * found missing functions or triggers (status "missing"), or when the catalog
 * query could not complete and parity is unverified (status "error"). The
 * banner names each missing routine so the repair step is obvious. "pending"
 * (server just started, check not yet returned) is not surfaced — it resolves
 * quickly and is not an actionable state for staff.
 */
import type { ReactElement, ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { SURFACE_ROUTES, STAFF_ADMIN_ONLY_SURFACES } from "@shared/routes";
import { useSession } from "../../hooks/useSession";

export type AdminNavCounts = {
  pendingOrganizations: number;
  pendingRequests: number;
  pendingMembers: number;
  failedEmailsLastSevenDays: number;
};

type DbHealthResult = {
  status: "pending" | "ok" | "missing" | "error";
  ok: boolean;
  checkedAt: string | null;
  missingFunctions: string[];
  missingTriggers: Array<{ name: string; table: string }>;
  requiredFunctionCount: number;
  requiredTriggerCount: number;
  errorMessage?: string;
};

/** Which nav rows carry a queue badge (§4: organizations, requests, members). */
const BADGE_FIELDS: Record<string, keyof AdminNavCounts> = {
  "ADMIN-01": "pendingOrganizations",
  "ADMIN-02": "pendingRequests",
  "ADMIN-03": "pendingMembers",
};

const ALL_ADMIN_ROUTES = SURFACE_ROUTES.filter((r) => r.area === "admin");

export function AdminShell({ children }: { children: ReactNode }): ReactElement {
  const [location] = useLocation();
  const { data: counts } = useQuery<AdminNavCounts>({ queryKey: ["/api/admin/nav-counts"] });
  const { data: dbHealth } = useQuery<DbHealthResult>({
    queryKey: ["/api/admin/db-health"],
    // This only changes when the server restarts; a long stale time avoids
    // pointless re-fetching while still picking up a fresh deploy on next load.
    staleTime: 5 * 60 * 1000,
  });
  const { session } = useSession();
  // Approver sessions never see the staff-admin-only rows (ADMIN-04/05/08):
  // the nav mirrors the server's requireStaffAdmin boundary exactly as the
  // route gate does, so those surfaces stay undiscoverable.
  const ADMIN_ROUTES =
    session?.staffRole === "staff_admin"
      ? ALL_ADMIN_ROUTES
      : ALL_ADMIN_ROUTES.filter((r) => !STAFF_ADMIN_ONLY_SURFACES.has(r.id));

  // Show the banner for "missing" (named routines) or "error" (check failed,
  // parity unverified). Never show for "pending" or "ok".
  const showDbBanner =
    dbHealth?.status === "missing" || dbHealth?.status === "error";

  return (
    <div className="adm-layout">
      <nav className="adm-nav" aria-label="Admin">
        <ul className="adm-nav-list">
          {ADMIN_ROUTES.map((route) => {
            const current = location === route.path || location.startsWith(`${route.path}/`);
            const field = BADGE_FIELDS[route.id];
            const count = counts && field ? counts[field] : 0;
            return (
              <li key={route.id}>
                <Link
                  href={route.path}
                  className={current ? "adm-nav-link adm-nav-current" : "adm-nav-link"}
                  aria-current={current ? "page" : undefined}
                >
                  {route.title}
                  {count > 0 && <span className="adm-badge">{count}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
        {counts && counts.failedEmailsLastSevenDays > 0 && (
          <Link href="/admin/email?status=failed" className="adm-nav-alert">
            Failed emails (7 days): {counts.failedEmailsLastSevenDays}
          </Link>
        )}
        {showDbBanner && (
          <div className="adm-nav-alert adm-nav-alert--db" role="alert">
            {dbHealth?.status === "error" ? (
              <>
                <strong>DB routine check failed</strong>
                <p className="adm-db-missing-fix">
                  Routine parity could not be verified at startup — check server
                  logs. Apply migrations/0045_restore_routine_parity.sql if in
                  doubt after a publish.
                </p>
              </>
            ) : (
              <>
                <strong>DB routines missing</strong>
                {dbHealth?.missingFunctions && dbHealth.missingFunctions.length > 0 && (
                  <ul className="adm-db-missing-list">
                    {dbHealth.missingFunctions.map((fn) => (
                      <li key={fn}>
                        function: <code>{fn}</code>
                      </li>
                    ))}
                  </ul>
                )}
                {dbHealth?.missingTriggers && dbHealth.missingTriggers.length > 0 && (
                  <ul className="adm-db-missing-list">
                    {dbHealth.missingTriggers.map((t) => (
                      <li key={`${t.name}|${t.table}`}>
                        trigger: <code>{t.name}</code> on <code>{t.table}</code>
                      </li>
                    ))}
                  </ul>
                )}
                <span className="adm-db-missing-fix">
                  Fix: apply migrations/0045_restore_routine_parity.sql
                </span>
              </>
            )}
          </div>
        )}
      </nav>
      <div className="adm-content">{children}</div>
    </div>
  );
}
