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
import { Fragment, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ListCount, ListSearch, SortableHeader, filterAndSort, type SortDirection } from "../../components/admin/ListControls";

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
  const [populationSearch, setPopulationSearch] = useState("");
  const [otherSearch, setOtherSearch] = useState("");
  const [populationSort, setPopulationSort] = useState<"order" | "name" | "slug" | "orgCount" | "state">("order");
  const [populationDirection, setPopulationDirection] = useState<SortDirection>("asc");
  const [otherSort, setOtherSort] = useState<"value" | "orgCount">("value");
  const [otherDirection, setOtherDirection] = useState<SortDirection>("asc");

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
  const visiblePopulations = filterAndSort(populations, populationSearch,
    (p) => [p.name, p.slug, p.sortOrder, p.orgCount, p.isActive ? "active" : "inactive"], (p) => p.id,
    (p) => ({ order: p.sortOrder, name: p.name, slug: p.slug, orgCount: p.orgCount, state: p.isActive ? "Active" : "Inactive" }[populationSort]), populationDirection);
  const visibleOtherValues = filterAndSort(otherValues, otherSearch,
    (g) => [g.value, g.orgCount, ...g.orgs.map((o) => o.name)], (g) => g.groupKey,
    (g) => ({ value: g.value, orgCount: g.orgCount }[otherSort]), otherDirection);

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
            <>
            <ListSearch value={populationSearch} onChange={setPopulationSearch} label="Search populations" />
            <ListCount count={visiblePopulations.length} noun="populations" />
            <div className="adm-table-wrap">
            <table className="adm-table">
              <thead>
                <tr>
                  <SortableHeader label="Order" column="order" sort={populationSort} direction={populationDirection} onSort={(c,d) => { setPopulationSort(c); setPopulationDirection(d); }} />
                   <SortableHeader label="Name" column="name" sort={populationSort} direction={populationDirection} onSort={(c,d) => { setPopulationSort(c); setPopulationDirection(d); }} />
                   <SortableHeader label="Slug" column="slug" sort={populationSort} direction={populationDirection} onSort={(c,d) => { setPopulationSort(c); setPopulationDirection(d); }} />
                   <SortableHeader label="Used by" column="orgCount" sort={populationSort} direction={populationDirection} onSort={(c,d) => { setPopulationSort(c); setPopulationDirection(d); }} />
                   <SortableHeader label="State" column="state" sort={populationSort} direction={populationDirection} onSort={(c,d) => { setPopulationSort(c); setPopulationDirection(d); }} />
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                 {visiblePopulations.map((p) => {
                   const i = populations.findIndex((original) => original.id === p.id);
                   return (
                  <Fragment key={p.id}>
                    <tr className="adm-row">
                      <td>
                        <div className="adm-order-controls" aria-label={`Reorder ${p.name}`}>
                          <button
                            className="adm-order-btn"
                            aria-label={`Move ${p.name} up`}
                            title="Move up"
                            disabled={busy || i === 0}
                            onClick={() => void moveRow(i, -1)}
                          >
                            <span aria-hidden="true">↑</span>
                          </button>
                          <button
                            className="adm-order-btn"
                            aria-label={`Move ${p.name} down`}
                            title="Move down"
                            disabled={busy || i === populations.length - 1}
                            onClick={() => void moveRow(i, 1)}
                          >
                            <span aria-hidden="true">↓</span>
                          </button>
                        </div>
                      </td>
                      <td>
                        {renameId === p.id ? (
                          <div className="adm-population-rename-field">
                            <input
                              value={renameValue}
                              disabled={busy}
                              onChange={(e) => setRenameValue(e.target.value)}
                              aria-label={`New name for ${p.name}`}
                            />
                            <span className="adm-muted adm-population-note">
                              {RENAME_NOTE}
                            </span>
                          </div>
                        ) : (
                          p.name
                        )}
                      </td>
                      <td>{p.slug}</td>
                      {/* §7: zero-org rows are deactivation candidates at a glance. */}
                      <td>{p.orgCount === 0 ? <span className="adm-muted">{ZERO_ORGS}</span> : p.orgCount}</td>
                      <td>{p.isActive ? "Active" : <strong>Inactive</strong>}</td>
                      <td>
                        {renameId === p.id ? (
                          <div className="adm-btn-row">
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
                              </button>
                              <button className="adm-btn" disabled={busy} onClick={() => setRenameId(null)}>
                                Cancel
                              </button>
                          </div>
                        ) : p.slug === "other" ? (
                          <div className="adm-btn-row">
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
                            <span className="adm-muted adm-population-note">{OTHER_BLOCKED}</span>
                          </div>
                        ) : (
                          <div className="adm-btn-row">
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
                            {p.isActive && (
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
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                    {/* Step 4: Deactivate confirmation as an expansion row. */}
                    {confirmDeactivateId === p.id && (
                      <tr>
                        <td colSpan={6} style={{ background: "#fff8f0", padding: "10px 16px" }}>
                          {/* §8 verbatim deactivate confirmation. */}
                          <p style={{ margin: "0 0 8px" }}>
                            Deactivate {p.name}? {p.orgCount} organizations already using it keep it. New organizations
                            will not see it as an option.
                          </p>
                          <div className="adm-btn-row">
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
                            </button>
                            <button
                              className="adm-btn"
                              disabled={busy}
                              onClick={() => setConfirmDeactivateId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                 );})}
              </tbody>
            </table>
            </div>
            </>
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
          <ListSearch value={otherSearch} onChange={setOtherSearch} label="Search Other values" />
          <div className="adm-btn-row">
            <SortableHeader label="Value" column="value" sort={otherSort} direction={otherDirection} onSort={(c,d) => { setOtherSort(c); setOtherDirection(d); }} />
          </div>
          <ListCount count={visibleOtherValues.length} noun="Other values" />
          {visibleOtherValues.length === 0 ? (
            /* §9: empty is the healthy state and reads as such. */
            <p className="adm-muted">{OTHER_EMPTY}</p>
          ) : (
            visibleOtherValues.map((g) => {
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
