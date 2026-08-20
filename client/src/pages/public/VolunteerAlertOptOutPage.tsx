import { useEffect, useState, type ReactElement } from "react";
import { Link, useRoute } from "wouter";
import { PublicLayout } from "../../components/public/PublicLayout";

export function VolunteerAlertOptOutPage(): ReactElement {
  const [, params] = useRoute<{ token: string }>("/volunteer-alerts/unsubscribe/:token");
  const [state, setState] = useState<"processing" | "done" | "invalid">("processing");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/public/volunteer-alerts/unsubscribe", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: params?.token ?? "" }),
        });
        const body = (await response.json().catch(() => ({}))) as { ok?: boolean };
        if (!cancelled) setState(body.ok === true ? "done" : "invalid");
      } catch {
        if (!cancelled) setState("invalid");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params?.token]);

  return (
    <PublicLayout>
      <div className="pb2-banner">Volunteer Alerts</div>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "48px 16px 64px", textAlign: "center" }}>
        {state === "processing" && <p style={{ fontSize: 15 }}>One moment…</p>}
        {state === "done" && (
          <p style={{ fontSize: 15, fontWeight: 700 }}>
            Matching volunteer alerts are off. You won't receive more opportunity-match emails.
          </p>
        )}
        {state === "invalid" && (
          <p style={{ fontSize: 15 }}>
            This alert opt-out link isn't valid. You can also turn matching alerts off from Volunteer Interests in
            your profile.
          </p>
        )}
        <p style={{ fontSize: 15, marginTop: 24 }}>
          <Link href="/profile">Go to my profile</Link>
          {" · "}
          <Link href="/">Return to the home page</Link>
        </p>
      </div>
    </PublicLayout>
  );
}