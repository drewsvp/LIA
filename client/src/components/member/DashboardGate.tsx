/**
 * MP-02 — Post-login routing for every /dashboard route.
 *
 * Branches on the count of ACTIVE memberships (resolved by id through
 * org_memberships — never a name comparison, Handbook §6 invariant 1):
 *   0  → pending-approval message, no dashboard access
 *   1  → straight through, scoped to that organization
 *   2+ → organization chooser until a selection is held in the session
 *
 * Session state is re-verified on every dashboard navigation so a member
 * removed mid-session loses access on their next request, not their next
 * login (§12). A failed membership resolution renders a stated error —
 * never a silent fallback to some default organization (§12).
 *
 * An unauthenticated arrival is sent to /login; a magic-link failure
 * redirect (?error=…) is forwarded so MP-01 can offer a fresh link.
 */
import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Redirect, useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "../../hooks/useSession";
import { apiRequest } from "../../lib/queryClient";
import type { SessionInfo } from "@shared/types";

function PendingApproval(): ReactElement {
  return (
    <main className="mp2-message-page">
      <p className="mp2-pending">
        Your account is set up, but you&rsquo;re not yet an active member of an organization. Check
        with whoever invited you, or reach out to{" "}
        <a href="mailto:christina@defendingthecause.org">christina@defendingthecause.org</a> if you
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

export function DashboardGate({ children }: { children: ReactNode }): ReactElement | null {
  const { session, isLoading, isError } = useSession();
  const queryClient = useQueryClient();
  const [location] = useLocation();
  const search = useSearch();

  // Fresh membership check on every dashboard navigation (§12: removal takes
  // effect on the next request). Server guards enforce the same per API call.
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ["/api/session"] });
  }, [location, queryClient]);

  if (isLoading) return null;
  if (isError) return <StatedError />;
  if (!session?.authenticated) {
    const error = new URLSearchParams(search).get("error");
    return <Redirect to={error ? `/login?error=${encodeURIComponent(error)}` : "/login"} replace />;
  }
  if (session.memberships.length === 0) return <PendingApproval />;
  if (session.activeOrgId === null) return <OrgChooser memberships={session.memberships} />;
  return <>{children}</>;
}
