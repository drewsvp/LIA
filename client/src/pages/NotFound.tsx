import type { ReactElement } from "react";
/**
 * Not-found page. Also rendered for /admin paths when the session is not
 * staff — an admin surface must be indistinguishable from a route that does
 * not exist (Handbook routing rules).
 */
export function NotFound(): ReactElement {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: 28, margin: "0 0 8px" }}>Page not found</h1>
        <p style={{ color: "var(--color-muted)", margin: "0 0 16px" }}>
          The page you are looking for does not exist.
        </p>
        <a href="/" style={{ fontWeight: 700 }}>
          Back to Love in Action
        </a>
      </div>
    </main>
  );
}
