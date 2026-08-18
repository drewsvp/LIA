/**
 * ADMIN-10 — Automated emails (staff-admin only). Every automated email
 * with its trigger and recipients in plain words, an enable/disable toggle,
 * a plain-text copy editor with {placeholder} tokens, and a rendered
 * preview with sample data. The login-link email appears marked as
 * authentication infrastructure, view-only. Saving refuses with a stated
 * error when a required placeholder is missing — the server validates too.
 */
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";

type Copy = { subject: string; heading: string; paragraphs: string[] };

type TemplateRow = {
  key: string;
  name: string;
  trigger: string;
  recipients: string;
  recipientsConfigurable: boolean;
  effectiveRecipients: string[] | null;
  recipientsOverride: string | null;
  enabled: boolean;
  hasCopyOverride: boolean;
  defaultCopy: Copy;
  copy: Copy;
  placeholders: string[];
  authInfrastructure: boolean;
};

type ListResponse = { templates: TemplateRow[] };
type PreviewResponse = { subject: string; html: string; text: string };

const LIST_KEY = "/api/admin/email-templates";
const SAVE_FAILURE = "That did not save. Nothing was changed.";

async function postJson(url: string, body: unknown, method = "POST"): Promise<{ ok: boolean; data: unknown }> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as unknown;
  return { ok: res.ok, data };
}

