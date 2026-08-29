import { useEffect, useState, type ReactElement } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AdminDonationRow,
  AdminVolunteerRow,
  ParticipationHistoryEntry,
} from "@shared/types";

type Kind = "donations" | "volunteers";
type Detail = {
  record: AdminDonationRow | AdminVolunteerRow;
  history: ParticipationHistoryEntry[];
  choices: Array<{
    id: string;
    name: string;
    quantityRequested?: number;
    quantityClaimed?: number;
    quantityRemaining?: number;
    quantityNeeded?: number;
    quantityInterested?: number;
  }>;
};

export function ParticipationManager({
  kind,
  id,
  onChanged,
}: {
  kind: Kind;
  id: string;
  onChanged?: () => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<"edit" | "cancel" | "reinstate" | null>(null);
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [roles, setRoles] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const url = `/api/admin/participation/${kind}/${id}`;
  const query = useQuery<Detail>({ queryKey: [url], enabled: open });

  useEffect(() => {
    if (!query.data) return;
    setNotes(query.data.record.notes ?? "");
    if (kind === "donations") {
      setQuantities(
        Object.fromEntries(
          (query.data.record as AdminDonationRow).lines.map((line) => [line.id, line.quantity]),
        ),
      );
    } else {
      setRoles(new Set((query.data.record as AdminVolunteerRow).roles.map((role) => role.id)));
    }
  }, [kind, query.data]);

  async function submit(): Promise<void> {
    if (!query.data || !action || reason.trim() === "") return;
    const record = query.data.record;
    const body: Record<string, unknown> = {
      expectedUpdatedAt: record.updatedAt,
      expectedVersion: record.participationVersion,
      reason: reason.trim(),
      notes: notes.trim() || null,
    };
    if (action === "edit") {
      if (kind === "donations") {
        body.lines = Object.entries(quantities)
          .filter(([, quantity]) => Number.isInteger(quantity) && quantity > 0)
          .map(([itemId, quantity]) => ({ itemId, quantity }));
      } else {
        body.roleIds = [...roles];
      }
    }
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch(
        `/api/admin/participation/${kind}/${id}/${action}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "That did not save. Nothing was changed.");
      setResult({ ok: true, text: payload.message ?? "Participation updated." });
      setAction(null);
      setReason("");
      await queryClient.invalidateQueries({ queryKey: [url] });
      await queryClient.invalidateQueries({
        predicate: (query) =>
          typeof query.queryKey[0] === "string" &&
          query.queryKey[0].startsWith("/api/admin/participation"),
      });
      onChanged?.();
    } catch (error) {
      setResult({ ok: false, text: error instanceof Error ? error.message : "That did not save. Nothing was changed." });
    } finally {
      setBusy(false);
    }
  }

  const record = query.data?.record;
  return (
    <div className="adm-participation-manager">
      <button type="button" className="adm-btn adm-btn-sm" onClick={() => setOpen((value) => !value)}>
        {open ? "Close management" : "Manage"}
      </button>
      {open && (
        <div className="adm-participation-manager-panel">
          {query.isLoading && <p className="adm-muted">Loading participation details…</p>}
          {query.isError && <p className="adm-alert">Participation details could not be loaded.</p>}
          {record && (
            <>
              <p>
                <strong>Status:</strong>{" "}
                <span className={`adm-participation-status is-${record.status}`}>{record.status}</span>
              </p>
              {record.status === "cancelled" && (
                <p className="adm-muted">
                  Cancelled {record.cancelledAt ? new Date(record.cancelledAt).toLocaleString() : ""}
                  {record.cancelledByName ? ` by ${record.cancelledByName}` : ""}: {record.cancellationReason}
                </p>
              )}
              <div className="adm-actions">
                <button type="button" className="adm-btn" onClick={() => setAction("edit")}>Edit</button>
                {record.status === "active" ? (
                  <button type="button" className="adm-btn adm-btn-danger" onClick={() => setAction("cancel")}>Cancel</button>
                ) : (
                  <button type="button" className="adm-btn adm-btn-primary" onClick={() => setAction("reinstate")}>Reinstate</button>
                )}
              </div>
              {action && (
                <div className="adm-participation-confirm">
                  {action === "edit" && (
                    <>
                      {kind === "donations" ? (
                        <fieldset>
                          <legend>Items and quantities</legend>
                          {query.data!.choices.map((choice) => {
                            const current = quantities[choice.id] ?? 0;
                            const available = (choice.quantityRemaining ?? 0) + current;
                            return (
                              <label key={choice.id}>
                                <input
                                  type="checkbox"
                                  checked={current > 0}
                                  onChange={(event) => setQuantities((values) => ({ ...values, [choice.id]: event.target.checked ? Math.max(1, current) : 0 }))}
                                />
                                {choice.name}
                                {current > 0 && (
                                  <input
                                    type="number"
                                    min={1}
                                    max={available}
                                    value={current}
                                    onChange={(event) => setQuantities((values) => ({ ...values, [choice.id]: Number(event.target.value) }))}
                                  />
                                )}
                                <small>{available} available to this pledge</small>
                              </label>
                            );
                          })}
                        </fieldset>
                      ) : (
                        <fieldset>
                          <legend>Volunteer roles</legend>
                          {query.data!.choices.map((choice) => {
                            const selected = roles.has(choice.id);
                            const available = (choice.quantityNeeded ?? 0) - (choice.quantityInterested ?? 0) + (selected ? 1 : 0);
                            return (
                              <label key={choice.id}>
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  disabled={!selected && available <= 0}
                                  onChange={(event) => setRoles((current) => {
                                    const next = new Set(current);
                                    if (event.target.checked) next.add(choice.id); else next.delete(choice.id);
                                    return next;
                                  })}
                                />
                                {choice.name} <small>({Math.max(0, available)} available)</small>
                              </label>
                            );
                          })}
                        </fieldset>
                      )}
                      <label>
                        Notes
                        <textarea value={notes} maxLength={4000} onChange={(event) => setNotes(event.target.value)} />
                      </label>
                    </>
                  )}
                  <label>
                    Reason for {action} *
                    <textarea value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} />
                  </label>
                  <p>
                    Confirm {action}: this will update current availability and save an attributable before/after audit entry.
                  </p>
                  <div className="adm-actions">
                    <button
                      type="button"
                      className={action === "cancel" ? "adm-btn adm-btn-danger" : "adm-btn adm-btn-primary"}
                      disabled={busy || reason.trim() === "" || (action === "edit" && kind === "donations" && !Object.values(quantities).some((quantity) => quantity > 0)) || (action === "edit" && kind === "volunteers" && roles.size === 0)}
                      onClick={() => void submit()}
                    >
                      {busy ? "Saving…" : `Confirm ${action}`}
                    </button>
                    <button type="button" className="adm-btn" disabled={busy} onClick={() => setAction(null)}>Keep unchanged</button>
                  </div>
                </div>
              )}
              {result && <p className={result.ok ? "adm-ok" : "adm-alert"}>{result.text}</p>}
              {query.data!.history.length > 0 && (
                <details>
                  <summary>Change history ({query.data!.history.length})</summary>
                  <ul className="adm-participation-history">
                    {query.data!.history.map((entry) => (
                      <li key={entry.id}>
                        <strong>{entry.action}</strong> by {entry.actorName ?? "Staff"} on{" "}
                        {new Date(entry.createdAt).toLocaleString()}: {entry.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}