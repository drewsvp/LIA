/**
 * ADMIN-04 — PEOPLE REVIEW QUEUE (docs/specs/ADMIN-04.md).
 *
 * Where staff resolve people records flagged for human review (§1): names
 * the migration could not split, suspected duplicates from the phone-match
 * signal, records that look like the same human. Staff ADMIN only (§11) —
 * the server 404s everyone else; this page simply renders what the API
 * grants.
 *
 * The detail lists attached records BY NAME, not as counts (§4): "pledged
 * 2 blankets to Acres of Hope in March" is what makes a merge decision
 * possible. Source note and review reason render separately (§3) — one is
 * the verbatim original, the other is why the row is here.
 *
 * Save names and Clear flag are live. Merge — the system's only
 * irreversible action — ships with the merge_people() database function
 * once that DDL is approved; until then candidates render read-only.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

type Person = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  needsReview: boolean;
  reviewNote: string | null;
  sourceNote: string | null;
};

type QueueRow = Person & {
  pledgeCount: number;
  signupCount: number;
  membershipCount: number;
  primaryContactCount: number;
};

type Attached = {
  pledges: { id: string; requestTitle: string; orgName: string; createdAt: string; lines: { itemName: string; quantity: number }[] }[];
  signups: { id: string; requestTitle: string; orgName: string; createdAt: string; roles: { roleName: string }[] }[];
  memberships: { orgName: string; role: string; status: string }[];
  primaryContactOrgs: { id: string; name: string }[];
  requestContacts: { id: string; title: string; orgName: string; kind: "item" | "volunteer" }[];
  hasUser: boolean;
  digestSubscription: { email: string; status: string } | null;
  emailLogCount: number;
};

type Detail = {
  person: Person;
  attached: Attached;
  candidates: { person: Person; attached: Attached }[];
};

/** §8 verbatim. */
const EMPTY_QUEUE = "No records need review.";
const NO_CANDIDATES = "No possible duplicates found.";
const SAVE_NAMES_RESULT = "Name updated. This record is still flagged for review.";
const FAILURE = "That did not save. Nothing was changed.";
const LIST_ERROR = "Something went wrong loading this list. Please refresh the page and try again.";
const DETAIL_ERROR = "Something went wrong loading this record. Please refresh the page and try again.";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { dateStyle: "medium" });
}

function fullName(p: Person): string {
  return `${p.firstName} ${p.lastName}`.trim();
}

function countsSummary(row: QueueRow): string {
  const parts: string[] = [];
  if (row.pledgeCount > 0) parts.push(`${row.pledgeCount} pledge${row.pledgeCount === 1 ? "" : "s"}`);
  if (row.signupCount > 0) parts.push(`${row.signupCount} signup${row.signupCount === 1 ? "" : "s"}`);
  if (row.membershipCount > 0) parts.push(`${row.membershipCount} membership${row.membershipCount === 1 ? "" : "s"}`);
  if (row.primaryContactCount > 0)
    parts.push(`contact for ${row.primaryContactCount} org${row.primaryContactCount === 1 ? "" : "s"}`);
  return parts.length === 0 ? "Nothing attached" : parts.join(" · ");
}

/** Rows attached to a record, for defaulting the merge survivor (§6). */
function attachedTotal(a: Attached): number {
  return (
    a.pledges.length +
    a.signups.length +
    a.memberships.length +
    a.primaryContactOrgs.length +
    a.requestContacts.length +
    (a.hasUser ? 1 : 0) +
    (a.digestSubscription ? 1 : 0) +
    a.emailLogCount
  );
}

/** What moves off the duplicate — the confirm must list it exactly (§6). */
function movesSummary(a: Attached): string {
  const parts: string[] = [];
  if (a.pledges.length > 0) parts.push(`${a.pledges.length} pledge${a.pledges.length === 1 ? "" : "s"}`);
  if (a.signups.length > 0) parts.push(`${a.signups.length} signup${a.signups.length === 1 ? "" : "s"}`);
  if (a.hasUser)
    parts.push(
      `1 login account${a.memberships.length > 0 ? ` (with ${a.memberships.length} membership${a.memberships.length === 1 ? "" : "s"})` : ""}`,
    );
  if (a.digestSubscription) parts.push("1 digest subscription");
  for (const o of a.primaryContactOrgs) parts.push(`the primary-contact reference for ${o.name}`);
  for (const r of a.requestContacts) parts.push(`the contact reference for "${r.title}" (${r.orgName})`);
  if (a.emailLogCount > 0)
    parts.push(`${a.emailLogCount} email log entr${a.emailLogCount === 1 ? "y" : "ies"}`);
  return parts.length === 0 ? "Nothing is attached to it" : `Moves: ${parts.join(", ")}`;
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
    /* non-JSON body — fall through to the generic failure line */
  }
  return { ok: res.ok, message: payload.message ?? FAILURE };
}

