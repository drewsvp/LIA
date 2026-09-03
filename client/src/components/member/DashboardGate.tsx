/**
 * MP-02 — Post-login routing for every /dashboard route.
 *
 * Branches on the count of ACTIVE memberships (resolved by id through
 * org_memberships — never a name comparison, Handbook §6 invariant 1):
 *   0  → pending-approval message, no dashboard access
 *   1  → straight through, scoped to that organization
 *   2+ → organization chooser until a selection is held in the session
 *
 * Every dashboard API request is re-authorized by the server. If one reports
 * that access changed, the shared request client refreshes this session
 * snapshot and the gate moves to the matching recovery state. Background
 * session refreshes deliberately keep already-authorized content mounted so
 * they cannot create a blank/remount/refetch loop.
 *
 * An unauthenticated arrival is sent to /login; a magic-link failure
 * redirect (?error=…) is forwarded so MP-01 can offer a fresh link.
 */
import { Fragment, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Redirect, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "../../hooks/useSession";
import { useSiteSettings } from "../../hooks/useSiteSettings";
import { apiRequest } from "../../lib/queryClient";
import type { SessionInfo } from "@shared/types";

function PendingApproval(): ReactElement {
  const { settings } = useSiteSettings();
  return (
    <main className="mp2-message-page">
      <p className="mp2-pending">
        Your account is set up, but you&rsquo;re not yet an active member of an organization. Check
        with whoever invited you, or reach out to{" "}
        <a href={`mailto:${settings.directorEmail}`}>{settings.directorEmail}</a> if you
        think this is a mistake.
      </p>
    </main>
  );
}

function StatedError(): ReactElement {
  return (
    <main className="mp2-message-page">
      <p className="mp2-error" role="alert">
        Something went wrong loading your organization access. Please try again.
      </p>
    </main>
  );
}

function OrgChooser({
  memberships,
}: {
  memberships: SessionInfo["memberships"];
}): ReactElement {
  const queryClient = useQueryClient();
  const [failed, setFailed] = useState(false);

  async function pick(orgId: string): Promise<void> {
    setFailed(false);
    try {
      await apiRequest("POST", "/api/session/active-org", { orgId });
      await queryClient.invalidateQueries();
    } catch {
      // No prior selection to fall back to: stay on the chooser, say so.
      setFailed(true);
    }
  }

  return (
    <main className="mp2-message-page">
      <div className="mp2-chooser">
        {memberships.map((m) => (
          <button
            key={m.orgId}
            type="button"
            className="mp2-chooser-org"
            onClick={() => void pick(m.orgId)}
          >
            {m.orgName}
          </button>
        ))}
        {failed ? (
          <p className="mp2-error" role="alert">
            Something went wrong. Please try again.
          </p>
        ) : null}
      </div>
    </main>
  );
}

function dashboardScopeKey(session: ReturnType<typeof useSession>["session"]): string {
  if (!session?.authenticated || session.user === null) return "anonymous";
  return [
    session.user.id,
    session.activeOrgId ?? "no-active-org",
    session.organizationContext?.id ?? "no-organization-context",
    session.supporterContext?.id ?? "no-supporter-context",
  ].join(":");
}

export function DashboardGate({ children }: { children: ReactNode }): ReactElement | null {
  const { session, isLoading, isError } = useSession();
  const search = useSearch();

  // Only the first session load blocks routing. A recovery refetch retains the
  // previous snapshot until the fresh response arrives, so valid dashboard
  // content stays mounted and cannot restart its own failing queries.
  if (isLoading) return null;
  if (isError) return <StatedError />;
  if (!session?.authenticated) {
    const error = new URLSearchParams(search).get("error");
    return <Redirect to={error ? `/login?error=${encodeURIComponent(error)}` : "/login"} replace />;
  }
  // Staff organization view is deliberately valid without a membership in the
  // target organization; the server scopes dashboard APIs to this context.
  if (session.organizationContext !== null && session.organizationContext !== undefined) {
    return <Fragment key={dashboardScopeKey(session)}>{children}</Fragment>;
  }
  // Supporter accounts have no org memberships by design — their home is the
  // profile page, never the pending-approval message or the dashboard.
  if (session.isSupporter && session.memberships.length === 0) return <Redirect to="/profile" replace />;
  if (session.memberships.length === 0) return <PendingApproval />;
  if (session.activeOrgId === null) return <OrgChooser memberships={session.memberships} />;
  return <Fragment key={dashboardScopeKey(session)}>{children}</Fragment>;
}
