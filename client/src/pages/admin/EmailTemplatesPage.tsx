/**
 * ADMIN-10 — Automated emails (staff-admin only). Every automated email
 * with its trigger and recipients in plain words, an enable/disable toggle,
 * a plain-text copy editor with {placeholder} tokens, and a rendered
 * preview with sample data. The login-link email appears marked as
 * authentication infrastructure, view-only. Saving refuses with a stated
 * error when a required placeholder is missing — the server validates too.
 */
import { useEffect, useRef, useState } from "react";
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
  deliveryType: "scheduled" | "event_triggered";
  schedule: Schedule | null;
  updatedAt: string | null;
  updatedByName: string | null;
};

type Schedule = {
  active: boolean;
  weeklyWeekday: number;
  weeklyMinutes: number;
  oneTimeAt: string | null;
  nextSendAt: string | null;
  updatedAt: string;
  updatedByName: string | null;
};

type ListResponse = { templates: TemplateRow[] };
type PreviewResponse = { subject: string; html: string; text: string };

const LIST_KEY = "/api/admin/email-templates";
const SAVE_FAILURE = "That did not save. Nothing was changed.";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function lastEditedLabel(row: TemplateRow): string | null {
  if (!row.updatedAt || row.authInfrastructure) return null;
  const who = row.updatedByName ?? "a staff member";
  if (!row.enabled) return `Disabled by ${who} on ${fmtDate(row.updatedAt)}`;
  return `Last edited by ${who} on ${fmtDate(row.updatedAt)}`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function timeValue(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function pacificDateTime(iso: string | null): { date: string; time: string } {
  if (iso === null) return { date: "", time: "" };
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (part: string) => parts.find((p) => p.type === part)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour") === "24" ? "00" : get("hour")}:${get("minute")}` };
}

function fmtPacific(iso: string | null): string {
  if (iso === null) return "No pending send";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

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
  const [previewing, setPreviewing] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState<Schedule | null>(null);
  const [oneTimeDate, setOneTimeDate] = useState("");
  const [oneTimeTime, setOneTimeTime] = useState("");
  const [savingSchedule, setSavingSchedule] = useState(false);
  // Incremented each time the selected template changes so stale in-flight
  // responses from a previous selection are discarded on arrival.
  const previewGenRef = useRef(0);

  const templates = data?.templates ?? [];
  const selected = templates.find((t) => t.key === selectedKey) ?? null;

  // (Re)initialize the editor and load the stored preview on selection.
  useEffect(() => {
    setMessage(null);
    setErrors([]);
    setPreview(null);
    setPreviewing(false);
    if (!selected) {
      setDraft(null);
      setScheduleDraft(null);
      return;
    }
    setDraft({ ...selected.copy, paragraphs: [...selected.copy.paragraphs] });
    setDraftRecipients(selected.recipientsOverride ?? "");
    setScheduleDraft(selected.schedule ? { ...selected.schedule } : null);
    const once = pacificDateTime(selected.schedule?.oneTimeAt ?? null);
    setOneTimeDate(once.date);
    setOneTimeTime(once.time);

    const gen = ++previewGenRef.current;
    void postJson(`/api/admin/email-templates/${selected.key}/preview`, {}).then(({ ok, data: body }) => {
      if (previewGenRef.current !== gen) return; // stale — a different template was selected
      if (ok) setPreview(body as PreviewResponse);
      // silently ignore errors on the initial auto-load; the user can click Preview to retry
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, data]);

  async function refreshPreview(): Promise<void> {
    if (!selected || !draft || previewing) return;
    setErrors([]);
    setPreviewing(true);
    const gen = ++previewGenRef.current;
    try {
      const { ok, data: body } = await postJson(`/api/admin/email-templates/${selected.key}/preview`, {
        copy: selected.authInfrastructure ? undefined : draft,
      });
      if (previewGenRef.current !== gen) return; // stale — template switched while request was in flight
      if (ok) {
        setPreview(body as PreviewResponse);
      } else {
        const b = body as { errors?: string[]; message?: string } | null;
        setErrors(b?.errors ?? [b?.message ?? "The preview could not be rendered."]);
      }
    } catch {
      if (previewGenRef.current !== gen) return;
      setErrors(["The preview could not be loaded. Check your connection and try again."]);
    } finally {
      if (previewGenRef.current === gen) setPreviewing(false);
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

  async function saveSchedule(cancelOneTime = false): Promise<void> {
    if (!selected || !scheduleDraft || savingSchedule) return;
    setSavingSchedule(true);
    setMessage(null);
    setErrors([]);
    try {
      const { ok, data: body } = await postJson(`/api/admin/email-templates/${selected.key}/schedule`, {
        active: scheduleDraft.active,
        weeklyWeekday: scheduleDraft.weeklyWeekday,
        weeklyMinutes: scheduleDraft.weeklyMinutes,
        oneTimeDate: cancelOneTime || oneTimeDate === "" ? null : oneTimeDate,
        oneTimeTime: cancelOneTime || oneTimeTime === "" ? null : oneTimeTime,
      }, "PUT");
      if (!ok) {
        const b = body as { message?: string } | null;
        setMessage(b?.message ?? SAVE_FAILURE);
        return;
      }
      const schedule = (body as { schedule: Schedule }).schedule;
      setScheduleDraft(schedule);
      const once = pacificDateTime(schedule.oneTimeAt);
      setOneTimeDate(once.date);
      setOneTimeTime(once.time);
      setMessage(cancelOneTime ? "One-time digest canceled. The weekly schedule is unchanged." : "Digest schedule saved.");
      await queryClient.invalidateQueries({ queryKey: [LIST_KEY] });
    } catch {
      setMessage(SAVE_FAILURE);
    } finally {
      setSavingSchedule(false);
    }
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
                      {lastEditedLabel(row) && (
                        <div className="adm-muted" style={{ fontSize: "0.85em", marginTop: 2 }}>
                          {lastEditedLabel(row)}
                        </div>
                      )}
                    </td>
                    <td>{row.deliveryType === "scheduled" ? `Scheduled — ${row.trigger}` : `Event-triggered — ${row.trigger}`}</td>
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
               <dd>{selected.deliveryType === "scheduled" ? selected.trigger : `Event-triggered: ${selected.trigger}`}</dd>
              <dt>Goes to</dt>
              <dd>
                {selected.recipients}
                {!selected.recipientsConfigurable && !selected.authInfrastructure && (
                  <span className="adm-muted"> (fixed — determined by the event, not editable)</span>
                )}
              </dd>
              {lastEditedLabel(selected) && (
                <>
                  <dt>Last change</dt>
                  <dd>{lastEditedLabel(selected)}</dd>
                </>
              )}
            </dl>

            {selected.authInfrastructure ? (
              <p className="adm-muted">
                This is the sign-in link email. It is part of the login system, so it is always on and its copy is not
                editable here.
              </p>
            ) : (
              <>
                {scheduleDraft && (
                  <section className="adm-upcoming-digest" aria-label="Digest schedule">
                    <h3 className="adm-subheading">Digest schedule</h3>
                    <p className="adm-sub-note">
                      All times are Pacific time. Pausing stops new digest runs but lets an already-started send finish safely.
                      Needs that arrive while paused stay in the next digest window after you resume.
                      On daylight-saving transition days, a skipped spring time moves forward by one hour, and a repeated fall time uses the second occurrence.
                    </p>
                    <p className="adm-sub-note">
                      Status: <strong>{scheduleDraft.active ? "Active" : "Paused"}</strong>.{" "}
                      {scheduleDraft.active ? `Next expected send: ${fmtPacific(scheduleDraft.nextSendAt)} (Pacific).` : "No new digest will start until resumed."}
                    </p>
                    <label className="adm-filter">
                      <input
                        type="checkbox"
                        checked={scheduleDraft.active}
                        onChange={(e) => setScheduleDraft({ ...scheduleDraft, active: e.target.checked })}
                      />{" "}
                      Send the weekly digest automatically
                    </label>
                    <div className="adm-filter-row">
                      <label className="adm-filter">
                        Weekly day
                        <select
                          value={scheduleDraft.weeklyWeekday}
                          onChange={(e) => setScheduleDraft({ ...scheduleDraft, weeklyWeekday: Number(e.target.value) })}
                        >
                          {WEEKDAYS.map((day, i) => <option key={day} value={i}>{day}</option>)}
                        </select>
                      </label>
                      <label className="adm-filter">
                        Weekly time (Pacific)
                        <input
                          type="time"
                          value={timeValue(scheduleDraft.weeklyMinutes)}
                          onChange={(e) => {
                            const parts = e.target.value.split(":");
                            const hour = Number(parts[0]);
                            const minute = Number(parts[1]);
                            if (parts.length === 2 && Number.isInteger(hour) && Number.isInteger(minute)) {
                              setScheduleDraft({ ...scheduleDraft, weeklyMinutes: hour * 60 + minute });
                            }
                          }}
                        />
                      </label>
                    </div>
                    <h4 className="adm-subheading">One-time digest</h4>
                    <p className="adm-sub-note">
                      {scheduleDraft.oneTimeAt ? `Pending: ${fmtPacific(scheduleDraft.oneTimeAt)} (Pacific).` : "No one-time digest is pending."}
                      {" "}This does not replace the weekly schedule.
                    </p>
                    <div className="adm-filter-row">
                      <label className="adm-filter">Date (Pacific)<input type="date" value={oneTimeDate} onChange={(e) => setOneTimeDate(e.target.value)} /></label>
                      <label className="adm-filter">Time (Pacific)<input type="time" value={oneTimeTime} onChange={(e) => setOneTimeTime(e.target.value)} /></label>
                    </div>
                    <div className="adm-btn-row">
                      <button type="button" className="adm-btn" disabled={savingSchedule} onClick={() => void saveSchedule()}>
                        {savingSchedule ? "Saving schedule…" : "Save schedule"}
                      </button>
                      {scheduleDraft.oneTimeAt && (
                        <button type="button" className="adm-btn-outline" disabled={savingSchedule} onClick={() => void saveSchedule(true)}>
                          Cancel one-time send
                        </button>
                      )}
                    </div>
                  </section>
                )}
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
                  <button type="button" className="adm-btn-outline" disabled={previewing} onClick={() => void refreshPreview()}>
                    {previewing ? "Loading preview…" : "Preview these edits"}
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