/** Named attached-record lists (§4 region 2) — shared by person and candidates. */
function AttachedRecords({ attached, personName }: { attached: Attached; personName: string }) {
  const nothing =
    attached.pledges.length === 0 &&
    attached.signups.length === 0 &&
    attached.memberships.length === 0 &&
    attached.primaryContactOrgs.length === 0 &&
    attached.requestContacts.length === 0 &&
    !attached.hasUser &&
    attached.digestSubscription === null &&
    attached.emailLogCount === 0;
  if (nothing) return <p className="adm-muted">No attached records.</p>;
  return (
    <div>
      {/* §7: getting a merge wrong changes who an organization's contact is. */}
      {attached.primaryContactOrgs.map((org) => (
        <p key={org.id} className="adm-alert">
          {personName} is the primary contact for {org.name}.
        </p>
      ))}
      {attached.hasUser && <p className="adm-alert">This person has a login account.</p>}
      {attached.pledges.length > 0 && (
        <>
          <h4 className="adm-list-label">Pledges</h4>
          <ul className="adm-record-list">
            {attached.pledges.map((p) => (
              <li key={p.id}>
                {p.lines.length > 0
                  ? p.lines.map((l) => `${l.quantity} ${l.itemName}`).join(", ")
                  : "(no lines)"}{" "}
                — {p.requestTitle}, {p.orgName}, {formatDate(p.createdAt)}
              </li>
            ))}
          </ul>
        </>
      )}
      {attached.signups.length > 0 && (
        <>
          <h4 className="adm-list-label">Volunteer signups</h4>
          <ul className="adm-record-list">
            {attached.signups.map((s) => (
              <li key={s.id}>
                {s.roles.length > 0 ? s.roles.map((r) => r.roleName).join(", ") : "(no roles)"} — {s.requestTitle},{" "}
                {s.orgName}, {formatDate(s.createdAt)}
              </li>
            ))}
          </ul>
        </>
      )}
      {attached.memberships.length > 0 && (
        <>
          <h4 className="adm-list-label">Memberships</h4>
          <ul className="adm-record-list">
            {attached.memberships.map((m, i) => (
              <li key={i}>
                {m.orgName} — {m.role}, {m.status}
              </li>
            ))}
          </ul>
        </>
      )}
      {attached.requestContacts.length > 0 && (
        <>
          <h4 className="adm-list-label">Request contact</h4>
          <ul className="adm-record-list">
            {attached.requestContacts.map((r) => (
              <li key={`${r.kind}-${r.id}`}>
                {r.title} — {r.orgName}
              </li>
            ))}
          </ul>
        </>
      )}
      {attached.digestSubscription && (
        <p className="adm-muted">
          Digest subscriber ({attached.digestSubscription.email}, {attached.digestSubscription.status})
        </p>
      )}
      {attached.emailLogCount > 0 && (
        <p className="adm-muted">
          {attached.emailLogCount} email log entr{attached.emailLogCount === 1 ? "y" : "ies"}
        </p>
      )}
    </div>
  );
}

