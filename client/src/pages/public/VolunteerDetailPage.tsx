import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { PublicLayout } from "../../components/public/PublicLayout";

/**
 * PB-04 — Volunteer request detail and interest (docs/specs/PB-04.md).
 * Records INTEREST, not commitment (§1): checkboxes per role, counter is
 * quantity_interested, and the only write is record_volunteer_signup().
 * quantity_confirmed never reaches this page. Losing typed notes on a
 * failed submission is the specific thing to avoid (§12).
 */

type PublicRole = {
  id: string;
  name: string;
  description: string | null;
  quantityNeeded: number;
  quantityInterested: number;
  quantityRemaining: number;
};

type DetailPayload = {
  request: {
    id: string;
    title: string;
    description: string | null;
    details: string | null;
    imageUrl: string | null;
    eventLocation: string | null;
    deadlineType: string;
    deadlineDate: string | null;
  };
  organization: {
    name: string;
    websiteUrl: string | null;
    mission: string | null;
    populations: string[];
  };
  roles: PublicRole[];
};

const DEADLINE_LABELS: Record<string, string> = {
  until_fulfilled: "Until Fulfilled",
  date_specific: "Date Specific",
  ongoing: "Ongoing",
};

function formatDeadlineDate(iso: string | null): string | null {
  if (iso == null || iso === "") return null;
  const date = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

type SubmitPhase = "idle" | "submitting" | "success" | "gone";

type FieldErrors = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  roles?: string;
};

