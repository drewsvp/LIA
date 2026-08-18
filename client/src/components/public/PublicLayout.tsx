import type { ReactElement, ReactNode } from "react";
import { Footer } from "./Footer";

/**
 * Shared public-page wrapper. The navigation bar itself is MP-02's global
 * chrome, mounted once in App.tsx above the router — this wrapper keeps the
 * full-height column the public surfaces lay out inside, and closes every
 * public page with the shared footer (member and admin shells never render
 * it, because they do not use this wrapper).
 */
export function PublicLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <main style={{ flex: 1 }}>{children}</main>
      <Footer />
    </div>
  );
}