export function EmailTemplatesPage(): ReactElement {
  const { data, isLoading } = useQuery<ListResponse>({ queryKey: [LIST_KEY] });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<Copy | null>(null);
  const [draftRecipients, setDraftRecipients] = useState<string>("");
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);

  const templates = data?.templates ?? [];
  const selected = templates.find((t) => t.key === selectedKey) ?? null;

  // (Re)initialize the editor and load the stored preview on selection.
  useEffect(() => {
    setMessage(null);
    setErrors([]);
    setPreview(null);
    if (!selected) {
      setDraft(null);
      return;
    }
    setDraft({ ...selected.copy, paragraphs: [...selected.copy.paragraphs] });
    setDraftRecipients(selected.recipientsOverride ?? "");
    void postJson(`/api/admin/email-templates/${selected.key}/preview`, {}).then(({ ok, data: body }) => {
      if (ok) setPreview(body as PreviewResponse);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, data]);

  async function refreshPreview(): Promise<void> {
    if (!selected || !draft) return;
    setErrors([]);
    const { ok, data: body } = await postJson(`/api/admin/email-templates/${selected.key}/preview`, {
      copy: selected.authInfrastructure ? undefined : draft,
    });
    if (ok) {
      setPreview(body as PreviewResponse);
    } else {
      const b = body as { errors?: string[]; message?: string } | null;
      setErrors(b?.errors ?? [b?.message ?? "The preview could not be rendered."]);
    }
  }

  async function save(resetToDefault: boolean): Promise<void> {
    if (!selected || !draft) return;
    setSaving(true);
    setMessage(null);
    setErrors([]);
    try {
      const { ok, data: body } = await postJson(
        `/api/admin/email-templates/${selected.key}`,
        {
          copy: resetToDefault ? null : draft,
          recipients: selected.recipientsConfigurable ? (draftRecipients.trim() === "" ? null : draftRecipients.trim()) : null,
        },
        "PUT",
      );
      if (ok) {
        setMessage(resetToDefault ? "Restored the built-in copy." : "Saved. All future sends use this copy.");
        await queryClient.invalidateQueries({ queryKey: [LIST_KEY] });
      } else {
        const b = body as { errors?: string[]; message?: string } | null;
        setErrors(b?.errors ?? []);
        setMessage(b?.message ?? SAVE_FAILURE);
      }
    } catch {
      setMessage(SAVE_FAILURE);
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(row: TemplateRow): Promise<void> {
    setMessage(null);
    const { ok, data: body } = await postJson(`/api/admin/email-templates/${row.key}/enabled`, {
      enabled: !row.enabled,
    });
    if (!ok) {
      const b = body as { message?: string } | null;
      setMessage(b?.message ?? SAVE_FAILURE);
    }
    await queryClient.invalidateQueries({ queryKey: [LIST_KEY] });
  }

  return (
    <div className="adm-page">
      <h1 className="adm-heading">Automated emails</h1>
      <p className="adm-muted">
        These emails are sent automatically. You can edit the subject and body copy, and turn each one off. Text in
        curly braces like {"{organizationName}"} is filled in when the email is sent and must stay in the copy. A
        disabled email is recorded in the email log as skipped, never dropped silently.
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

      <div className="adm-email-split">
        <div className="adm-email-table">
          {isLoading ? (
            <p className="adm-muted">Loading…</p>
          ) : (
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Sent when</th>
                  <th>Goes to</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((row) => (
                  <tr
                    key={row.key}
                    className={row.key === selectedKey ? "adm-row-selected" : undefined}
                    onClick={() => setSelectedKey(row.key)}
                  >
                    <td>
                      {row.name}
                      {row.hasCopyOverride && <span className="adm-muted"> (edited)</span>}
                      {row.authInfrastructure && <span className="adm-muted"> — authentication infrastructure</span>}
                    </td>
                    <td>{row.trigger}</td>
                    <td>
                      {row.recipients}
                      {row.effectiveRecipients && <span className="adm-muted"> ({row.effectiveRecipients.join(", ")})</span>}
                    </td>
                    <td>
                      {row.authInfrastructure ? (
                        "always on"
                      ) : (
                        <button
                          type="button"
                          className="adm-btn-outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            void toggleEnabled(row);
                          }}
                        >
                          {row.enabled ? "Enabled — turn off" : "Disabled — turn on"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {selected && draft && (
          <aside className="adm-email-detail">
            <h2 className="adm-subheading">{selected.name}</h2>
            <dl className="adm-detail-list">
              <dt>Sent when</dt>
              <dd>{selected.trigger}</dd>
              <dt>Goes to</dt>
              <dd>
                {selected.recipients}
                {!selected.recipientsConfigurable && !selected.authInfrastructure && (
                  <span className="adm-muted"> (fixed — determined by the event, not editable)</span>
                )}
              </dd>
            </dl>

            {selected.authInfrastructure ? (
              <p className="adm-muted">
                This is the sign-in link email. It is part of the login system, so it is always on and its copy is not
                editable here.
              </p>
            ) : (
              <>
                {selected.recipientsConfigurable && (
                  <label className="adm-filter">
                    Recipient addresses (comma-separated; leave blank to use the configured staff addresses)
                    <input
                      type="text"
                      value={draftRecipients}
                      placeholder={selected.effectiveRecipients?.join(", ") ?? ""}
                      onChange={(e) => setDraftRecipients(e.target.value)}
                    />
                  </label>
                )}
                <label className="adm-filter">
                  Subject
                  <input type="text" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
                </label>
                <label className="adm-filter">
                  Heading
                  <input type="text" value={draft.heading} onChange={(e) => setDraft({ ...draft, heading: e.target.value })} />
                </label>
                {draft.paragraphs.map((p, i) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <label className="adm-filter" key={i}>
                    Paragraph {i + 1}
                    <textarea
                      rows={4}
                      value={p}
                      onChange={(e) => {
                        const paragraphs = [...draft.paragraphs];
                        paragraphs[i] = e.target.value;
                        setDraft({ ...draft, paragraphs });
                      }}
                    />
                  </label>
                ))}
                <p className="adm-muted">
                  Placeholders this email uses: {selected.placeholders.length > 0 ? selected.placeholders.map((p) => `{${p}}`).join(", ") : "none"}. Details like names, tables, and buttons below the copy are built automatically and cannot break.
                </p>
                <div className="adm-btn-row">
                  <button type="button" className="adm-btn" disabled={saving} onClick={() => void save(false)}>
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button type="button" className="adm-btn-outline" onClick={() => void refreshPreview()}>
                    Preview these edits
                  </button>
                  {selected.hasCopyOverride && (
                    <button type="button" className="adm-btn-outline" disabled={saving} onClick={() => void save(true)}>
                      Restore built-in copy
                    </button>
                  )}
                </div>
              </>
            )}

            {preview && (
              <>
                <h3 className="adm-subheading">Preview (sample data)</h3>
                <dl className="adm-detail-list">
                  <dt>Subject</dt>
                  <dd>{preview.subject}</dd>
                </dl>
                <iframe
                  title="Email preview"
                  srcDoc={preview.html}
                  style={{ width: "100%", height: 480, border: "1px solid #ccc", background: "#fff" }}
                />
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
