import type { ReactElement } from "react";
/**
 * Placeholder rendered at every scaffolded route until its surface task
 * replaces it. Shows enough to prove routing works and nothing more.
 */
import type { SurfaceRoute } from "@shared/routes";

export function PlaceholderPage({ route }: { route: SurfaceRoute }): ReactElement {
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
      <div
        style={{
          background: "var(--color-surface)",
          borderRadius: "var(--radius-card)",
          boxShadow: "var(--shadow-card)",
          padding: 32,
          maxWidth: 520,
          width: "100%",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: "var(--color-teal)",
          }}
        >
          {route.id} · {route.area}
        </p>
        <h1 style={{ margin: "8px 0 12px", fontSize: 24 }}>{route.title}</h1>
        <p style={{ margin: 0, color: "var(--color-muted)", fontSize: 14, lineHeight: 1.6 }}>
          Placeholder — this surface is built by its own task from{" "}
          <code>docs/specs/{route.id}.md</code>. Route: <code>{route.path}</code>
        </p>
      </div>
    </main>
  );
}
