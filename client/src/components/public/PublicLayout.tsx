import type { ReactElement, ReactNode } from "react";
import { Footer } from "./Footer";

/**
 * Shared public-page wrapper. The navigation bar itself is MP-02's global
 * chrome, mounted once in App.tsx above the router — this wrapper keeps the
 * full-height column the public surfaces lay out inside, and closes every
 * public page with the shared footer (member and admin shells never render
 * it, because they do not use this wrapper).
 *
 * Login (MP-01) also uses it: it is reachable without a session and reads as
 * part of the public site, so it closes with the same footer. `className`
 * exists for pages that set their own page-wide background — the default
 * leaves the body colour showing through.
 */
export function PublicLayout({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div className={className} style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <main style={{ flex: 1 }}>{children}</main>
      <Footer />
    </div>
  );
}