export function VolunteerDetailPage(): ReactElement {
  const params = useParams<{ id: string }>();
  const requestId = params.id ?? "";
  const { data, isLoading, isError, error } = useQuery<DetailPayload>({
    queryKey: [`/api/public/volunteer-requests/${requestId}`],
    enabled: requestId !== "",
  });

  // Roles live in local state so a role_full 409 refreshes availability in
  // place while selections, fields, and NOTES are all retained (§12).
  const [roles, setRoles] = useState<PublicRole[] | null>(null);
  useEffect(() => {
    if (data) setRoles(data.roles);
  }, [data]);

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [phase, setPhase] = useState<SubmitPhase>("idle");
  const [createProfile, setCreateProfile] = useState(false);
  const [subscribeDigest, setSubscribeDigest] = useState(false);
  const [profileCreated, setProfileCreated] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverMessage, setServerMessage] = useState<string | null>(null);

  const notFound = isError && error instanceof Error && error.message.startsWith("404");

  const selectedRoleIds = useMemo(
    () => (roles ?? []).filter((r) => selected[r.id] === true).map((r) => r.id),
    [roles, selected],
  );

  async function submit(): Promise<void> {
    const errors: FieldErrors = {};
    if (firstName.trim() === "") errors.firstName = "This field is required";
    if (lastName.trim() === "") errors.lastName = "This field is required";
    if (email.trim() === "") errors.email = "This field is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = "Please enter a valid email.";
    if (phone.trim() === "") errors.phone = "This field is required";
    if (selectedRoleIds.length === 0) errors.roles = "Please select at least one role you're interested in.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setPhase("submitting");
    setServerMessage(null);
    try {
      const res = await fetch(`/api/public/volunteer-requests/${requestId}/signups`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          notes: notes.trim() === "" ? null : notes.trim(),
          createProfile,
          subscribeDigest,
          roleIds: selectedRoleIds,
        }),
      });
      if (res.status === 201) {
        const okBody = (await res.json().catch(() => null)) as { profileCreated?: boolean } | null;
        setProfileCreated(okBody?.profileCreated === true);
        setPhase("success");
        return;
      }
      if (res.status === 410) {
        setPhase("gone");
        return;
      }
      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        code?: string;
        roles?: PublicRole[];
      };
      if (res.status === 409 && Array.isArray(body.roles)) {
        const refreshed = body.roles as PublicRole[];
        setRoles(refreshed); // refreshed availability; every entered value stays
        // Review fix: a filled role's checkbox is disabled, so leaving it
        // checked would resubmit the same role_full forever with no way to
        // uncheck it. Deselect exactly the now-full roles; notes and
        // contact fields stay untouched.
        setSelected((prev) => {
          const next = { ...prev };
          for (const r of refreshed) {
            if (r.quantityRemaining <= 0) next[r.id] = false;
          }
          return next;
        });
      }
      setServerMessage(
        body.message ?? "Something went wrong submitting your interest. Please try again in a moment.",
      );
      setPhase("idle");
    } catch {
      setServerMessage("Something went wrong submitting your interest. Please check your connection and try again.");
      setPhase("idle");
    }
  }

  return (
    <PublicLayout>
      <div className="pb2-banner">View Details</div>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px 16px 64px" }}>
        <p style={{ margin: "8px 0 16px" }}>
          <Link href="/volunteer" style={{ fontWeight: 700, textDecoration: "none" }}>
            &lt; Back
          </Link>
        </p>

        {isLoading && <p style={{ textAlign: "center", fontSize: 15 }}>Loading this opportunity…</p>}

        {notFound && (
          <div style={{ textAlign: "center", padding: "32px 0" }}>
            <h1 style={{ fontSize: 24 }}>This opportunity isn't available.</h1>
            <p style={{ fontSize: 15 }}>
              It may have closed or been removed. <Link href="/volunteer">Browse volunteer opportunities</Link>.
            </p>
          </div>
        )}

        {isError && !notFound && (
          <p role="alert" style={{ textAlign: "center", fontSize: 15, fontWeight: 700, color: "var(--color-navy)" }}>
            We couldn't load this opportunity. Please refresh the page to try again.
          </p>
        )}

        {data && roles && (
          <>
            {/* ---- Request detail ---- */}
            <h1
              style={{
                textAlign: "center",
                textTransform: "uppercase",
                fontSize: "clamp(24px, 4vw, 34px)",
                letterSpacing: 1,
                margin: "0 0 24px",
              }}
            >
              {data.request.title}
            </h1>
            <div className="pb2-detail">
              <div>
                {data.request.imageUrl != null && data.request.imageUrl.trim() !== "" ? (
                  <img
                    src={data.request.imageUrl}
                    alt={data.request.title}
                    style={{ width: "100%", display: "block", borderRadius: "var(--radius-card)" }}
                  />
                ) : (
                  <div
                    aria-hidden
                    style={{
                      width: "100%",
                      aspectRatio: "4 / 3",
                      background: "#e8e8e8",
                      borderRadius: "var(--radius-card)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--color-navy)" strokeWidth="1.5">
                      <path d="M12 21C12 21 4 15.5 4 9.8C4 6.9 6.2 5 8.5 5C10 5 11.3 5.8 12 7C12.7 5.8 14 5 15.5 5C17.8 5 20 6.9 20 9.8C20 15.5 12 21 12 21Z" />
                    </svg>
                  </div>
                )}
              </div>
              <div style={{ fontSize: 15, lineHeight: 1.7 }}>
                {/* Hidden when empty (§7) — the opposite of PB-02's dropoff rule. */}
                {data.request.eventLocation != null && data.request.eventLocation.trim() !== "" && (
                  <p style={{ margin: "0 0 10px" }}>
                    <span className="pub-label">Volunteer Role Location:</span> {data.request.eventLocation}
                  </p>
                )}
                <p style={{ margin: "0 0 10px" }}>
                  <span className="pub-label">Volunteer Date:</span>{" "}
                  {data.request.deadlineType === "date_specific"
                    ? formatDeadlineDate(data.request.deadlineDate)
                    : DEADLINE_LABELS[data.request.deadlineType] ?? data.request.deadlineType}
                </p>
                {data.request.details != null && data.request.details.trim() !== "" && (
                  <p style={{ margin: "0 0 10px" }}>
                    <span className="pub-label">Details:</span> {data.request.details}
                  </p>
                )}
                {data.request.description != null && data.request.description.trim() !== "" && (
                  <p style={{ margin: "0 0 10px" }}>
                    <span className="pub-label">Request Description:</span>
                    <br />
                    {data.request.description}
                  </p>
                )}
              </div>
            </div>

            {/* ---- Organization detail (boxed, below request, above roles §4) ---- */}
            <div className="pb2-orgbox">
              <div>
                <p style={{ margin: "0 0 10px", fontWeight: 700, color: "var(--color-navy)", fontSize: 17 }}>
                  {data.organization.name}
                </p>
                {data.organization.populations.length > 0 && (
                  <div style={{ fontSize: 15 }}>
                    <span className="pub-label">Primary Populations Served:</span>
                    <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
                      {data.organization.populations.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div>
                {data.organization.websiteUrl != null && data.organization.websiteUrl.trim() !== "" && (
                  <p style={{ margin: "0 0 10px", fontSize: 15, overflowWrap: "anywhere" }}>
                    <span className="pub-label">Website:</span>{" "}
                    <a href={data.organization.websiteUrl} target="_blank" rel="noreferrer">
                      {data.organization.websiteUrl}
                    </a>
                  </p>
                )}
                {data.organization.mission != null && data.organization.mission.trim() !== "" && (
                  <p style={{ margin: 0, fontSize: 15 }}>
                    <span className="pub-label">Organization's Mission:</span>
                    <br />
                    {data.organization.mission}
                  </p>
                )}
              </div>
            </div>

            {phase === "gone" ? (
              <div style={{ textAlign: "center", padding: "40px 0" }}>
                <h2 style={{ fontSize: 22, letterSpacing: 1, textTransform: "uppercase" }}>
                  This opportunity has closed
                </h2>
                <p style={{ fontSize: 15, maxWidth: 560, margin: "0 auto" }}>
                  While you were filling out the form, this volunteer opportunity closed — thank you for your
                  willingness to serve! There are more opportunities that could use you.
                </p>
                <p style={{ fontSize: 15 }}>
                  <Link href="/volunteer">Browse volunteer opportunities</Link>
                </p>
              </div>
            ) : phase === "success" ? (
              <div style={{ textAlign: "center", padding: "40px 0" }}>
                <h2 style={{ fontSize: 22, letterSpacing: 1, textTransform: "uppercase", margin: "0 0 12px" }}>
                  Thank You!
                </h2>
                <p style={{ fontSize: 15, fontWeight: 700, maxWidth: 620, margin: "0 auto" }}>
                  Thank you for expressing interest! Check your email for a confirmation — a representative from{" "}
                  {data.organization.name} will be reaching out to you within 1-3 business days with more details.
                </p>
                {profileCreated && (
                  <p style={{ fontSize: 15, maxWidth: 620, margin: "12px auto 0" }}>
                    Your Donor Profile is ready — <Link href="/login">log in</Link> anytime with your email address
                    (we&rsquo;ll send you a login link) to see all of your volunteering.
                  </p>
                )}
              </div>
            ) : (
              <>
                {/* ---- Volunteer roles ---- */}
                <h2 className="pb2-section-heading">Volunteer Roles</h2>
                {/* Captured grammar preserved verbatim (§8). */}
                <p style={{ textAlign: "center", fontSize: 15, margin: "0 0 20px" }}>
                  Please review and select the roles you're interested in the provide your contact information below.
                </p>

                {roles.length === 0 && (
                  <p style={{ textAlign: "center", fontSize: 15, fontWeight: 700, color: "var(--color-navy)" }}>
                    No volunteer roles are listed for this request yet.
                  </p>
                )}

                {serverMessage != null && (
                  <p role="alert" className="pb2-server-error">
                    {serverMessage}
                  </p>
                )}

                {roles.map((role) => {
                  const full = role.quantityRemaining <= 0;
                  const isExpanded = expanded[role.id] === true;
                  const desc = role.description ?? "";
                  const needsToggle = desc.length > 180;
                  return (
                    <div key={role.id} className="pb2-item-card">
                      <div className="pb2-item-card-header">Role Details</div>
                      <div style={{ padding: "14px 16px" }}>
                        <div className="pb2-item-row" style={{ alignItems: "flex-start" }}>
                          <p style={{ margin: 0, fontWeight: 700, fontSize: 16 }}>{role.name}</p>
                          <label
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              fontSize: 14,
                              opacity: full ? 0.5 : 1,
                            }}
                          >
                            <span className="pub-label" style={{ textDecoration: "underline" }}>
                              Select Role
                            </span>
                            <input
                              type="checkbox"
                              disabled={full}
                              checked={selected[role.id] === true}
                              onChange={(e) => setSelected((prev) => ({ ...prev, [role.id]: e.target.checked }))}
                            />
                          </label>
                        </div>
                        <p style={{ margin: "10px 0 0", fontSize: 14 }}>
                          <span className="pub-label" style={{ textDecoration: "underline" }}>
                            Number of People
                          </span>{" "}
                          <strong>Requested</strong> {role.quantityNeeded}
                        </p>
                        {desc.trim() !== "" && (
                          <div style={{ margin: "10px 0 0", fontSize: 14 }}>
                            <span className="pub-label" style={{ textDecoration: "underline" }}>
                              Description
                            </span>
                            <br />
                            <span className={needsToggle && !isExpanded ? "clamp-3" : undefined}>{desc}</span>
                            {needsToggle && (
                              <>
                                {" "}
                                <button
                                  type="button"
                                  onClick={() => setExpanded((prev) => ({ ...prev, [role.id]: !isExpanded }))}
                                  style={{
                                    background: "none",
                                    border: "none",
                                    padding: 0,
                                    color: "var(--color-teal)",
                                    textDecoration: "underline",
                                    cursor: "pointer",
                                    font: "inherit",
                                  }}
                                >
                                  {isExpanded ? "Read less" : "Read more"}
                                </button>
                              </>
                            )}
                          </div>
                        )}
                        <p style={{ margin: "10px 0 0", fontSize: 14 }}>
                          <span className="pub-label" style={{ textDecoration: "underline" }}>
                            Expressed Interest
                          </span>{" "}
                          {role.quantityInterested}
                        </p>
                      </div>
                    </div>
                  );
                })}
                {fieldErrors.roles != null && (
                  <p role="alert" className="pb2-field-error" style={{ textAlign: "center" }}>
                    {fieldErrors.roles}
                  </p>
                )}

                {/* ---- Contact form (no agreement checkbox on this surface §4) ---- */}
                {roles.length > 0 && (
                  <div style={{ maxWidth: 620, margin: "40px auto 0" }}>
                    <h2 className="pb2-section-heading">My Contact Information</h2>
                    <p style={{ fontSize: 14, lineHeight: 1.6, textAlign: "center", margin: "0 0 20px" }}>
                      Thank you for being willing to volunteer your time. You will receive a confirmation email
                      indicating you've expressed interest in this role and a representative from the requesting
                      organization will be reaching out to you within 1-3 business days with more details.
                    </p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void submit();
                      }}
                      noValidate
                    >
                      <div style={{ marginBottom: 14 }}>
                        <span className="pub-label" style={{ display: "block", marginBottom: 6 }}>
                          Name *
                        </span>
                        <div style={{ display: "flex", gap: 10 }}>
                          <div style={{ flex: 1 }}>
                            <input
                              aria-label="First name"
                              placeholder="First"
                              value={firstName}
                              onChange={(e) => setFirstName(e.target.value)}
                              className="pub-input"
                            />
                            {fieldErrors.firstName != null && <p className="pb2-field-error">{fieldErrors.firstName}</p>}
                          </div>
                          <div style={{ flex: 1 }}>
                            <input
                              aria-label="Last name"
                              placeholder="Last"
                              value={lastName}
                              onChange={(e) => setLastName(e.target.value)}
                              className="pub-input"
                            />
                            {fieldErrors.lastName != null && <p className="pb2-field-error">{fieldErrors.lastName}</p>}
                          </div>
                        </div>
                      </div>
                      <div style={{ marginBottom: 14 }}>
                        <label className="pub-label" htmlFor="pb4-email" style={{ display: "block", marginBottom: 6 }}>
                          Email *
                        </label>
                        <input
                          id="pb4-email"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="pub-input"
                        />
                        {fieldErrors.email != null && <p className="pb2-field-error">{fieldErrors.email}</p>}
                      </div>
                      <div style={{ marginBottom: 14 }}>
                        <label className="pub-label" htmlFor="pb4-phone" style={{ display: "block", marginBottom: 6 }}>
                          Phone Number *
                        </label>
                        <input
                          id="pb4-phone"
                          type="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          className="pub-input"
                        />
                        {fieldErrors.phone != null && <p className="pb2-field-error">{fieldErrors.phone}</p>}
                      </div>
                      <div style={{ marginBottom: 18 }}>
                        <label className="pub-label" htmlFor="pb4-notes" style={{ display: "block", marginBottom: 6 }}>
                          Notes
                        </label>
                        <textarea
                          id="pb4-notes"
                          rows={4}
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          className="pub-input"
                          style={{ resize: "vertical" }}
                        />
                        {/* Helper text verbatim, typo preserved (§5 #9). */}
                        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#555555" }}>
                          Please share any relevant information about your availability/experience or any special
                          accomodations needed.
                        </p>
                      </div>
                      {/* Doubled sizing to match the claim form: 28px labels, 26px boxes. */}
                      <label style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 28, lineHeight: 1.3, marginBottom: 16 }}>
                        <input
                          type="checkbox"
                          checked={createProfile}
                          onChange={(e) => setCreateProfile(e.target.checked)}
                          style={{ width: 26, height: 26, flexShrink: 0 }}
                        />
                        Create a Donor Profile so I can track all my volunteering.
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 28, lineHeight: 1.3, marginBottom: 20 }}>
                        <input
                          type="checkbox"
                          checked={subscribeDigest}
                          onChange={(e) => setSubscribeDigest(e.target.checked)}
                          style={{ width: 26, height: 26, flexShrink: 0 }}
                        />
                        Keep me informed about new needs (weekly email).
                      </label>
                      <div style={{ textAlign: "center" }}>
                        <button type="submit" className="btn-teal" disabled={phase === "submitting"}>
                          {phase === "submitting" ? "Submitting…" : "Express Interest"}
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </PublicLayout>
  );
}
