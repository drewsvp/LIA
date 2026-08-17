import { useEffect, useState, type ReactElement } from "react";
import { Link, useRoute } from "wouter";
import { PublicLayout } from "../../components/public/PublicLayout";

/**
 * PB-05 — Digest subscribe and unsubscribe (docs/specs/PB-05.md).
 * ONE surface, two routes: /subscribe renders the form, /unsubscribe/:token
 * flips the row behind the emailed link. Only the weekly digest checkbox is
 * built — the three other live Wix lists have no path into this system and
 * rendering them would silently promise subscriptions that never happen (§1).
 * No emails are queued on subscribe (D28) and no people row is created (D27).
 */

type SubmitPhase = "idle" | "submitting" | "success";

function SubscribeView(): ReactElement {
  const [digest, setDigest] = useState(true); // checked by default on load (§5)
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState<SubmitPhase>("idle");
  const [fieldErrors, setFieldErrors] = useState<{ firstName?: string; lastName?: string; email?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    const errors: typeof fieldErrors = {};
    if (firstName.trim() === "") errors.firstName = "This field is required";
    if (lastName.trim() === "") errors.lastName = "This field is required";
    if (email.trim() === "") errors.email = "This field is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = "Please enter a valid email.";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setPhase("submitting");
    setServerError(null);
    try {
      const res = await fetch("/api/public/digest-subscriptions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          subscribe: digest,
        }),
      });
      if (res.status === 201) {
        setPhase("success");
        return;
      }
      // Failure copy verbatim (§8); every entered value retained (§12).
      setServerError("That didn't save. Please check your email address and try again.");
      setPhase("idle");
    } catch {
      setServerError("That didn't save. Please check your email address and try again.");
      setPhase("idle");
    }
  }

  return (
    <>
      <div className="pb2-banner">Receive Our Emails</div>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "32px 16px 64px" }}>
        {phase === "success" ? (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <h1 style={{ fontSize: 22, letterSpacing: 1, textTransform: "uppercase", margin: "0 0 12px" }}>
              Thank You!
            </h1>
            <p style={{ fontSize: 15, fontWeight: 700 }}>
              You're subscribed! Watch your inbox on Thursdays for new needs.
            </p>
          </div>
        ) : (
          <>
            <p style={{ fontSize: 15, lineHeight: 1.6, textAlign: "center", margin: "0 0 20px" }}>
              I would like to receive the following emails from The Alliance and understand I can opt out at any
              time.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
              noValidate
            >
              <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 15, marginBottom: 20 }}>
                <input
                  type="checkbox"
                  checked={digest}
                  onChange={(e) => setDigest(e.target.checked)}
                  style={{ marginTop: 3 }}
                />
                Weekly digest of new donation &amp; volunteer needs (sent on Thursdays).
              </label>
              {serverError != null && (
                <p role="alert" className="pb2-server-error" style={{ textAlign: "left" }}>
                  {serverError}
                </p>
              )}
              <div style={{ marginBottom: 14 }}>
                <label className="pub-label" htmlFor="pb5-first" style={{ display: "block", marginBottom: 6 }}>
                  First Name *
                </label>
                <input
                  id="pb5-first"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="pub-input"
                />
                {fieldErrors.firstName != null && <p className="pb2-field-error">{fieldErrors.firstName}</p>}
              </div>
              <div style={{ marginBottom: 14 }}>
                <label className="pub-label" htmlFor="pb5-last" style={{ display: "block", marginBottom: 6 }}>
                  Last Name *
                </label>
                <input
                  id="pb5-last"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="pub-input"
                />
                {fieldErrors.lastName != null && <p className="pb2-field-error">{fieldErrors.lastName}</p>}
              </div>
              <div style={{ marginBottom: 20 }}>
                <label className="pub-label" htmlFor="pb5-email" style={{ display: "block", marginBottom: 6 }}>
                  Email *
                </label>
                <input
                  id="pb5-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pub-input"
                />
                {fieldErrors.email != null && <p className="pb2-field-error">{fieldErrors.email}</p>}
              </div>
              <div style={{ textAlign: "center" }}>
                {/* Unchecked digest box blocks submission (§7). */}
                <button type="submit" className="btn-teal" disabled={!digest || phase === "submitting"}>
                  {phase === "submitting" ? "Submitting…" : "Submit"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </>
  );
}

function UnsubscribeView({ token }: { token: string }): ReactElement {
  const [state, setState] = useState<"processing" | "done" | "invalid">("processing");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/public/digest-subscriptions/unsubscribe", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
        if (!cancelled) setState(body.ok === true ? "done" : "invalid");
      } catch {
        if (!cancelled) setState("invalid");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <>
      <div className="pb2-banner">Unsubscribe</div>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "48px 16px 64px", textAlign: "center" }}>
        {state === "processing" && <p style={{ fontSize: 15 }}>One moment…</p>}
        {/* Plain, final, no retention attempt (§8). */}
        {state === "done" && (
          <p style={{ fontSize: 15, fontWeight: 700 }}>
            You've been unsubscribed from the weekly digest. You won't receive any more digest emails.
          </p>
        )}
        {state === "invalid" && (
          <p style={{ fontSize: 15 }}>
            This unsubscribe link isn't valid. If you're still receiving digest emails, you can unsubscribe from the
            link in any digest email.
          </p>
        )}
        <p style={{ fontSize: 15, marginTop: 24 }}>
          <Link href="/">Return to the home page</Link>
        </p>
      </div>
    </>
  );
}

export function DigestPage(): ReactElement {
  const [isUnsubscribe, params] = useRoute<{ token: string }>("/unsubscribe/:token");
  return (
    <PublicLayout>
      {isUnsubscribe && params ? <UnsubscribeView token={params.token} /> : <SubscribeView />}
    </PublicLayout>
  );
}
