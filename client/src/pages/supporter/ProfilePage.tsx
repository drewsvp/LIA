/**
 * SP-01 — Supporter profile (/profile). A logged-in donor/volunteer sees
 * every item donation and volunteer signup attached to their person record
 * (matched by email). Read-only; magic-link login is the only way in.
 * Unauthenticated visitors are sent to /login.
 */
import type { ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Redirect } from "wouter";
import { PublicLayout } from "../../components/public/PublicLayout";
import { useSession } from "../../hooks/useSession";

type ProfilePayload = {
  firstName: string;
  lastName: string;
  email: string;
  pledges: {
    id: string;
    requestId: string;
    requestTitle: string;
    orgName: string;
    createdAt: string;
    lines: { itemId: string; itemName: string; quantity: number }[];
  }[];
  signups: {
    id: string;
    requestId: string;
    requestTitle: string;
    orgName: string;
    createdAt: string;
    roles: { roleId: string; roleName: string }[];
  }[];
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function SupporterProfilePage(): ReactElement | null {
  const { session, isLoading: sessionLoading } = useSession();
  const { data, isLoading, isError } = useQuery<ProfilePayload>({
    queryKey: ["/api/supporter/profile"],
    enabled: session?.authenticated === true,
  });

  if (sessionLoading) return null;
  if (!session?.authenticated) return <Redirect to="/login" replace />;

  return (
    <PublicLayout>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 16px 64px" }}>
        <h1
          style={{
            textAlign: "center",
            textTransform: "uppercase",
            fontSize: "clamp(24px, 4vw, 34px)",
            letterSpacing: 1,
            margin: "0 0 8px",
          }}
        >
          My Profile
        </h1>
        {data && (
          <p style={{ textAlign: "center", fontSize: 15, margin: "0 0 32px" }}>
            {data.firstName} {data.lastName} &middot; {data.email}
          </p>
        )}

        {isLoading && <p style={{ textAlign: "center", fontSize: 15 }}>Loading your history…</p>}
        {isError && (
          <p role="alert" style={{ textAlign: "center", fontSize: 15, fontWeight: 700, color: "var(--color-navy)" }}>
            We couldn't load your profile. Please refresh the page to try again.
          </p>
        )}

        {data && (
          <>
            <h2 className="pb2-section-heading">My Item Donations</h2>
            {data.pledges.length === 0 ? (
              <p style={{ textAlign: "center", fontSize: 15 }}>
                No item donations yet. <Link href="/items">Browse current item needs</Link>.
              </p>
            ) : (
              data.pledges.map((pledge) => (
                <div key={pledge.id} className="pb2-item-card">
                  <div className="pb2-item-card-header">
                    {formatDate(pledge.createdAt)}
                  </div>
                  <div style={{ padding: "14px 16px", fontSize: 14 }}>
                    <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 16 }}>
                      <Link href={`/items/${pledge.requestId}`}>{pledge.requestTitle}</Link>
                    </p>
                    <p style={{ margin: "0 0 8px" }}>
                      <span className="pub-label">Organization:</span> {pledge.orgName}
                    </p>
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {pledge.lines.map((line) => (
                        <li key={line.itemId}>
                          {line.itemName} &times; {line.quantity}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))
            )}

            <h2 className="pb2-section-heading" style={{ marginTop: 40 }}>
              My Volunteer Signups
            </h2>
            {data.signups.length === 0 ? (
              <p style={{ textAlign: "center", fontSize: 15 }}>
                No volunteer signups yet. <Link href="/volunteer">Browse volunteer opportunities</Link>.
              </p>
            ) : (
              data.signups.map((signup) => (
                <div key={signup.id} className="pb2-item-card">
                  <div className="pb2-item-card-header">
                    {formatDate(signup.createdAt)}
                  </div>
                  <div style={{ padding: "14px 16px", fontSize: 14 }}>
                    <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 16 }}>
                      <Link href={`/volunteer/${signup.requestId}`}>{signup.requestTitle}</Link>
                    </p>
                    <p style={{ margin: "0 0 8px" }}>
                      <span className="pub-label">Organization:</span> {signup.orgName}
                    </p>
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {signup.roles.map((role) => (
                        <li key={role.roleId}>{role.roleName}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </PublicLayout>
  );
}
