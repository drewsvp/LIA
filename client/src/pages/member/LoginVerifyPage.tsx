/**
 * MP-01C — Magic-link confirmation (/login/verify). Bound to MP-01's styling.
 *
 * Why this surface exists (D66): the emailed link used to complete sign-in on
 * GET, so mail-security scanners and link prefetchers consumed the token
 * before the member ever clicked, and the human landed on "that login link is
 * no longer valid". The link now lands here. Nothing is consumed by arriving;
 * the single "Sign in" button POSTs, and only that POST creates the session.
 *
 * A refused token is never a dead end: the error state offers a button back to
 * the email-entry screen, which explains that a new link can be requested.
 */
import { useState } from "react";
import type { ReactElement } from "react";
import { useSearch } from "wouter";

const GENERIC_ERROR = "We could not finish signing you in. Request a new link below and try again.";
const MISSING_TOKEN_ERROR =
  "This sign-in link is incomplete — it may have been cut short by your email program. Request a new one below.";

export function LoginVerifyPage(): ReactElement {
  const search = useSearch();
  const token = new URLSearchParams(search).get("token") ?? "";

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(token === "" ? MISSING_TOKEN_ERROR : null);

  async function handleSignIn(): Promise<void> {
    if (submitting || token === "") return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/login/magic-link/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        // A dead or restarting server must not leave the button spinning.
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ token }),
      });
      const body = (await res.json().catch(() => null)) as { message?: string; redirectTo?: string } | null;
      if (res.ok) {
        // The session cookie just established an identity. Full page load, not
        // SPA navigation, so the app boots fresh as the signed-in user.
        window.location.assign(body?.redirectTo ?? "/dashboard");
        return;
      }
      setError(typeof body?.message === "string" && body.message !== "" ? body.message : GENERIC_ERROR);
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mp1-page">
      <h1 className="mp1-heading">LOG IN</h1>
      {error === null ? (
        <>
          <p className="mp1-copy">Click below to finish signing in.</p>
          <button className="mp1-submit" type="button" disabled={submitting} onClick={() => void handleSignIn()}>
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </>
      ) : (
        <>
          <p className="mp1-link-error" role="alert">
            {error}
          </p>
          <button
            className="mp1-submit"
            type="button"
            onClick={() => window.location.assign("/login?error=link")}
          >
            Request a New Link
          </button>
        </>
      )}
    </main>
  );
}
