/**
 * ADMIN-05 — POPULATIONS MANAGEMENT (docs/specs/ADMIN-05.md).
 *
 * Two jobs (§1): manage the list organizations select from, and — the
 * bigger one — surface what they typed into the free-text Other field so a
 * recurring value becomes a real option instead of unsearchable text.
 * Region 3 is the reason this surface exists (§4).
 *
 * Staff admin only (§11) — the server 404s everyone else.
 *
 * Rules kept here:
 * - Slug is generated from the name and editable until first save, never
 *   after (D18) — future public pages may link to it.
 * - Deactivation never strips existing assignments (§6), and Other cannot
 *   be deactivated at all — it is permanent infrastructure.
 * - Promote (D19/D20): the operator may edit the name first; case and
 *   whitespace variants of a value group and promote together.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

type PopulationRow = {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
  orgCount: number;
};

type OtherGroup = {
  groupKey: string;
  value: string;
  orgCount: number;
  orgs: { id: string; name: string; raw: string }[];
};

/** §8 verbatim. */
const LIST_EMPTY = "No populations yet.";
const OTHER_EMPTY = "No organizations have entered a custom population.";
const ZERO_ORGS = "Not used by any organization";
const RENAME_NOTE = "Renaming changes this label everywhere it appears, including on live request pages.";
const OTHER_BLOCKED = "Other cannot be deactivated. Organizations need a way to describe populations that are not listed.";
const FAILURE = "That did not save. Nothing was changed.";
const LIST_ERROR = "Something went wrong loading this list. Please refresh the page and try again.";

/** Mirror of the server-side slug generator. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function postJson(path: string, body?: unknown): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let payload: { message?: string } = {};
  try {
    payload = (await res.json()) as { message?: string };
  } catch {
    /* non-JSON — fall through to the generic failure line */
  }
  return { ok: res.ok, message: payload.message ?? (res.ok ? "" : FAILURE) };
}

