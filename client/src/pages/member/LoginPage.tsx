/**
 * MP-01 — Login (/login). Bound surface.
 *
 * Magic link only (D40): the legacy password field does not carry over.
 * Regions in order: page heading, instructional copy, email field, submit.
 * No registration link, no help text, no support contact.
 *
 * An authenticated visitor is routed onward (MP-02 owns the destination);
 * they never see the form. A verification failure (expired/used link) lands
 * back here with ?error= and gets a legible retry message that never
 * discloses whether an email is registered.
 */
import { useEffect, useState } from "react";
import type { FormEvent, ReactElement } from "react";
import { useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "../../hooks/useSession";

const QUICK_LOGIN_ROLES = [
  { role: "staff_admin", label: "Staff Admin", name: "Tiffany Loeffler" },
  { role: "staff_approver", label: "Staff Approver", name: "Riley Chen" },
  { role: "org_owner", label: "Org Owner", name: "Dana Whitfield" },
] as const;

export function LoginPage(): ReactElement | null {
  const { session, isLoading } = useSession();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [quickLoading, setQuickLoading] = useState<string | null>(null);
  const [quickError, setQuickError] = useState<string | null>(null);
  // null = checking; false = disabled/unavailable; true = enabled
  const [quickEnabled, setQuickEnabled] = useState<boolean | null>(null);
  // true = all seed accounts present; false = seed not yet run
  const [quickSeeded, setQuickSeeded] = useState<boolean>(true);

  const linkError = new URLSearchParams(search).has("error");

  useEffect(() => {
    // Already authenticated: MP-02 resolves the destination. The form is
    // never shown to a signed-in visitor.
    if (!isLoading && session?.authenticated) {
      setLocation("/dashboard", { replace: true });
    }
  }, [isLoading, session, setLocation]);

  useEffect(() => {
    // Ask the server whether quick login is available. The endpoint returns 404
    // when disabled (not development and QUICK_LOGIN_ENABLED !== true), so the
    // UI section only appears when the server has opted in.
    fetch("/api/login/quick/status", { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) {
          setQuickEnabled(false);
          return;
        }
        const body = (await r.json().catch(() => null)) as { seeded?: boolean } | null;
        setQuickEnabled(true);
        setQuickSeeded(body?.seeded !== false);
      })
      .catch(() => setQuickEnabled(false));
  }, []);

  if (isLoading || session?.authenticated) return null;

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/login/magic-link", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      if (res.ok) {
        setSent(true);
        return;
      }
      // 400 = visible validation error from the endpoint; anything else is a
      // loud failure. Neither discloses registration status.
      setFormError(
        typeof body?.message === "string" && body.message !== ""
          ? body.message
          : "Something went wrong sending your login link. Please try again.",
      );
    } catch {
      setFormError("Something went wrong sending your login link. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleQuickLogin(role: string): Promise<void> {
    if (quickLoading !== null) return;
    setQuickError(null);
    setQuickLoading(role);
    try {
      const res = await fetch("/api/login/quick", {
        method: "POST",
        credentials: "include",
        // Timeout so a dead/restarting server yields a stated error instead
        // of a button spinner that never resolves.
        signal: AbortSignal.timeout(10_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const body = (await res.json().catch(() => null)) as {
        message?: string;
        redirectTo?: string;
      } | null;
      if (res.ok) {
        // The session cookie just changed identity. Full page load, not SPA
        // navigation: it guarantees the app boots fresh as the NEW user.
        // Cache-clearing while queries were mounted proved unreliable —
        // components kept rendering the previous user's data.
        window.location.assign(body?.redirectTo ?? "/dashboard");
        return;
      }
      setQuickError(
        typeof body?.message === "string" && body.message !== ""
          ? body.message
          : "Quick login failed. Please try again.",
      );
    } catch {
      setQuickError("Quick login failed. Please try again.");
    } finally {
      setQuickLoading(null);
    }
  }

  return (
    <main className="mp1-page">
      <h1 className="mp1-heading">LOG IN</h1>
      <p className="mp1-copy">Access for current Alliance members.</p>
      {sent ? (
        <p className="mp1-sent" role="status">
          Check your email for a link to log in.
        </p>
      ) : (
        <form className="mp1-form" onSubmit={handleSubmit} noValidate>
          {linkError ? (
            <p className="mp1-link-error" role="alert">
              That login link is no longer valid — it may have expired or already been used. Enter
              your email below and we&rsquo;ll send you a new one.
            </p>
          ) : null}
          <label className="mp1-label" htmlFor="mp1-email">
            Email*
          </label>
          <input
            id="mp1-email"
            className="mp1-input"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {formError ? (
            <p className="mp1-error" role="alert">
              {formError}
            </p>
          ) : null}
          <button className="mp1-submit" type="submit">
            Send Login Link
          </button>
        </form>
      )}

      {quickEnabled ? (
        <section className="mp1-quick-section" aria-label="Quick login — test accounts">
          <p className="mp1-quick-heading">Quick Login — test accounts</p>
          {quickSeeded ? (
            <>
              <div className="mp1-quick-buttons">
                {QUICK_LOGIN_ROLES.map(({ role, label, name }) => (
                  <button
                    key={role}
                    className="mp1-quick-btn"
                    type="button"
                    disabled={quickLoading !== null}
                    onClick={() => void handleQuickLogin(role)}
                  >
                    {quickLoading === role ? "Signing in…" : `${label} — ${name}`}
                  </button>
                ))}
              </div>
              {quickError ? (
                <p className="mp1-quick-error" role="alert">
                  {quickError}
                </p>
              ) : null}
            </>
          ) : (
            <p className="mp1-quick-seed-warning" role="status">
              Seed not yet run — test accounts are unavailable.{" "}
              <code>npm run db:seed</code>
            </p>
          )}
        </section>
      ) : null}
    </main>
  );
}
