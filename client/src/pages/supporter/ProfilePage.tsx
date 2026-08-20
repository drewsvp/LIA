/**
 * SP-01 — Supporter profile (/profile). A logged-in donor/volunteer sees
 * every item donation and volunteer signup attached to their person record
 * (matched by email). Read-only; magic-link login is the only way in.
 * Unauthenticated visitors are sent to /login.
 */
import { useEffect, useState, type ReactElement } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  volunteerInterests: {
    id: string;
    name: string;
    isActive: boolean;
    selected: boolean;
  }[];
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function SupporterProfilePage(): ReactElement | null {
  const { session, isLoading: sessionLoading } = useSession();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery<ProfilePayload>({
    queryKey: ["/api/supporter/profile"],
    enabled: session?.authenticated === true,
  });
  const [selectedInterests, setSelectedInterests] = useState<Set<string>>(new Set());
  const [savingInterests, setSavingInterests] = useState(false);
  const [interestResult, setInterestResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!data) return;
    setSelectedInterests(new Set(data.volunteerInterests.filter((interest) => interest.selected).map((interest) => interest.id)));
  }, [data]);

  async function saveVolunteerInterests(): Promise<void> {
    setSavingInterests(true);
    setInterestResult(null);
    try {
      const response = await fetch("/api/supporter/profile/volunteer-interests", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryIds: [...selectedInterests] }),
      });
      let payload: { message?: string; volunteerInterests?: ProfilePayload["volunteerInterests"] } = {};
      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        // The generic failure copy below covers a malformed response.
      }
      if (!response.ok) throw new Error(payload.message ?? "We couldn't save your volunteer interests.");
      if (payload.volunteerInterests) {
        queryClient.setQueryData<ProfilePayload>(["/api/supporter/profile"], (current) =>
          current ? { ...current, volunteerInterests: payload.volunteerInterests! } : current,
        );
      }
      setInterestResult({ kind: "ok", text: payload.message ?? "Volunteer interests saved." });
    } catch (err) {
      setInterestResult({
        kind: "error",
        text: err instanceof Error ? err.message : "We couldn't save your volunteer interests. Please try again.",
      });
    } finally {
      setSavingInterests(false);
    }
  }

  if (sessionLoading) return null;
  if (!session?.authenticated) return <Redirect to="/login" replace />;

  return (
    <PublicLayout>
      <div className="supporter-profile-page">
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
            <section aria-labelledby="volunteer-interests-heading" className="supporter-interests">
              <h2 id="volunteer-interests-heading" className="pb2-section-heading">
                Volunteer Interests
              </h2>
              <p className="supporter-interests-intro">
                Optional — choose any kinds of volunteer work you would like to hear about.
              </p>
              <p className="supporter-interest-count" aria-live="polite">
                {selectedInterests.size === 0
                  ? "No interests selected"
                  : `${selectedInterests.size} interest${selectedInterests.size === 1 ? "" : "s"} selected`}
              </p>
              <fieldset className="supporter-interest-options" disabled={savingInterests}>
                <legend className="sr-only">Kinds of volunteer work that interest you</legend>
                {data.volunteerInterests.map((interest) => (
                  <label
                    key={interest.id}
                    className={`supporter-interest-option${selectedInterests.has(interest.id) ? " is-selected" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedInterests.has(interest.id)}
                      onChange={(event) => {
                        setInterestResult(null);
                        setSelectedInterests((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(interest.id);
                          else next.delete(interest.id);
                          return next;
                        });
                      }}
                    />
                    <span>
                      {interest.name}
                      {!interest.isActive && (
                        <span className="supporter-interest-inactive"> No longer available — uncheck to remove</span>
                      )}
                    </span>
                  </label>
                ))}
              </fieldset>
              <button
                type="button"
                className="pub-btn supporter-interests-save"
                disabled={savingInterests}
                onClick={() => void saveVolunteerInterests()}
              >
                {savingInterests ? "Saving…" : "Save volunteer interests"}
              </button>
              {interestResult && (
                <p
                  role={interestResult.kind === "error" ? "alert" : "status"}
                  className={interestResult.kind === "error" ? "supporter-interest-error" : "supporter-interest-success"}
                >
                  {interestResult.text}
                </p>
              )}
            </section>

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
