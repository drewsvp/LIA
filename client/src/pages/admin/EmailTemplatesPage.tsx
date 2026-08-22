/**
 * ADMIN-10 — Automated emails (staff-admin only). Every automated email
 * with its trigger and recipients in plain words, an enable/disable toggle,
 * a plain-text copy editor with {placeholder} tokens, and a rendered
 * preview with sample data. The login-link email appears marked as
 * authentication infrastructure, view-only. Saving refuses with a stated
 * error when a required placeholder is missing — the server validates too.
 *
 * Also hosts the Branding panel (Task 241) where staff-admins can edit the
 * primary colour, fonts, org identity strings, director details, and header
 * image URL that all outbound emails use.
 */
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useNavigationGuard } from "../../hooks/useNavigationGuard";

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

type BrandSettings = {
  primaryColor: string;
  fontStack: string;
  orgName: string;
  programName: string;
  signatureName: string;
  directorName: string;
  directorEmail: string;
  directorTitle: string;
  headerImageUrl: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
};
type ListResponse = { templates: TemplateRow[] };
type PreviewResponse = { subject: string; html: string; text: string };

type BrandResponse = { settings: BrandSettings };
const LIST_KEY = "/api/admin/email-templates";

const BRAND_KEY = "/api/admin/email-brand";
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

