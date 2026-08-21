export type EngagementEventType =
  | "card_click"
  | "detail_view"
  | "product_link_click"
  | "form_start"
  | "item_selected"
  | "role_selected";

export type EngagementRequestKind = "item" | "volunteer";

type EngagementInput = {
  eventType: EngagementEventType;
  requestKind: EngagementRequestKind;
  requestId: string;
  targetId?: string;
};

type LifecycleReport = {
  clearTimer: ReturnType<typeof setTimeout> | null;
};

// A real route unmount clears its key at the end of the current task. React
// Strict Mode's immediate setup-cleanup-setup cycle cancels that pending clear,
// suppressing only the development replay rather than later SPA revisits.
const lifecycleReports = new Map<string, LifecycleReport>();

function eventId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Fire-and-forget by design: analytics can never delay or break the action. */
export function reportEngagement(input: EngagementInput): void {
  void fetch("/api/public/engagement", {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventId: eventId(),
      eventType: input.eventType,
      requestKind: input.requestKind,
      requestId: input.requestId,
      ...(input.targetId ? { targetId: input.targetId } : {}),
    }),
  }).catch(() => undefined);
}

/** Begin an effect-bound report lifecycle and return its React effect cleanup. */
export function beginEngagementLifecycle(key: string, input: EngagementInput): () => void {
  let entry = lifecycleReports.get(key);
  if (!entry) {
    entry = { clearTimer: null };
    lifecycleReports.set(key, entry);
    reportEngagement(input);
  } else if (entry.clearTimer) {
    clearTimeout(entry.clearTimer);
    entry.clearTimer = null;
  }

  return () => {
    const current = lifecycleReports.get(key);
    if (!current) return;
    current.clearTimer = setTimeout(() => {
      if (lifecycleReports.get(key) === current) lifecycleReports.delete(key);
    }, 0);
  };
}
