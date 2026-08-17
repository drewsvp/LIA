import type { ReactElement, ReactNode } from "react";

/**
 * Shared public-page wrapper. The navigation bar itself is MP-02's global
 * chrome, mounted once in App.tsx above the router — this wrapper only keeps
 * the full-height column the public surfaces lay out inside.
 */
export function PublicLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <main style={{ flex: 1 }}>{children}</main>
    </div>
  );
}
