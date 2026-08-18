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
import { useSession } from "../../hooks/useSession";

export function LoginPage(): ReactElement | null {
  const { session, isLoading } = useSession();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const linkError = new URLSearchParams(search).has("error");

  useEffect(() => {
    // Already authenticated: MP-02 resolves the destination. The form is
    // never shown to a signed-in visitor.
    if (!isLoading && session?.authenticated) {
      setLocation("/dashboard", { replace: true });
    }
  }, [isLoading, session, setLocation]);

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
    </main>
  );
}
