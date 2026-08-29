import { useState } from "react";
import type { ReactElement } from "react";

export type EligibleOrganization = { id: string; name: string };

type Result = { kind: "error"; text: string } | null;

const ENTER_FAILURE = "Unable to enter this organization view. Nothing was changed.";
const EXIT_FAILURE = "Unable to exit organization view. Please try again.";

async function responseBody(res: Response): Promise<{ ok?: boolean; message?: string; redirectTo?: string }> {
  try {
    return (await res.json()) as { ok?: boolean; message?: string; redirectTo?: string };
  } catch {
    return {};
  }
}

/** Staff-only control used by the membership administration surfaces. */
export function OrganizationLoginAsControls({
  organizations,
}: {
  organizations: EligibleOrganization[];
}): ReactElement | null {
  const [pending, setPending] = useState<EligibleOrganization | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);

  if (organizations.length === 0) return null;

  async function enter(): Promise<void> {
    if (!pending) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/organization-context", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: pending.id }),
      });
      const body = await responseBody(res);
      if (!res.ok || body.ok === false) {
        setResult({ kind: "error", text: body.message ?? ENTER_FAILURE });
        return;
      }
      // This deliberately reloads all session-scoped data before showing the
      // organization dashboard.
      window.location.assign("/dashboard");
    } catch {
      setResult({ kind: "error", text: ENTER_FAILURE });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="org-context-controls" aria-labelledby="org-context-heading">
      <h2 id="org-context-heading" className="adm-subheading">Organization access</h2>
      <p className="adm-muted">Open an approved member organization&apos;s dashboard as that organization.</p>
      {result ? <p className="adm-alert" role="alert">{result.text}</p> : null}
      <div className="org-context-list">
        {organizations.map((organization) => (
          <div className="org-context-row" key={organization.id}>
            <span>{organization.name}</span>
            <button
              type="button"
              className="adm-btn"
              disabled={busy}
              onClick={() => {
                setResult(null);
                setPending(organization);
              }}
            >
              Login As
            </button>
          </div>
        ))}
      </div>
      {pending ? (
        <div className="adm-confirm org-context-confirm">
          <p>
            Enter organization view for {pending.name}? You will leave staff administration until you exit this view.
          </p>
          <button type="button" className="adm-btn adm-btn-primary" disabled={busy} onClick={() => void enter()}>
            {busy ? "Entering…" : "Enter organization view"}
          </button>
          <button type="button" className="adm-btn adm-btn-outline" disabled={busy} onClick={() => setPending(null)}>
            Cancel
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function OrganizationContextBanner({
  organizationName,
}: {
  organizationName: string;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exit(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/session/organization-context/exit", {
        method: "POST",
        credentials: "include",
      });
      const body = await responseBody(res);
      if (!res.ok || body.ok === false) {
        setError(body.message ?? EXIT_FAILURE);
        setBusy(false);
        return;
      }
      window.location.assign(body.redirectTo ?? "/dashboard");
    } catch {
      setError(EXIT_FAILURE);
      setBusy(false);
    }
  }

  return (
    <aside className="org-context-banner" aria-label="Organization view">
      <span>You are viewing <strong>{organizationName}</strong> as an administrator.</span>
      <button type="button" onClick={() => void exit()} disabled={busy}>
        {busy ? "Exiting…" : "Exit organization view"}
      </button>
      {error ? <span className="org-context-banner-error" role="alert">{error}</span> : null}
    </aside>
  );
}

export function SupporterContextBanner({
  supporterName,
  expiresAt,
}: {
  supporterName: string;
  expiresAt: string;
}): ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exit(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/session/supporter-context/exit", {
        method: "POST",
        credentials: "include",
      });
      const body = await responseBody(res);
      if (!res.ok || body.ok === false) {
        setError(body.message ?? "Unable to return to your staff session. Please try again.");
        setBusy(false);
        return;
      }
      window.location.assign(body.redirectTo ?? "/admin/supporters");
    } catch {
      setError("Unable to return to your staff session. Please try again.");
      setBusy(false);
    }
  }

  const expiry = new Date(expiresAt);
  const expiryText = Number.isNaN(expiry.getTime())
    ? "soon"
    : expiry.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  return (
    <aside className="supporter-context-banner" aria-label="Supporter view">
      <span>
        Supporter view: <strong>{supporterName}</strong>. Staff and organization permissions are paused until you return.
        This view expires at {expiryText}.
      </span>
      <button type="button" onClick={() => void exit()} disabled={busy}>
        {busy ? "Returning…" : "Return to staff session"}
      </button>
      {error ? <span className="org-context-banner-error" role="alert">{error}</span> : null}
    </aside>
  );
}