export function PeopleReviewPage() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [namesLoadedFor, setNamesLoadedFor] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  // Merge flow (§6): candidate chosen → direction → confirm 1 → typed MERGE.
  const [merge, setMerge] = useState<{ candidateId: string; survivorIsCandidate: boolean; step: 1 | 2 } | null>(null);
  const [mergeToken, setMergeToken] = useState("");
  const detailRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (selectedId !== null) {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selectedId]);

  const listQuery = useQuery<{ people: QueueRow[] }>({ queryKey: ["/api/admin/people/review"] });
  const detailQuery = useQuery<Detail>({
    queryKey: [`/api/admin/people/review/${selectedId}`],
    enabled: selectedId !== null,
  });

  const detail = detailQuery.data ?? null;

  // Seed the editable name fields once per selected record.
  useEffect(() => {
    if (detail && detail.person.id !== namesLoadedFor) {
      setFirstName(detail.person.firstName);
      setLastName(detail.person.lastName);
      setNamesLoadedFor(detail.person.id);
    }
  }, [detail, namesLoadedFor]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["/api/admin/people/review"] });
    if (selectedId) {
      await queryClient.invalidateQueries({ queryKey: [`/api/admin/people/review/${selectedId}`] });
    }
  }

  async function act(path: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setResult(null);
    let ok = false;
    try {
      const r = await postJson(path, body);
      ok = r.ok;
      setResult({ kind: r.ok ? "ok" : "error", text: r.message });
    } catch {
      setResult({ kind: "error", text: FAILURE });
    } finally {
      setBusy(false);
      await refresh();
    }
    return ok;
  }

  const rows = listQuery.data?.people ?? [];
  const person = detail?.person ?? null;
  const namesChanged =
    person !== null && (firstName.trim() !== person.firstName || lastName.trim() !== person.lastName);
  const namesValid = firstName.trim() !== "" && lastName.trim() !== "";

  return (
    <div>
      <h1 className="adm-heading">People review</h1>

      {selectedId === null && result && (
        <p className={result.kind === "ok" ? "adm-ok" : "adm-alert"}>{result.text}</p>
      )}

      {listQuery.isError ? (
        <p className="adm-alert">{LIST_ERROR}</p>
      ) : listQuery.isLoading ? (
        <p className="adm-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="adm-muted">{EMPTY_QUEUE}</p>
      ) : (
        <table className="adm-table">
          <thead>
            <tr>
              <th>Name as imported</th>
              <th>Email</th>
              <th>Why flagged</th>
              <th>Attached</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={selectedId === row.id ? "adm-row adm-row-on" : "adm-row"}
                onClick={() => {
                  setSelectedId(row.id);
                  setNamesLoadedFor(null);
                  setConfirmClear(false);
                  setMerge(null);
                  setMergeToken("");
                  setResult(null);
                }}
              >
                <td>{fullName(row)}</td>
                <td>{row.email}</td>
                <td>{row.reviewNote ?? "—"}</td>
                <td>{countsSummary(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selectedId !== null && (
        <div className="adm-detail" ref={detailRef}>
          {detailQuery.isError ? (
            <p className="adm-alert">{DETAIL_ERROR}</p>
          ) : detailQuery.isLoading || !detail || !person ? (
            <p className="adm-muted">Loading…</p>
          ) : (
            <>
              <h2 className="adm-subheading">{fullName(person)}</h2>

              {/* §5: names editable; email is the identity key and is not. */}
              <div className="adm-form-row">
                <label>
                  First name
                  <input value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={busy} />
                </label>
                <label>
                  Last name
                  <input value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={busy} />
                </label>
              </div>
              <dl className="adm-kv">
                <dt>Email</dt>
                <dd>{person.email}</dd>
                <dt>Phone</dt>
                <dd>{person.phone ?? "Not provided"}</dd>
                {/* §3: the two notes have distinct jobs; label them distinctly. */}
                <dt>Source note</dt>
                <dd>{person.sourceNote ?? "—"}</dd>
                <dt>Review reason</dt>
                <dd>{person.reviewNote ?? "—"}</dd>
              </dl>

              <AttachedRecords attached={detail.attached} personName={fullName(person)} />

              {result && <p className={result.kind === "ok" ? "adm-ok" : "adm-alert"}>{result.text}</p>}

              <div className="adm-actions">
                <button
                  className="adm-btn adm-btn-primary"
                  disabled={busy || !namesValid || !namesChanged}
                  onClick={() =>
                    void act(`/api/admin/people/review/${person.id}/names`, {
                      firstName: firstName.trim(),
                      lastName: lastName.trim(),
                    })
                  }
                >
                  Save names
                </button>
                <button className="adm-btn" disabled={busy} onClick={() => setConfirmClear(true)}>
                  Clear flag
                </button>
              </div>

              {confirmClear && (
                <div className="adm-confirm">
                  {/* §8 verbatim. */}
                  <p>Clear the review flag on {fullName(person)}?</p>
                  <button
                    className="adm-btn adm-btn-primary"
                    disabled={busy}
                    onClick={() => {
                      void (async () => {
                        const ok = await act(`/api/admin/people/review/${person.id}/clear-flag`);
                        if (ok) {
                          setConfirmClear(false);
                          setSelectedId(null);
                        }
                      })();
                    }}
                  >
                    Clear flag
                  </button>
                  <button className="adm-btn" disabled={busy} onClick={() => setConfirmClear(false)}>
                    Cancel
                  </button>
                </div>
              )}

              {/* §4 region 3: candidates with their own attached summaries. */}
              <h3 className="adm-subheading">Possible duplicates</h3>
              {detail.candidates.length === 0 ? (
                <p className="adm-muted">{NO_CANDIDATES}</p>
              ) : (
                detail.candidates.map((c) => {
                  const bothHaveLogins = detail.attached.hasUser && c.attached.hasUser;
                  const isOpen = merge?.candidateId === c.person.id;
                  const survivorSide = isOpen && merge.survivorIsCandidate ? c : { person, attached: detail.attached };
                  const duplicateSide = isOpen && merge.survivorIsCandidate ? { person, attached: detail.attached } : c;
                  const survivorName = fullName(survivorSide.person as Person);
                  const duplicateName = fullName(duplicateSide.person as Person);
                  const bothPrimaryContacts =
                    detail.attached.primaryContactOrgs.length > 0 && c.attached.primaryContactOrgs.length > 0;
                  return (
                    <div key={c.person.id} className="adm-candidate">
                      <h4 className="adm-list-label">
                        {fullName(c.person)} — {c.person.email}
                        {c.person.phone ? `, ${c.person.phone}` : ""}
                      </h4>
                      <AttachedRecords attached={c.attached} personName={fullName(c.person)} />
                      {bothHaveLogins ? (
                        /* §8 verbatim, §12: readable reason instead of a dead button. */
                        <p className="adm-alert">Both records have login accounts. Remove or reassign one before merging.</p>
                      ) : !isOpen ? (
                        <button
                          className="adm-btn"
                          disabled={busy}
                          onClick={() => {
                            // §6: default the survivor to the record with the
                            // most attached rows; the operator can override.
                            setMerge({
                              candidateId: c.person.id,
                              survivorIsCandidate: attachedTotal(c.attached) > attachedTotal(detail.attached),
                              step: 1,
                            });
                            setMergeToken("");
                            setResult(null);
                          }}
                        >
                          Merge with this record
                        </button>
                      ) : (
                        <div className="adm-confirm">
                          <p className="adm-list-label">Which record survives?</p>
                          <label style={{ display: "block" }}>
                            <input
                              type="radio"
                              name={`survivor-${c.person.id}`}
                              checked={!merge.survivorIsCandidate}
                              disabled={busy || merge.step === 2}
                              onChange={() => setMerge({ ...merge, survivorIsCandidate: false })}
                            />{" "}
                            Keep {fullName(person)} — delete {fullName(c.person)}
                          </label>
                          <label style={{ display: "block" }}>
                            <input
                              type="radio"
                              name={`survivor-${c.person.id}`}
                              checked={merge.survivorIsCandidate}
                              disabled={busy || merge.step === 2}
                              onChange={() => setMerge({ ...merge, survivorIsCandidate: true })}
                            />{" "}
                            Keep {fullName(c.person)} — delete {fullName(person)}
                          </label>
                          {/* §8 verbatim: names both records, lists exactly what
                              moves, states the delete and its permanence. */}
                          <p>
                            Merge {duplicateName} into {survivorName}? {movesSummary(duplicateSide.attached)}. The{" "}
                            {duplicateName} record will be deleted. This cannot be undone.
                          </p>
                          {bothPrimaryContacts && (
                            /* §12: two organizations' contacts change at once — say so. */
                            <p className="adm-alert">
                              Both records are organization primary contacts; after the merge, all of these references
                              point to {survivorName}.
                            </p>
                          )}
                          {merge.step === 1 ? (
                            <div className="adm-actions">
                              <button
                                className="adm-btn adm-btn-primary"
                                disabled={busy}
                                onClick={() => setMerge({ ...merge, step: 2 })}
                              >
                                Continue
                              </button>
                              <button className="adm-btn" disabled={busy} onClick={() => setMerge(null)}>
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div>
                              {/* §8 verbatim second confirmation. */}
                              <p>Type MERGE to confirm.</p>
                              <input
                                value={mergeToken}
                                disabled={busy}
                                onChange={(e) => setMergeToken(e.target.value)}
                                aria-label="Type MERGE to confirm"
                              />
                              <div className="adm-actions">
                                <button
                                  className="adm-btn adm-btn-primary"
                                  disabled={busy || mergeToken !== "MERGE"}
                                  onClick={() => {
                                    void (async () => {
                                      const survivorId = survivorSide.person.id;
                                      const duplicateId = duplicateSide.person.id;
                                      setBusy(true);
                                      setResult(null);
                                      try {
                                        const r = await postJson(`/api/admin/people/review/${person.id}/merge`, {
                                          duplicateId,
                                          survivorId,
                                          confirm: mergeToken,
                                        });
                                        setResult({ kind: r.ok ? "ok" : "error", text: r.message });
                                        if (r.ok) {
                                          setMerge(null);
                                          setMergeToken("");
                                          if (duplicateId === person.id) {
                                            // The flagged record no longer exists.
                                            setSelectedId(null);
                                          }
                                        }
                                      } catch {
                                        setResult({ kind: "error", text: FAILURE });
                                      } finally {
                                        setBusy(false);
                                        await refresh();
                                      }
                                    })();
                                  }}
                                >
                                  Merge
                                </button>
                                <button
                                  className="adm-btn"
                                  disabled={busy}
                                  onClick={() => {
                                    setMerge(null);
                                    setMergeToken("");
                                  }}
                                >
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
      )}
    </div>
  );
}