function copyEqual(a: Copy, b: Copy): boolean {
  return (
    a.subject === b.subject &&
    a.heading === b.heading &&
    a.paragraphs.length === b.paragraphs.length &&
    a.paragraphs.every((p, i) => p === b.paragraphs[i])
  );
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

const BRAND_DEFAULTS: BrandSettings = {
  primaryColor: "rgb(6, 54, 93)",
  fontStack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  orgName: "The Alliance",
  programName: "Love in Action",
  signatureName: "The Alliance Love in Action Team",
  directorName: "Christina Moe",
  directorEmail: "christina@defendingthecause.org",
  directorTitle: "Love in Action Program Director",
  headerImageUrl: null,
  updatedAt: null,
  updatedByName: null,
};
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
  // Key of the row whose status pill is showing an inline confirm.
  const [confirmToggleKey, setConfirmToggleKey] = useState<string | null>(null);
  // When non-null, a row switch or close is waiting for dirty-state confirmation.
  // "__CLOSE__" means the close button was clicked; any other value is the target row key.
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  // Incremented each time the selected template changes so stale in-flight
  // responses from a previous selection are discarded on arrival.
  const previewGenRef = useRef(0);
  const editorRef = useRef<HTMLElement | null>(null);
  // Map from row key to TR element so we can scroll back on close.
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  const templates = data?.templates ?? [];
  const selected = templates.find((t) => t.key === selectedKey) ?? null;

  // True when the draft copy or recipients differ from what is stored on the selected template.
  const isDirty =
    (draft !== null && selected !== null && !copyEqual(draft, selected.copy)) ||
    (selected !== null && draftRecipients !== (selected.recipientsOverride ?? ""));

  // Guards browser Back, admin nav clicks, and hard refresh while edits are unsaved.
  const { blocked, confirmLeave, cancelLeave } = useNavigationGuard(isDirty);

  // Show the guard whenever a navigation or in-page action is pending confirmation.
  const showGuard = blocked || pendingKey !== null;

  // True when the editor section is (or should be) in the DOM.
  const editorVisible = selected !== null && draft !== null;

  // Scroll the editor into view after it is actually in the DOM.
  // This effect fires on the render AFTER draft is set, so editorRef.current is
  // guaranteed to be attached. selectedKey in deps re-triggers on template switches
  // (editorVisible stays true but the selected content changed).
  useEffect(() => {
    if (!editorVisible) return;
    const id = requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorVisible, selectedKey]);

  // (Re)initialize the editor, load the stored preview, and auto-scroll on selection.
  // Intentionally omits `data` from deps: a background refetch (e.g. after toggling
  // status or saving schedule) must NOT reset a dirty copy/recipients draft.
  useEffect(() => {
    setMessage(null);
    setErrors([]);
    setPreview(null);
    setPreviewing(false);
    setConfirmToggleKey(null);
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
  }, [selectedKey]);

  function doClose(): void {
    const prevKey = selectedKey;
    setSelectedKey(null);
    // Scroll the previously selected row back into view.
    requestAnimationFrame(() => {
      if (prevKey) rowRefs.current[prevKey]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  function handleClose(): void {
    if (isDirty) {
      setPendingKey("__CLOSE__");
      return;
    }
    doClose();
  }

  function handleRowClick(key: string): void {
    const next = key === selectedKey ? null : key;
    if (isDirty && next !== null) {
      // Switching to a different row with unsaved edits — ask first.
      setPendingKey(key);
      return;
    }
    if (isDirty && next === null) {
      // Toggling the current row closed — treat like close.
      setPendingKey("__CLOSE__");
      return;
    }
    setSelectedKey(next);
  }

  function commitPending(): void {
    const pk = pendingKey;
    setPendingKey(null);
    // Also replay any intercepted browser/router navigation.
    confirmLeave();
    if (pk === "__CLOSE__") {
      doClose();
    } else if (pk !== null) {
      setSelectedKey(pk);
    }
  }

  function dismissPending(): void {
    setPendingKey(null);
    cancelLeave();
  }

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
        // Explicitly sync the draft so isDirty returns false without relying on the
        // editor-init effect (which intentionally omits `data` from its deps).
        // For a restore-default, adopt the built-in copy. For a normal save, the
        // draft already matches the saved copy — just normalise recipients so that
        // any server-side trimming doesn't leave a phantom dirty flag.
        if (resetToDefault) {
          setDraft({ ...selected.defaultCopy, paragraphs: [...selected.defaultCopy.paragraphs] });
          setDraftRecipients("");
        } else if (selected.recipientsConfigurable) {
          setDraftRecipients(draftRecipients.trim() === "" ? "" : draftRecipients.trim());
        }
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
    setConfirmToggleKey(null);
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
      {showGuard && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            zIndex: 200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            className="adm-dirty-guard"
            role="alertdialog"
            aria-label="Unsaved changes"
            style={{ background: "#fff", padding: "24px 28px", maxWidth: 420, width: "100%", borderRadius: 6, boxShadow: "0 4px 24px rgba(0,0,0,0.18)" }}
          >
            <p className="adm-dirty-guard-text">
              You have unsaved changes. Discard them?
            </p>
            <div className="adm-btn-row">
              <button type="button" className="adm-btn" onClick={commitPending}>
                Discard changes
              </button>
              <button type="button" className="adm-btn-outline" onClick={dismissPending}>
                Keep editing
              </button>
            </div>
          </div>
        </div>
      )}
      <h1 className="adm-heading">Automated emails</h1>
      <p className="adm-muted">
        These emails are sent automatically. You can edit the subject and body copy, and turn each one off. Text in
        curly braces like {"{organizationName}"} is filled in when the email is sent and must stay in the copy. A
        disabled email is recorded in the email log as skipped, never dropped silently.
      </p>

      <BrandingPanel />

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

      <div>
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
                  ref={(el) => { rowRefs.current[row.key] = el; }}
                  className={[
                    row.key === selectedKey ? "adm-row-selected" : "",
                    row.authInfrastructure ? "adm-row-fixed" : "adm-row-clickable",
                  ].filter(Boolean).join(" ") || undefined}
                  onClick={() => {
                    if (row.authInfrastructure) return;
                    handleRowClick(row.key);
                  }}
                >
                  <td>
                    <span className="adm-email-name-cell">
                      <span>
                        {row.name}
                        {row.hasCopyOverride && <span className="adm-muted"> (edited)</span>}
                        {row.authInfrastructure && <span className="adm-muted"> — authentication infrastructure</span>}
                        {lastEditedLabel(row) && (
                          <div className="adm-muted" style={{ fontSize: "0.85em", marginTop: 2 }}>
                            {lastEditedLabel(row)}
                          </div>
                        )}
                      </span>
                      {!row.authInfrastructure && (
                        <span className="adm-row-chevron" aria-hidden="true">›</span>
                      )}
                    </span>
                  </td>
                  <td>{row.deliveryType === "scheduled" ? `Scheduled — ${row.trigger}` : `Event-triggered — ${row.trigger}`}</td>
                  <td>
                    {row.recipients}
                    {row.effectiveRecipients && <span className="adm-muted"> ({row.effectiveRecipients.join(", ")})</span>}
                  </td>
                  <td>
                    {row.authInfrastructure ? (
                      <span className="adm-status-always-on">Always on</span>
                    ) : confirmToggleKey === row.key ? (
                      <span className="adm-status-confirm" onClick={(e) => e.stopPropagation()}>
                        <span className="adm-status-confirm-text">
                          {row.enabled ? "Turn off this email?" : "Turn on this email?"}
                        </span>
                        <button
                          type="button"
                          className="adm-btn adm-btn-sm"
                          onClick={(e) => { e.stopPropagation(); void toggleEnabled(row); }}
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          className="adm-btn-outline adm-btn-sm"
                          onClick={(e) => { e.stopPropagation(); setConfirmToggleKey(null); }}
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className={`adm-status-pill ${row.enabled ? "adm-status-pill--on" : "adm-status-pill--off"}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmToggleKey(row.key);
                        }}
                      >
                        {row.enabled ? "Enabled" : "Disabled"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {selected && draft && (
          <section
            className="adm-email-editor"
            ref={(el) => { editorRef.current = el; }}
            aria-label={`Edit ${selected.name}`}
          >
            <div className="adm-email-editor-header">
              <h2 className="adm-subheading">{selected.name}</h2>
              <button
                type="button"
                className="adm-email-editor-close"
                aria-label="Close editor"
                onClick={handleClose}
              >
                ×
              </button>
            </div>


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
          </section>
        )}
      </div>
    </div>
  );
}

function BrandingPanel(): ReactElement {
  const { data: brandData, isLoading: brandLoading } = useQuery<BrandResponse>({ queryKey: [BRAND_KEY] });
  const brand = brandData?.settings ?? BRAND_DEFAULTS;

  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<BrandSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  // Initialise draft when brand loads.
  useEffect(() => {
    if (brandData?.settings && !draft) {
      setDraft({ ...brandData.settings });
    }
  }, [brandData, draft]);

  function openPanel(): void {
    setExpanded(true);
    setMessage(null);
    setErrors([]);
    setDraft({ ...brand });
  }

  function closePanel(): void {
    setExpanded(false);
    setMessage(null);
    setErrors([]);
  }

  async function saveBrand(): Promise<void> {
    if (!draft || saving) return;
    setSaving(true);
    setMessage(null);
    setErrors([]);
    try {
      const { ok, data } = await postJson(BRAND_KEY, {
        primaryColor: draft.primaryColor,
        fontStack: draft.fontStack,
        orgName: draft.orgName,
        programName: draft.programName,
        signatureName: draft.signatureName,
        directorName: draft.directorName,
        directorEmail: draft.directorEmail,
        directorTitle: draft.directorTitle,
        headerImageUrl: draft.headerImageUrl && draft.headerImageUrl.trim() !== "" ? draft.headerImageUrl.trim() : null,
      }, "PUT");
      if (ok) {
        setMessage("Brand settings saved. All future emails will use these values.");
        await queryClient.invalidateQueries({ queryKey: [BRAND_KEY] });
      } else {
        const b = data as { errors?: string[]; message?: string } | null;
        setErrors(b?.errors ?? []);
        setMessage(b?.message ?? SAVE_FAILURE);
      }
    } catch {
      setMessage(SAVE_FAILURE);
    } finally {
      setSaving(false);
    }
  }

  async function resetBrand(): Promise<void> {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    setErrors([]);
    try {
      const { ok, data } = await postJson(`${BRAND_KEY}/reset`, {});
      if (ok) {
        const saved = (data as { settings: BrandSettings }).settings;
        setDraft({ ...saved });
        setMessage("Brand settings reset to built-in defaults.");
        await queryClient.invalidateQueries({ queryKey: [BRAND_KEY] });
      } else {
        const b = data as { message?: string } | null;
        setMessage(b?.message ?? SAVE_FAILURE);
      }
    } catch {
      setMessage(SAVE_FAILURE);
    } finally {
      setSaving(false);
    }
  }

  const lastEdited = brand.updatedAt
    ? `Last saved by ${brand.updatedByName ?? "a staff member"} on ${fmtDate(brand.updatedAt)}`
    : "Using built-in defaults — not yet customised.";

  if (!expanded) {
    return (
      <section className="adm-brand-panel adm-brand-panel--collapsed">
        <div className="adm-brand-panel-header">
          <div>
            <h2 className="adm-subheading" style={{ margin: 0 }}>Branding</h2>
            <span className="adm-muted" style={{ fontSize: "0.875em" }}>{lastEdited}</span>
          </div>
          <button type="button" className="adm-btn-outline" onClick={openPanel}>
            Edit branding
          </button>
        </div>
      </section>
    );
  }

  if (brandLoading || !draft) {
    return <section className="adm-brand-panel"><p className="adm-muted">Loading…</p></section>;
  }

  return (
    <section className="adm-brand-panel adm-brand-panel--open">
      <div className="adm-brand-panel-header">
        <h2 className="adm-subheading" style={{ margin: 0 }}>Branding</h2>
        <button type="button" className="adm-email-editor-close" aria-label="Close branding panel" onClick={closePanel}>×</button>
      </div>
      <p className="adm-muted">
        These values appear in every outbound email. Changes take effect immediately — no redeploy required.
        Tokens like <code>{"{orgName}"}</code> and <code>{"{signature}"}</code> in email copy resolve from these settings.
      </p>

      {message && <p className="adm-result" role="status">{message}</p>}
      {errors.length > 0 && (
        <ul className="adm-error-text" role="alert">
          {errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}

      <div className="adm-brand-grid">
        <div>
          <h3 className="adm-subheading">Identity</h3>
          <label className="adm-filter">
            Organisation name <span className="adm-muted">— <code>{"{orgName}"}</code></span>
            <input
              type="text"
              value={draft.orgName}
              onChange={(e) => setDraft({ ...draft, orgName: e.target.value })}
            />
          </label>
          <label className="adm-filter">
            Program name <span className="adm-muted">— <code>{"{programName}"}</code></span>
            <input
              type="text"
              value={draft.programName}
              onChange={(e) => setDraft({ ...draft, programName: e.target.value })}
            />
          </label>
          <label className="adm-filter">
            Email sign-off <span className="adm-muted">— <code>{"{signature}"}</code></span>
            <input
              type="text"
              value={draft.signatureName}
              onChange={(e) => setDraft({ ...draft, signatureName: e.target.value })}
            />
          </label>
        </div>

        <div>
          <h3 className="adm-subheading">Director contact</h3>
          <label className="adm-filter">
            Name <span className="adm-muted">— <code>{"{directorName}"}</code></span>
            <input
              type="text"
              value={draft.directorName}
              onChange={(e) => setDraft({ ...draft, directorName: e.target.value })}
            />
          </label>
          <label className="adm-filter">
            Email <span className="adm-muted">— <code>{"{directorEmail}"}</code></span>
            <input
              type="email"
              value={draft.directorEmail}
              onChange={(e) => setDraft({ ...draft, directorEmail: e.target.value })}
            />
          </label>
          <label className="adm-filter">
            Title <span className="adm-muted">— <code>{"{directorTitle}"}</code></span>
            <input
              type="text"
              value={draft.directorTitle}
              onChange={(e) => setDraft({ ...draft, directorTitle: e.target.value })}
            />
          </label>
        </div>

        <div>
          <h3 className="adm-subheading">Visual</h3>
          <label className="adm-filter">
            Primary colour <span className="adm-muted">(rgb(r,g,b) or #hex)</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="color"
                value={(() => {
                  // Convert rgb(...) to #hex for the colour picker.
                  const m = draft.primaryColor.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
                  if (m) return `#${[m[1],m[2],m[3]].map(n => Number(n).toString(16).padStart(2,"0")).join("")}`;
                  return draft.primaryColor;
                })()}
                style={{ width: 40, height: 32, padding: 2, border: "1px solid #ccc", cursor: "pointer" }}
                onChange={(e) => {
                  const hex = e.target.value;
                  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
                  setDraft({ ...draft, primaryColor: `rgb(${r}, ${g}, ${b})` });
                }}
              />
              <input
                type="text"
                value={draft.primaryColor}
                style={{ flex: 1 }}
                onChange={(e) => setDraft({ ...draft, primaryColor: e.target.value })}
              />
            </div>
          </label>
          <label className="adm-filter">
            Font stack
            <input
              type="text"
              value={draft.fontStack}
              onChange={(e) => setDraft({ ...draft, fontStack: e.target.value })}
            />
          </label>
          <label className="adm-filter">
            Header image URL <span className="adm-muted">(leave blank to use the built-in PNG)</span>
            <input
              type="url"
              value={draft.headerImageUrl ?? ""}
              placeholder="https://…"
              onChange={(e) => setDraft({ ...draft, headerImageUrl: e.target.value || null })}
            />
          </label>
          {(draft.headerImageUrl ?? "").trim() !== "" && (
            <div style={{ marginTop: 8 }}>
              <p className="adm-muted" style={{ marginBottom: 4 }}>Preview:</p>
              <img
                src={draft.headerImageUrl ?? ""}
                alt="Header preview"
                style={{ maxWidth: "100%", maxHeight: 80, border: "1px solid #ccc", borderRadius: 4 }}
              />
            </div>
          )}
        </div>
      </div>

      <p className="adm-muted" style={{ marginTop: 8 }}>{lastEdited}</p>

      <div className="adm-btn-row">
        <button type="button" className="adm-btn" disabled={saving} onClick={() => void saveBrand()}>
          {saving ? "Saving…" : "Save branding"}
        </button>
        <button type="button" className="adm-btn-outline" disabled={saving} onClick={() => void resetBrand()}>
          Reset to defaults
        </button>
      </div>
    </section>
  );
}
