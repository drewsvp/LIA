/**
 * SP-01 — Authenticated-user profile (/profile). Every logged-in person sees
 * their own history and can update their personal contact information.
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
  phone: string | null;
  pledges: {
    id: string;
    requestId: string;
    requestTitle: string;
    orgName: string;
    createdAt: string;
    status: "active" | "cancelled";
    cancelledAt: string | null;
    cancellationReason: string | null;
    lines: { itemId: string; itemName: string; quantity: number }[];
  }[];
  signups: {
    id: string;
    requestId: string;
    requestTitle: string;
    orgName: string;
    createdAt: string;
    status: "active" | "cancelled";
    cancelledAt: string | null;
    cancellationReason: string | null;
    roles: { roleId: string; roleName: string }[];
  }[];
  recentlyViewed: {
    requestKind: "item" | "volunteer";
    requestId: string;
    title: string;
    orgName: string;
    lastViewedAt: string;
    available: boolean;
    converted: boolean;
  }[];
  volunteerInterests: {
    id: string;
    name: string;
    isActive: boolean;
    selected: boolean;
  }[];
  matchingVolunteerAlertsEnabled: boolean;
  matchingVolunteerAlertsEligible: boolean;
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
  const [matchingAlertsEnabled, setMatchingAlertsEnabled] = useState(false);
  const [savingInterests, setSavingInterests] = useState(false);
  const [interestResult, setInterestResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [contactErrors, setContactErrors] = useState<Record<string, string>>({});
  const [savingContact, setSavingContact] = useState(false);
  const [contactResult, setContactResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!data) return;
    setSelectedInterests(new Set(data.volunteerInterests.filter((interest) => interest.selected).map((interest) => interest.id)));
    setMatchingAlertsEnabled(data.matchingVolunteerAlertsEnabled);
    setFirstName(data.firstName);
    setLastName(data.lastName);
    setEmail(data.email);
    setPhone(data.phone ?? "");
  }, [data]);

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("emailChange");
    if (result === "confirmed") {
      setContactResult({ kind: "ok", text: "Your new email address is confirmed and ready for future sign-in." });
    } else if (result === "conflict") {
      setContactResult({ kind: "error", text: "That email address is now in use by another account. Your current sign-in address was not changed." });
    } else if (result === "invalid") {
      setContactResult({ kind: "error", text: "That email confirmation link is invalid or has expired. Your current sign-in address was not changed." });
    }
  }, []);

  function validateContact(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (firstName.trim() === "") errors.firstName = "First name is required.";
    else if (firstName.trim().length > 100) errors.firstName = "First name must be 100 characters or fewer.";
    if (lastName.trim() === "") errors.lastName = "Last name is required.";
    else if (lastName.trim().length > 100) errors.lastName = "Last name must be 100 characters or fewer.";
    if (email.trim() === "") errors.email = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254) {
      errors.email = "Enter a valid email address.";
    }
    if (phone.trim().length > 50) errors.phone = "Phone must be 50 characters or fewer.";
    return errors;
  }

  async function saveContactInformation(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const errors = validateContact();
    setContactErrors(errors);
    setContactResult(null);
    if (Object.keys(errors).length > 0) return;

    setSavingContact(true);
    try {
      const response = await fetch("/api/supporter/profile/contact", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email, phone }),
      });
      let payload: {
        message?: string;
        fieldErrors?: Record<string, string>;
        firstName?: string;
        lastName?: string;
        email?: string;
        phone?: string | null;
        pendingEmail?: string | null;
      } = {};
      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        // The generic failure copy below covers a malformed response.
      }
      if (!response.ok) {
        if (payload.fieldErrors) setContactErrors(payload.fieldErrors);
        throw new Error(
          payload.message ??
            (response.status === 409
              ? "That email address is already in use by another account."
              : "We couldn't save your contact information. Please try again."),
        );
      }
      const updated = {
        firstName: payload.firstName ?? firstName.trim(),
        lastName: payload.lastName ?? lastName.trim(),
        email: payload.email ?? email.trim().toLowerCase(),
        phone: payload.phone ?? (phone.trim() === "" ? null : phone.trim()),
      };
      setFirstName(updated.firstName);
      setLastName(updated.lastName);
      setEmail(updated.email);
      setPhone(updated.phone ?? "");
      setContactErrors({});
      queryClient.setQueryData<ProfilePayload>(["/api/supporter/profile"], (current) =>
        current ? { ...current, ...updated } : current,
      );
      void queryClient.invalidateQueries({ queryKey: ["/api/session"] });
      setContactResult({ kind: "ok", text: payload.message ?? "Your contact information was saved." });
    } catch (err) {
      setContactResult({
        kind: "error",
        text: err instanceof Error ? err.message : "We couldn't save your contact information. Please try again.",
      });
    } finally {
      setSavingContact(false);
    }
  }

  async function saveVolunteerInterests(): Promise<void> {
    setSavingInterests(true);
    setInterestResult(null);
    try {
      const response = await fetch("/api/supporter/profile/volunteer-interests", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryIds: [...selectedInterests],
          ...(data?.matchingVolunteerAlertsEligible
            ? { matchingVolunteerAlertsEnabled: matchingAlertsEnabled }
            : {}),
        }),
      });
      let payload: {
        message?: string;
        volunteerInterests?: ProfilePayload["volunteerInterests"];
        matchingVolunteerAlertsEnabled?: boolean;
      } = {};
      try {
        payload = (await response.json()) as typeof payload;
      } catch {
        // The generic failure copy below covers a malformed response.
      }
      if (!response.ok) throw new Error(payload.message ?? "We couldn't save your volunteer interests.");
      if (payload.volunteerInterests) {
        queryClient.setQueryData<ProfilePayload>(["/api/supporter/profile"], (current) =>
          current
            ? {
                ...current,
                volunteerInterests: payload.volunteerInterests!,
                matchingVolunteerAlertsEnabled:
                  payload.matchingVolunteerAlertsEnabled ?? current.matchingVolunteerAlertsEnabled,
              }
            : current,
        );
      }
      if (typeof payload.matchingVolunteerAlertsEnabled === "boolean") {
        setMatchingAlertsEnabled(payload.matchingVolunteerAlertsEnabled);
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
            <section aria-labelledby="contact-information-heading" className="supporter-contact">
              <h2 id="contact-information-heading" className="pb2-section-heading">
                Contact Information
              </h2>
              <p className="supporter-contact-intro">
                Keep your personal information current. This updates your account without changing your organization access or settings.
              </p>
              <form onSubmit={(event) => void saveContactInformation(event)} noValidate>
                <div className="supporter-contact-grid">
                  <label className="supporter-contact-field">
                    <span>First name</span>
                    <input
                      className="pub-input"
                      name="firstName"
                      value={firstName}
                      autoComplete="given-name"
                      aria-invalid={contactErrors.firstName ? "true" : undefined}
                      aria-describedby={contactErrors.firstName ? "profile-first-name-error" : undefined}
                      onChange={(event) => setFirstName(event.target.value)}
                      disabled={savingContact}
                    />
                    {contactErrors.firstName ? <small id="profile-first-name-error">{contactErrors.firstName}</small> : null}
                  </label>
                  <label className="supporter-contact-field">
                    <span>Last name</span>
                    <input
                      className="pub-input"
                      name="lastName"
                      value={lastName}
                      autoComplete="family-name"
                      aria-invalid={contactErrors.lastName ? "true" : undefined}
                      aria-describedby={contactErrors.lastName ? "profile-last-name-error" : undefined}
                      onChange={(event) => setLastName(event.target.value)}
                      disabled={savingContact}
                    />
                    {contactErrors.lastName ? <small id="profile-last-name-error">{contactErrors.lastName}</small> : null}
                  </label>
                  <label className="supporter-contact-field">
                    <span>Email</span>
                    <input
                      className="pub-input"
                      name="email"
                      type="email"
                      value={email}
                      autoComplete="email"
                      aria-invalid={contactErrors.email ? "true" : undefined}
                      aria-describedby={contactErrors.email ? "profile-email-error" : undefined}
                      onChange={(event) => setEmail(event.target.value)}
                      disabled={savingContact}
                    />
                    {contactErrors.email ? <small id="profile-email-error">{contactErrors.email}</small> : null}
                  </label>
                  <label className="supporter-contact-field">
                    <span>Phone <em>(optional)</em></span>
                    <input
                      className="pub-input"
                      name="phone"
                      type="tel"
                      value={phone}
                      autoComplete="tel"
                      aria-invalid={contactErrors.phone ? "true" : undefined}
                      aria-describedby={contactErrors.phone ? "profile-phone-error" : undefined}
                      onChange={(event) => setPhone(event.target.value)}
                      disabled={savingContact}
                    />
                    {contactErrors.phone ? <small id="profile-phone-error">{contactErrors.phone}</small> : null}
                  </label>
                </div>
                <button type="submit" className="pub-btn supporter-contact-save" disabled={savingContact}>
                  {savingContact ? "Saving…" : "Save contact information"}
                </button>
                {contactResult ? (
                  <p
                    role={contactResult.kind === "error" ? "alert" : "status"}
                    className={contactResult.kind === "error" ? "supporter-contact-error" : "supporter-contact-success"}
                  >
                    {contactResult.text}
                  </p>
                ) : null}
              </form>
            </section>

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
              {data.matchingVolunteerAlertsEligible && (
                <label className="supporter-alert-preference">
                  <input
                    type="checkbox"
                    checked={matchingAlertsEnabled}
                    disabled={savingInterests}
                    onChange={(event) => {
                      setInterestResult(null);
                      setMatchingAlertsEnabled(event.target.checked);
                    }}
                  />
                  <span>
                    <strong>Email me when a new volunteer opportunity matches my interests.</strong>
                    <small>Alerts are off until you turn them on. Every alert includes a link to stop future emails.</small>
                  </span>
                </label>
              )}
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

            <section aria-labelledby="recently-viewed-heading">
              <h2 id="recently-viewed-heading" className="pb2-section-heading">
                Recently Viewed Requests
              </h2>
              {data.recentlyViewed.length === 0 ? (
                <p style={{ textAlign: "center", fontSize: 15 }}>
                  No recently viewed requests yet. <Link href="/items">Browse item needs</Link> or{" "}
                  <Link href="/volunteer">volunteer opportunities</Link>.
                </p>
              ) : (
                <div className="supporter-recent-grid">
                  {data.recentlyViewed.map((request) => {
                    const href =
                      request.requestKind === "item"
                        ? `/items/${request.requestId}`
                        : `/volunteer/${request.requestId}`;
                    return (
                      <article
                        key={`${request.requestKind}-${request.requestId}`}
                        className="supporter-recent-request"
                      >
                        <p className="supporter-recent-kind">
                          {request.requestKind === "item" ? "Item need" : "Volunteer opportunity"}
                        </p>
                        <h3>
                          {request.available ? <Link href={href}>{request.title}</Link> : request.title}
                        </h3>
                        <p>{request.orgName}</p>
                        <p>
                          Last viewed {formatDate(request.lastViewedAt)}
                          {" · "}
                          <strong>{request.converted ? "Already supported" : "Not yet supported"}</strong>
                          {" · "}
                          {request.available ? "Available" : "No longer available"}
                        </p>
                      </article>
                    );
                  })}
                </div>
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
                    {formatDate(pledge.createdAt)} · {pledge.status === "active" ? "Active" : "Cancelled"}
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
                    {pledge.status === "cancelled" && (
                      <p style={{ margin: "10px 0 0", fontWeight: 700 }}>
                        Cancelled{pledge.cancelledAt ? ` ${formatDate(pledge.cancelledAt)}` : ""}
                        {pledge.cancellationReason ? ` — ${pledge.cancellationReason}` : ""}
                      </p>
                    )}
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
                    {formatDate(signup.createdAt)} · {signup.status === "active" ? "Active" : "Cancelled"}
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
                    {signup.status === "cancelled" && (
                      <p style={{ margin: "10px 0 0", fontWeight: 700 }}>
                        Cancelled{signup.cancelledAt ? ` ${formatDate(signup.cancelledAt)}` : ""}
                        {signup.cancellationReason ? ` — ${signup.cancellationReason}` : ""}
                      </p>
                    )}
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
