/**
 * ADMIN-11 — staff-admin configuration for the shared volunteer-interest
 * vocabulary. Categories stay alphabetized automatically and are deactivated,
 * never deleted, so existing supporter preferences remain identifiable.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

type CategoryRow = {
  id: string;
  name: string;
  isActive: boolean;
  interestCount: number;
};

const FAILURE = "That did not save. Nothing was changed.";

async function postJson(path: string, body?: unknown): Promise<{ ok: boolean; message: string }> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload: { message?: string } = {};
  try {
    payload = (await response.json()) as { message?: string };
  } catch {
    // The generic failure below remains actionable if the response is not JSON.
  }
  return { ok: response.ok, message: payload.message ?? (response.ok ? "" : FAILURE) };
}

export function VolunteerCategoriesPage() {
  const queryClient = useQueryClient();
  const [addName, setAddName] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const listQuery = useQuery<{ categories: CategoryRow[] }>({
    queryKey: ["/api/admin/volunteer-categories"],
  });

  async function act(path: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setResult(null);
    try {
      const response = await postJson(path, body);
      setResult({ kind: response.ok ? "ok" : "error", text: response.message || FAILURE });
      if (response.ok) {
        await queryClient.invalidateQueries({ queryKey: ["/api/admin/volunteer-categories"] });
      }
      return response.ok;
    } catch {
      setResult({ kind: "error", text: FAILURE });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const categories = listQuery.data?.categories ?? [];

  return (
    <div>
      <h1 className="adm-heading">Volunteer categories</h1>
      <p className="adm-muted">
        These choices appear on supporter profiles. Deactivating a category hides it from new selections without
        removing it from people who already chose it.
      </p>

      {result && (
        <p role={result.kind === "error" ? "alert" : "status"} className={result.kind === "ok" ? "adm-ok" : "adm-alert"}>
          {result.text}
        </p>
      )}

      {listQuery.isError ? (
        <p role="alert" className="adm-alert">
          Something went wrong loading this list. Please refresh the page and try again.
        </p>
      ) : listQuery.isLoading ? (
        <div className="adm-loading-list" aria-label="Loading volunteer categories">
          <span />
          <span />
          <span />
        </div>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Saved by</th>
                <th>State</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.length === 0 ? (
                <tr>
                  <td colSpan={4} className="adm-empty-cell">
                    No volunteer categories yet. Add the first category below.
                  </td>
                </tr>
              ) : (
                categories.map((category) => (
                  <tr key={category.id} className="adm-row">
                    <td>
                      {renameId === category.id ? (
                        <span>
                          <input
                            aria-label={`New name for ${category.name}`}
                            value={renameName}
                            maxLength={120}
                            disabled={busy}
                            onChange={(event) => setRenameName(event.target.value)}
                          />{" "}
                          <button
                            className="adm-btn adm-btn-primary"
                            disabled={busy || renameName.trim() === "" || renameName.trim() === category.name}
                            onClick={() => {
                              void (async () => {
                                if (
                                  await act(`/api/admin/volunteer-categories/${category.id}/rename`, {
                                    name: renameName.trim(),
                                  })
                                ) {
                                  setRenameId(null);
                                }
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
                        category.name
                      )}
                    </td>
                    <td>
                      {category.interestCount} supporter{category.interestCount === 1 ? "" : "s"}
                    </td>
                    <td>{category.isActive ? "Active" : <strong>Inactive</strong>}</td>
                    <td>
                      {renameId !== category.id && (
                        <>
                          <button
                            className="adm-btn"
                            disabled={busy}
                            onClick={() => {
                              setRenameId(category.id);
                              setRenameName(category.name);
                              setResult(null);
                            }}
                          >
                            Rename
                          </button>{" "}
                          <button
                            className="adm-btn"
                            disabled={busy}
                            onClick={() =>
                              void act(
                                `/api/admin/volunteer-categories/${category.id}/${
                                  category.isActive ? "deactivate" : "reactivate"
                                }`,
                              )
                            }
                          >
                            {category.isActive ? "Deactivate" : "Reactivate"}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <section className="adm-category-add" aria-labelledby="add-category-heading">
        <h2 id="add-category-heading" className="adm-subheading">
          Add volunteer category
        </h2>
        <div className="adm-form-row">
          <label>
            Name
            <input
              value={addName}
              maxLength={120}
              disabled={busy}
              onChange={(event) => setAddName(event.target.value)}
            />
          </label>
          <button
            className="adm-btn adm-btn-primary"
            disabled={busy || addName.trim() === ""}
            onClick={() => {
              void (async () => {
                if (await act("/api/admin/volunteer-categories", { name: addName.trim() })) setAddName("");
              })();
            }}
          >
            Add
          </button>
        </div>
      </section>
    </div>
  );
}