/**
 * ADMIN-13 — /admin/settings. Site-wide copy settings (staff-admin only).
 *
 * Three editable fields: site name, public contact email, and response-time
 * language. All changes take effect immediately — no redeploy required.
 * Email brand fields (colours, director details, etc.) remain on the
 * Automated Emails page.
 */
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";

const SETTINGS_KEY = "/api/admin/site-settings";
const SAVE_FAILURE = "That did not save. Nothing was changed.";

type SiteSettingsRow = {
  siteName: string;
  contactEmail: string;
  responseTimeLanguage: string;
  imageGenerationEnabled: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
};

type SettingsResponse = { settings: SiteSettingsRow };

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

async function postJson(
  url: string,
  body: unknown,
  method: "PUT" | "POST" = "POST",
): Promise<{ ok: boolean; data: unknown }> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, data };
}

export function SettingsPage(): ReactElement {
  const { data, isLoading } = useQuery<SettingsResponse>({ queryKey: [SETTINGS_KEY] });
  const settings = data?.settings ?? null;

  const [draft, setDraft] = useState<SiteSettingsRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  // Initialise draft when settings load.
  useEffect(() => {
    if (settings && !draft) {
      setDraft({ ...settings });
    }
  }, [settings, draft]);

  async function save(): Promise<void> {
    if (!draft || saving) return;
    setSaving(true);
    setMessage(null);
    setErrors([]);
    try {
      const { ok, data: resData } = await postJson(
        SETTINGS_KEY,
        {
          siteName: draft.siteName,
          contactEmail: draft.contactEmail,
          responseTimeLanguage: draft.responseTimeLanguage,
          imageGenerationEnabled: draft.imageGenerationEnabled,
        },
        "PUT",
      );
      if (ok) {
        setMessage("Settings saved. Changes are live immediately.");
        await queryClient.invalidateQueries({ queryKey: [SETTINGS_KEY] });
        // Also invalidate the public cache so client pages pick up new values.
        await queryClient.invalidateQueries({ queryKey: ["/api/site-settings"] });
      } else {
        const b = resData as { errors?: string[]; message?: string } | null;
        setErrors(b?.errors ?? []);
        setMessage(b?.message ?? SAVE_FAILURE);
      }
    } catch {
      setMessage(SAVE_FAILURE);
    } finally {
      setSaving(false);
    }
  }

  async function reset(): Promise<void> {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    setErrors([]);
    try {
      const { ok, data: resData } = await postJson(`${SETTINGS_KEY}/reset`, {});
      if (ok) {
        const saved = (resData as { settings: SiteSettingsRow }).settings;
        setDraft({ ...saved });
        setMessage("Settings reset to built-in defaults.");
        await queryClient.invalidateQueries({ queryKey: [SETTINGS_KEY] });
        await queryClient.invalidateQueries({ queryKey: ["/api/site-settings"] });
      } else {
        const b = resData as { message?: string } | null;
        setMessage(b?.message ?? SAVE_FAILURE);
      }
    } catch {
      setMessage(SAVE_FAILURE);
    } finally {
      setSaving(false);
    }
  }

  const lastEdited = settings?.updatedAt
    ? `Last saved by ${settings.updatedByName ?? "a staff member"} on ${fmtDate(settings.updatedAt)}`
    : "Using built-in defaults — not yet customised.";

  if (isLoading || !draft) {
    return (
      <div className="adm-page">
        <h1 className="adm-heading">Settings</h1>
        <p className="adm-muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="adm-page">
      <h1 className="adm-heading">Settings</h1>

      <p className="adm-muted">
        These settings control site-wide copy and optional features.
        Changes take effect immediately — no redeploy required.
        Email branding (colours, fonts, org name, director details) is managed on the{" "}
        <a href="/admin/emails" className="adm-link">Automated Emails</a> page.
      </p>

      {message && (
        <p className="adm-result" role="status">
          {message}
        </p>
      )}
      {errors.length > 0 && (
        <ul className="adm-error-text" role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <div className="adm-settings-form">
        <label className="adm-filter">
          Site name{" "}
          <span className="adm-muted">
            — used in page titles and share previews
          </span>
          <input
            type="text"
            value={draft.siteName}
            onChange={(e) => setDraft({ ...draft, siteName: e.target.value })}
          />
        </label>

        <label className="adm-filter">
          <input
            type="checkbox"
            checked={draft.imageGenerationEnabled}
            onChange={(e) => setDraft({ ...draft, imageGenerationEnabled: e.target.checked })}
          />{" "}
          Enable automatic image generation
          <span className="adm-muted">
            {" "}— allows OpenAI to create request images after submission and lets staff generate or regenerate them
          </span>
        </label>

        <label className="adm-filter">
          Public contact email{" "}
          <span className="adm-muted">
            — shown on the signup page when members need help
          </span>
          <input
            type="email"
            value={draft.contactEmail}
            onChange={(e) => setDraft({ ...draft, contactEmail: e.target.value })}
          />
        </label>

        <label className="adm-filter">
          Response-time language{" "}
          <span className="adm-muted">
            — e.g. "1-3 business days", used in signup copy and volunteer emails
          </span>
          <input
            type="text"
            value={draft.responseTimeLanguage}
            onChange={(e) => setDraft({ ...draft, responseTimeLanguage: e.target.value })}
          />
        </label>
      </div>

      <p className="adm-muted" style={{ marginTop: 8 }}>
        {lastEdited}
      </p>

      <div className="adm-btn-row">
        <button type="button" className="adm-btn" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save settings"}
        </button>
        <button
          type="button"
          className="adm-btn adm-btn-outline"
          disabled={saving}
          onClick={() => void reset()}
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