export function PopulationsPage() {
  const queryClient = useQueryClient();
  const [addName, setAddName] = useState("");
  const [addSlug, setAddSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);
  const [promote, setPromote] = useState<{ groupKey: string; name: string; confirming: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const listQuery = useQuery<{ populations: PopulationRow[]; otherValues: OtherGroup[] }>({
    queryKey: ["/api/admin/populations"],
  });

  async function act(path: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setResult(null);
    let ok = false;
    let message = "";
    try {
      const r = await postJson(path, body);
      ok = r.ok;
      message = r.message;
    } catch {
      message = FAILURE;
    } finally {
      setBusy(false);
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/populations"] });
    }
    if (message !== "") setResult({ kind: ok ? "ok" : "error", text: message });
    return ok;
  }

  const populations = listQuery.data?.populations ?? [];
  const otherValues = listQuery.data?.otherValues ?? [];

  async function moveRow(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= populations.length) return;
    const ids = populations.map((p) => p.id);
    const moved = ids[index]!;
    ids[index] = ids[target]!;
    ids[target] = moved;
    await act("/api/admin/populations/reorder", { orderedIds: ids });
  }

  return (
    <div>
      <h1 className="adm-heading">Populations</h1>

      {result && <p className={result.kind === "ok" ? "adm-ok" : "adm-alert"}>{result.text}</p>}

      {listQuery.isError ? (
        <p className="adm-alert">{LIST_ERROR}</p>
      ) : listQuery.isLoading ? (
        <p className="adm-muted">Loading…</p>
      ) : (
        <>
          {/* §4 region 1 — the list. */}
          {populations.length === 0 ? (
            <p className="adm-muted">{LIST_EMPTY}</p>
          ) : (
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Name</th>
                  <th>Slug</th>
                  <th>Used by</th>
                  <th>State</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {populations.map((p, i) => (
                  <tr key={p.id} className="adm-row">
                    <td>
                      <button
                        className="adm-btn"
                        aria-label={`Move ${p.name} up`}
                        disabled={busy || i === 0}
                        onClick={() => void moveRow(i, -1)}
                      >
                        ↑
                      </button>{" "}
                      <button
                        className="adm-btn"
                        aria-label={`Move ${p.name} down`}
                        disabled={busy || i === populations.length - 1}
                        onClick={() => void moveRow(i, 1)}
                      >
                        ↓
                      </button>
                    </td>
                    <td>
                      {renameId === p.id ? (
                        <span>
                          <input
                            value={renameValue}
                            disabled={busy}
                            onChange={(e) => setRenameValue(e.target.value)}
                            aria-label={`New name for ${p.name}`}
                          />
                          {/* §8 verbatim rename note. */}
                          <span className="adm-muted" style={{ display: "block", fontSize: 12 }}>
                            {RENAME_NOTE}
                          </span>
                          <button
                            className="adm-btn adm-btn-primary"
                            disabled={busy || renameValue.trim() === "" || renameValue.trim() === p.name}
                            onClick={() => {
                              void (async () => {
                                const ok = await act(`/api/admin/populations/${p.id}/rename`, {
                                  name: renameValue.trim(),
                                });
                                if (ok) setRenameId(null);
                              })();
                            }}
                          >
                            Save
                          </button>{" "}
                          <button className="adm-btn" disabled={busy} onClick={() => setRenameId(null)}>
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <span>
                          {p.name}{" "}
                          <button
                            className="adm-btn"
                            disabled={busy}
                            onClick={() => {
                              setRenameId(p.id);
                              setRenameValue(p.name);
                              setConfirmDeactivateId(null);
                              setResult(null);
                            }}
                          >
                            Rename
                          </button>
                        </span>
                      )}
                    </td>
                    <td>{p.slug}</td>
                    {/* §7: zero-org rows are deactivation candidates at a glance. */}
                    <td>{p.orgCount === 0 ? <span className="adm-muted">{ZERO_ORGS}</span> : p.orgCount}</td>
                    <td>{p.isActive ? "Active" : <strong>Inactive</strong>}</td>
                    <td>
                      {p.slug === "other" ? (
                        /* §6/§8: permanent infrastructure, stated reason. */
                        <span className="adm-muted" style={{ fontSize: 12 }}>
                          {OTHER_BLOCKED}
                        </span>
                      ) : p.isActive ? (
                        confirmDeactivateId === p.id ? (
                          <span>
                            {/* §8 verbatim deactivate confirmation. */}
                            <span style={{ display: "block" }}>
                              Deactivate {p.name}? {p.orgCount} organizations already using it keep it. New
                              organizations will not see it as an option.
                            </span>
                            <button
                              className="adm-btn adm-btn-primary"
                              disabled={busy}
                              onClick={() => {
                                void (async () => {
                                  const ok = await act(`/api/admin/populations/${p.id}/deactivate`);
                                  if (ok) setConfirmDeactivateId(null);
                                })();
                              }}
                            >
                              Deactivate
                            </button>{" "}
                            <button className="adm-btn" disabled={busy} onClick={() => setConfirmDeactivateId(null)}>
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button
                            className="adm-btn"
                            disabled={busy}
                            onClick={() => {
                              setConfirmDeactivateId(p.id);
                              setRenameId(null);
                              setResult(null);
                            }}
                          >
                            Deactivate
                          </button>
                        )
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* §4 region 2 — add form. Slug generated, editable until save (D18). */}
          <h3 className="adm-subheading">Add population</h3>
          <div className="adm-form-row">
            <label>
              Name
              <input
                value={addName}
                disabled={busy}
                onChange={(e) => {
                  setAddName(e.target.value);
                  if (!slugTouched) setAddSlug(slugify(e.target.value));
                }}
              />
            </label>
            <label>
              Slug
              <input
                value={addSlug}
                disabled={busy}
                onChange={(e) => {
                  setSlugTouched(true);
                  setAddSlug(e.target.value);
                }}
              />
            </label>
            <button
              className="adm-btn adm-btn-primary"
              disabled={busy || addName.trim() === "" || addSlug.trim() === ""}
              onClick={() => {
                void (async () => {
                  const ok = await act("/api/admin/populations", { name: addName.trim(), slug: addSlug.trim() });
                  if (ok) {
                    setAddName("");
                    setAddSlug("");
                    setSlugTouched(false);
                  }
                })();
              }}
            >
              Add
            </button>
          </div>

          {/* §4 region 3 — the reason this surface exists. */}
          <h3 className="adm-subheading">Other values</h3>
          {otherValues.length === 0 ? (
            /* §9: empty is the healthy state and reads as such. */
            <p className="adm-muted">{OTHER_EMPTY}</p>
          ) : (
            otherValues.map((g) => {
              const isOpen = promote?.groupKey === g.groupKey;
              const orgNames = g.orgs.map((o) => o.name).join(", ");
              return (
                <div key={g.groupKey} className="adm-candidate">
                  <h4 className="adm-list-label">
                    “{g.value}” — {g.orgCount} organization{g.orgCount === 1 ? "" : "s"}
                  </h4>
                  <p className="adm-muted">{orgNames}</p>
                  {!isOpen ? (
                    <button
                      className="adm-btn"
                      disabled={busy}
                      onClick={() => {
                        // D19: the value as typed is a starting point, not a decision.
                        setPromote({ groupKey: g.groupKey, name: g.value, confirming: false });
                        setResult(null);
                      }}
                    >
                      Promote
                    </button>
                  ) : (
                    <div className="adm-confirm">
                      <label style={{ display: "block" }}>
                        Name for the new population
                        <input
                          value={promote.name}
                          disabled={busy || promote.confirming}
                          onChange={(e) => setPromote({ ...promote, name: e.target.value })}
                        />
                      </label>
                      {!promote.confirming ? (
                        <div className="adm-actions">
                          <button
                            className="adm-btn adm-btn-primary"
                            disabled={busy || promote.name.trim() === ""}
                            onClick={() => setPromote({ ...promote, confirming: true })}
                          >
                            Continue
                          </button>
                          <button className="adm-btn" disabled={busy} onClick={() => setPromote(null)}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div>
                          {/* §8 verbatim promote confirmation. */}
                          <p>
                            Add "{promote.name.trim()}" as a population and assign it to {g.orgCount} organizations?{" "}
                            {orgNames}.
                          </p>
                          <div className="adm-actions">
                            <button
                              className="adm-btn adm-btn-primary"
                              disabled={busy}
                              onClick={() => {
                                void (async () => {
                                  const ok = await act("/api/admin/populations/promote", {
                                    value: g.value,
                                    name: promote.name.trim(),
                                  });
                                  if (ok) setPromote(null);
                                })();
                              }}
                            >
                              Promote
                            </button>
                            <button className="adm-btn" disabled={busy} onClick={() => setPromote(null)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </>
      )}
    </div>
  );
}
