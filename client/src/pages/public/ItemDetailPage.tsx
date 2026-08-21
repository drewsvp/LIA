import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { PublicLayout } from "../../components/public/PublicLayout";
import { beginEngagementLifecycle, reportEngagement } from "../../lib/engagement";

/**
 * PB-02 — Item request detail and claim (docs/specs/PB-02.md).
 * Reads through the allow-listed public payload; the ONLY write is the
 * pledge POST, which runs record_item_pledge() server-side. This surface
 * never computes or updates quantities itself — the disabled input and the
 * pre-submit check are a courtesy, the function is the control.
 */

type PublicItem = {
  id: string;
  name: string;
  description: string | null;
  condition: string | null;
  productUrl: string | null;
  quantityRequested: number;
  quantityClaimed: number;
  quantityRemaining: number;
};

type DetailPayload = {
  request: {
    id: string;
    title: string;
    description: string | null;
    imageUrl: string | null;
    dropoffLocation: string | null;
    deadlineType: string;
    deadlineDate: string | null;
  };
  organization: {
    name: string;
    websiteUrl: string | null;
    mission: string | null;
    populations: string[];
  };
  items: PublicItem[];
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
  lines?: string;
};

export function ItemDetailPage(): ReactElement {
  const params = useParams<{ id: string }>();
  const requestId = params.id ?? "";
  const { data, isLoading, isError, error } = useQuery<DetailPayload>({
    queryKey: [`/api/public/item-requests/${requestId}`],
    enabled: requestId !== "",
  });

  const formStarted = useRef(false);
  useEffect(() => {
    formStarted.current = false;
  }, [requestId]);

  // Items live in local state so a 409 can refresh availability in place
  // while every entered value is retained (§12 row 1).
  const [items, setItems] = useState<PublicItem[] | null>(null);
  useEffect(() => {
    if (data) setItems(data.items);
  }, [data]);

  useEffect(() => {
    if (!data) return;
    return beginEngagementLifecycle(`detail:item:${data.request.id}`, {
      eventType: "detail_view",
      requestKind: "item",
      requestId: data.request.id,
    });
  }, [data]);

  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [agree, setAgree] = useState(false); // starts unchecked — deliberate opt-in
  const [createProfile, setCreateProfile] = useState(false);
  const [subscribeDigest, setSubscribeDigest] = useState(false);
  const [phase, setPhase] = useState<SubmitPhase>("idle");
  const [profileCreated, setProfileCreated] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverMessage, setServerMessage] = useState<string | null>(null);

  const notFound = isError && error instanceof Error && error.message.startsWith("404");

  const enteredLines = useMemo(() => {
    if (!items) return [];
    return items
      .map((item) => ({ itemId: item.id, quantity: Number.parseInt(quantities[item.id] ?? "", 10) }))
      .filter((l) => Number.isInteger(l.quantity) && l.quantity > 0);
  }, [items, quantities]);

  async function submit(): Promise<void> {
    if (!items) return;
    const errors: FieldErrors = {};
    if (firstName.trim() === "") errors.firstName = "This field is required";
    if (lastName.trim() === "") errors.lastName = "This field is required";
    if (email.trim() === "") errors.email = "This field is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = "Please enter a valid email.";
    if (phone.trim() === "") errors.phone = "This field is required";
    if (enteredLines.length === 0) errors.lines = "Please claim at least one item by entering a quantity above zero.";
    for (const line of enteredLines) {
      const item = items.find((i) => i.id === line.itemId);
      if (item && line.quantity > item.quantityRemaining) {
        errors.lines = `You entered ${line.quantity} for "${item.name}" but only ${item.quantityRemaining} ${item.quantityRemaining === 1 ? "is" : "are"} still needed.`;
      }
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setPhase("submitting");
    setServerMessage(null);
    try {
      const res = await fetch(`/api/public/item-requests/${requestId}/pledges`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          agree,
          createProfile,
          subscribeDigest,
          lines: enteredLines,
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
        items?: PublicItem[];
      };
      if (res.status === 409 && Array.isArray(body.items)) {
        const refreshed = body.items as PublicItem[];
        setItems(refreshed); // re-render current availability, keep entered values
        // Review fix: a sold-out item's input is disabled, so a stale
        // positive quantity there could never be corrected and would 409
        // forever. Clear exactly those; every other entered value stays.
        setQuantities((prev) => {
          const next = { ...prev };
          for (const it of refreshed) {
            if (it.quantityRemaining <= 0) delete next[it.id];
          }
          return next;
        });
      }
      setServerMessage(
        body.message ?? "Something went wrong submitting your donation. Please try again in a moment.",
      );
      setPhase("idle");
    } catch {
      setServerMessage("Something went wrong submitting your donation. Please check your connection and try again.");
      setPhase("idle");
    }
  }

  return (
    <PublicLayout>
      <div className="pb2-banner">View Details</div>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px 16px 64px" }}>
        <p style={{ margin: "8px 0 16px" }}>
          <Link href="/items" style={{ fontWeight: 700, textDecoration: "none" }}>
            &lt; Back
          </Link>
        </p>

        {isLoading && <p style={{ textAlign: "center", fontSize: 15 }}>Loading this need…</p>}

        {notFound && (
          <div style={{ textAlign: "center", padding: "32px 0" }}>
            <h1 style={{ fontSize: 24 }}>This need isn't available.</h1>
            <p style={{ fontSize: 15 }}>
              It may have been fulfilled or removed. <Link href="/items">Browse current item needs</Link>.
            </p>
          </div>
        )}

        {isError && !notFound && (
          <p role="alert" style={{ textAlign: "center", fontSize: 15, fontWeight: 700, color: "var(--color-navy)" }}>
            We couldn't load this need. Please refresh the page to try again.
          </p>
        )}

        {data && items && (
          <>
            {/* ---- Region 1: request detail ---- */}
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
              <div className="pb2-detail-image">
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
              <div className="pb2-detail-summary" style={{ fontSize: 15, lineHeight: 1.7 }}>
                <p style={{ margin: "0 0 10px" }}>
                  <span className="pub-label">Requesting Organization:</span> {data.organization.name}
                </p>
                {/* Confirmed: label renders even when the value is blank (§7). */}
                <p style={{ margin: "0 0 10px" }}>
                  <span className="pub-label">Item Dropoff Location:</span>{" "}
                  {data.request.dropoffLocation ?? ""}
                </p>
                <p style={{ margin: "0 0 10px" }}>
                  <span className="pub-label">Deadline Type:</span>{" "}
                  {DEADLINE_LABELS[data.request.deadlineType] ?? data.request.deadlineType}
                </p>
                {data.request.deadlineType === "date_specific" && data.request.deadlineDate != null && (
                  <p style={{ margin: "0 0 10px" }}>
                    <span className="pub-label">Deadline Date:</span> {formatDeadlineDate(data.request.deadlineDate)}
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

            {/* ---- Region 2: organization box, above the items list (§4) ---- */}
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
                <h2 style={{ fontSize: 22, letterSpacing: 1, textTransform: "uppercase" }}>This need has been met!</h2>
                <p style={{ fontSize: 15, maxWidth: 560, margin: "0 auto" }}>
                  While you were filling out the form, other donors finished fulfilling this request — thank you for
                  your willingness to help! There are more current needs that could use you.
                </p>
                <p style={{ fontSize: 15 }}>
                  <Link href="/items">Browse current item needs</Link>
                </p>
              </div>
            ) : phase === "success" ? (
              <div style={{ textAlign: "center", padding: "40px 0" }}>
                <h2 style={{ fontSize: 22, letterSpacing: 1, textTransform: "uppercase", margin: "0 0 12px" }}>
                  Thank You!
                </h2>
                <p style={{ fontSize: 15, fontWeight: 700, maxWidth: 560, margin: "0 auto" }}>
                  Thank you for your donation! Check your email for a confirmation with details on how to deliver
                  your items.
                </p>
                {profileCreated && (
                  <p style={{ fontSize: 15, maxWidth: 560, margin: "12px auto 0" }}>
                    Your Donor Profile is ready — <Link href="/login">log in</Link> anytime with your email address
                    (we&rsquo;ll send you a login link) to see all of your donations.
                  </p>
                )}
              </div>
            ) : (
              <>
                {/* ---- Region 3: items list ---- */}
                <h2 className="pb2-section-heading">Requested Items</h2>
                <p style={{ textAlign: "center", fontSize: 15, margin: "0 0 20px" }}>
                  Please claim items by indicating the number of each you plan to donate.
                </p>

                {items.length === 0 && (
                  <p role="alert" style={{ textAlign: "center", fontSize: 15, fontWeight: 700, color: "var(--color-navy)" }}>
                    This request has no items listed right now, so nothing can be claimed. Please check back soon.
                  </p>
                )}

                {serverMessage != null && (
                  <p role="alert" className="pb2-server-error">
                    {serverMessage}
                  </p>
                )}

                {items.map((item) => {
                  const soldOut = item.quantityRemaining <= 0;
                  return (
                    <div key={item.id} className="pb2-item-card">
                      <div className="pb2-item-card-header">Item Details</div>
                      <div style={{ padding: "14px 16px" }}>
                        <p style={{ margin: "0 0 10px", fontWeight: 700, fontSize: 16 }}>{item.name}</p>
                        <div className="pb2-item-row">
                          <div style={{ fontSize: 14 }}>
                            <span className="pub-label">Quantity</span>{" "}
                            <span style={{ marginRight: 14 }}>
                              <strong>Requested</strong> {item.quantityRequested}
                            </span>
                            <span style={{ marginRight: 14 }}>
                              <strong>Claimed</strong> {item.quantityClaimed}
                            </span>
                            <span>
                              <strong>Still Needed</strong> {item.quantityRemaining}
                            </span>
                          </div>
                          <div style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 8 }}>
                            <label className="pub-label" htmlFor={`qty-${item.id}`}>
                              # of Items You Are Claiming
                            </label>
                            <input
                              id={`qty-${item.id}`}
                              type="number"
                              min={0}
                              max={item.quantityRemaining}
                              disabled={soldOut}
                              value={quantities[item.id] ?? ""}
                              onChange={(e) => {
                                setQuantities((prev) => ({ ...prev, [item.id]: e.target.value }));
                                if (Number.parseInt(e.target.value, 10) > 0) {
                                  reportEngagement({
                                    eventType: "item_selected",
                                    requestKind: "item",
                                    requestId,
                                    targetId: item.id,
                                  });
                                }
                              }}
                              className="pb2-qty-input"
                            />
                          </div>
                        </div>
                        {item.description != null && item.description.trim() !== "" && (
                          <p style={{ margin: "10px 0 0", fontSize: 14 }}>
                            <span className="pub-label">Description</span>
                            <br />
                            {item.description}
                          </p>
                        )}
                        {item.condition != null && item.condition.trim() !== "" && (
                          <p style={{ margin: "10px 0 0", fontSize: 14 }}>
                            <span className="pub-label">Item Condition</span> {item.condition}
                          </p>
                        )}
                        {item.productUrl != null && item.productUrl.trim() !== "" && (
                          <p style={{ margin: "10px 0 0", fontSize: 14, overflowWrap: "anywhere" }}>
                            <a
                              href={item.productUrl}
                              target="_blank"
                              rel="noreferrer"
                              onClick={() =>
                                reportEngagement({
                                  eventType: "product_link_click",
                                  requestKind: "item",
                                  requestId,
                                  targetId: item.id,
                                })
                              }
                            >
                              {item.productUrl}
                            </a>
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
                {fieldErrors.lines != null && (
                  <p role="alert" className="pb2-field-error" style={{ textAlign: "center" }}>
                    {fieldErrors.lines}
                  </p>
                )}

                {/* ---- Regions 4–6: donor form, agreement, submit ---- */}
                {items.length > 0 && (
                  <div style={{ maxWidth: 620, margin: "40px auto 0" }}>
                    <h2 className="pb2-section-heading">My Contact Information</h2>
                    <p style={{ fontSize: 14, lineHeight: 1.6, textAlign: "center", margin: "0 0 20px" }}>
                      By signing up to meet this need you are agreeing to either collect or purchase the claimed
                      item(s) then coordinate delivery to the requesting organization within the next 2 weeks. A
                      confirmation email will be sent to you with the details of your claimed item(s) as well as the
                      contact information of the person at the requesting organization.
                    </p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void submit();
                      }}
                      noValidate
                      onFocusCapture={() => {
                        if (formStarted.current) return;
                        formStarted.current = true;
                        reportEngagement({
                          eventType: "form_start",
                          requestKind: "item",
                          requestId,
                        });
                      }}
                    >
                      <div style={{ marginBottom: 14 }}>
                        <span className="pub-label" style={{ display: "block", marginBottom: 6 }}>
                          Name *
                        </span>
                        {/* Two inputs by app-wide policy D41; first and last land in separate columns. */}
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
                        <label className="pub-label" htmlFor="pb2-email" style={{ display: "block", marginBottom: 6 }}>
                          Email *
                        </label>
                        <input
                          id="pb2-email"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="pub-input"
                        />
                        {fieldErrors.email != null && <p className="pb2-field-error">{fieldErrors.email}</p>}
                      </div>
                      <div style={{ marginBottom: 18 }}>
                        <label className="pub-label" htmlFor="pb2-phone" style={{ display: "block", marginBottom: 6 }}>
                          Phone Number *
                        </label>
                        <input
                          id="pb2-phone"
                          type="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          className="pub-input"
                        />
                        {fieldErrors.phone != null && <p className="pb2-field-error">{fieldErrors.phone}</p>}
                      </div>
                      {/* 21px bold labels with unchanged 26px checkbox controls. */}
                      <label style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 21, fontWeight: 700, lineHeight: 1.3, marginBottom: 16 }}>
                        <input
                          type="checkbox"
                          checked={agree}
                          onChange={(e) => setAgree(e.target.checked)}
                          style={{ width: 26, height: 26, flexShrink: 0 }}
                        />
                        I agree to fulfill this request within the next 2 weeks.
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 21, fontWeight: 700, lineHeight: 1.3, marginBottom: 16 }}>
                        <input
                          type="checkbox"
                          checked={createProfile}
                          onChange={(e) => setCreateProfile(e.target.checked)}
                          style={{ width: 26, height: 26, flexShrink: 0 }}
                        />
                        Create a Donor Profile so I can track all my donations.
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 21, fontWeight: 700, lineHeight: 1.3, marginBottom: 20 }}>
                        <input
                          type="checkbox"
                          checked={subscribeDigest}
                          onChange={(e) => setSubscribeDigest(e.target.checked)}
                          style={{ width: 26, height: 26, flexShrink: 0 }}
                        />
                        Keep me informed about new needs (weekly email).
                      </label>
                      <div style={{ textAlign: "center" }}>
                        <button type="submit" className="btn-teal" disabled={!agree || phase === "submitting"}>
                          {phase === "submitting" ? "Submitting…" : "Claim Item(s)"}
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
