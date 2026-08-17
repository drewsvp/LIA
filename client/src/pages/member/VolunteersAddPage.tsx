/**
 * MP-11 — /dashboard/volunteer/:id/add (docs/specs/MP-11.md).
 *
 * Second step of a volunteer request: add roles one at a time, then submit
 * for approval. Parallel to MP-08. Submit is disabled until the first role
 * exists (§7); a request no longer at draft loads read-only with the form
 * and submit absent (§11). "Role Descripton" typo is capture-verbatim (§5).
 * The summary region mirrors MP-08's — the capture shows none, but §4
 * confirms it; deadline renders only for date_specific (§7).
 */
import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";

const REQUIRED_MSG = "This field is required";
const ADD_FAILURE_MSG = "That didn't save. Please check the form and try again.";
const SUBMIT_FAILURE_MSG = "Something went wrong and your request wasn't saved. Please try again.";

type RoleRow = {
  id: string;
  name: string;
  description: string | null;
  quantityNeeded: number;
  sortOrder: number;
};

type Payload = {
  request: {
    id: string;
    title: string;
    description: string | null;
    details: string | null;
    eventLocation: string | null;
    imageUrl: string | null;
    deadlineType: string;
    deadlineDate: string | null;
    status: string;
  };
  roles: RoleRow[];
};

function formatDeadline(iso: string): string {
  const [y = 1970, m = 1, d = 1] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export function VolunteersAddPage() {
  const params = useParams<{ id: string }>();
  const id = params.id ?? "";
  const [, navigate] = useLocation();
  const query = useQuery<Payload>({ queryKey: [`/api/dashboard/volunteers/${id}`] });

  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (!seeded && query.data) {
      setRoles(query.data.roles);
      setSeeded(true);
    }
  }, [seeded, query.data]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  if (query.isError) {
    const notFound = query.error instanceof Error && query.error.message.startsWith("404");
    return (
      <div className="mp11-page">
        <div className="mp11-band">
          <h1 className="mp11-band-title">ADD VOLUNTEER ROLES</h1>
        </div>
        <div className="mp8-body">
          <Link href="/dashboard" className="mp5-back">
            &lt; Back
          </Link>
          <p className="mp6-copy">
            {notFound ? "Not found." : "Something went wrong loading this request. Please refresh the page and try again."}
          </p>
        </div>
      </div>
    );
  }
  if (query.data === undefined) return null;

  const request = query.data.request;
  const isDraft = request.status === "draft";

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (name.trim() === "") errs.name = REQUIRED_MSG;
    if (description.trim() === "") errs.description = REQUIRED_MSG;
    const qty = quantity.trim();
    if (qty === "") errs.quantity = REQUIRED_MSG;
    else if (!/^\d+$/.test(qty) || Number(qty) <= 0) errs.quantity = "Please enter a whole number greater than zero.";
    setErrors(errs);
    setMessage(null);
    if (Object.keys(errs).length > 0) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/dashboard/volunteers/${id}/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          quantityNeeded: Number(qty),
        }),
      });
      if (res.ok) {
        const body = (await res.json()) as { role: RoleRow };
        setRoles((prev) => [...prev, body.role]);
        setName("");
        setDescription("");
        setQuantity("");
        setMessage({ kind: "success", text: "Role added." });
      } else {
        setMessage({ kind: "error", text: ADD_FAILURE_MSG });
      }
    } catch {
      setMessage({ kind: "error", text: ADD_FAILURE_MSG });
    } finally {
      setAdding(false);
    }
  }

  async function onSubmitRequest() {
    setMessage(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/dashboard/volunteers/${id}/submit`, { method: "POST" });
      if (res.ok) {
        navigate("/dashboard");
      } else {
        setMessage({ kind: "error", text: SUBMIT_FAILURE_MSG });
      }
    } catch {
      setMessage({ kind: "error", text: SUBMIT_FAILURE_MSG });
    } finally {
      setSubmitting(false);
    }
  }

  const fieldError = (key: string) => (errors[key] ? <p className="mp3-field-error">{errors[key]}</p> : null);

  return (
    <div className="mp11-page">
      <div className="mp11-band">
        <h1 className="mp11-band-title">ADD VOLUNTEER ROLES</h1>
      </div>
      <div className="mp8-body">
        <Link href="/dashboard" className="mp5-back">
          &lt; Back
        </Link>

        <div className="mp8-summary">
          <h2 className="mp8-summary-title">{request.title}</h2>
          {request.description ? <p className="mp8-summary-desc">{request.description}</p> : null}
          {request.details ? <p className="mp8-summary-desc">{request.details}</p> : null}
          {request.eventLocation ? <p className="mp8-summary-desc">{request.eventLocation}</p> : null}
          {request.deadlineType === "date_specific" && request.deadlineDate ? (
            <p className="mp8-summary-deadline">Deadline: {formatDeadline(request.deadlineDate)}</p>
          ) : null}
          {request.imageUrl ? <img className="mp8-summary-img" src={request.imageUrl} alt={request.title} /> : null}
        </div>

        {isDraft ? (
          <>
            <h2 className="mp8-section">ADD A ROLE</h2>
            <p className="mp11-copy">
              Please add each role individually then click the <strong>Add Role</strong> button.
              <br />
              Repeat as needed then click the <strong>Submit for Approval</strong> button when you&apos;re all done.
            </p>
            <form className="mp8-form" onSubmit={onAdd} noValidate>
              <label className="mp5-label" htmlFor="mp11-name">
                Role Name *
              </label>
              <input
                id="mp11-name"
                className="pub-input mp5-input"
                type="text"
                placeholder="Ex: Mentor, Soccer Coach, Event Set-Up Crew, Child Care Team, etc."
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {fieldError("name")}

              <label className="mp5-label" htmlFor="mp11-description">
                Role Descripton *
              </label>
              <textarea
                id="mp11-description"
                className="pub-input mp5-input mp11-textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              {fieldError("description")}

              <label className="mp5-label" htmlFor="mp11-quantity">
                Number of Volunteers Needed for this Role *
              </label>
              <input
                id="mp11-quantity"
                className="pub-input mp5-input"
                type="number"
                min={1}
                step={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
              {fieldError("quantity")}

              {message ? (
                <p className={message.kind === "success" ? "mp11-success" : "mp5-failure"} role="alert">
                  {message.text}
                </p>
              ) : null}

              <div className="mp8-buttons">
                <button type="submit" className="mp5-submit" disabled={adding}>
                  {adding ? "Saving…" : "Add Role"}
                </button>
                <button
                  type="button"
                  className="mp8-finish-btn"
                  disabled={roles.length === 0 || submitting}
                  onClick={onSubmitRequest}
                >
                  {submitting ? "Submitting…" : "Submit for Approval"}
                </button>
              </div>
            </form>
          </>
        ) : null}

        <h2 className="mp8-section">ROLES</h2>
        <table className="mp8-table">
          <thead>
            <tr>
              <th>Role Name</th>
              <th>Role Description</th>
              <th>Quantity</th>
            </tr>
          </thead>
          <tbody>
            {roles.length === 0 ? (
              <tr>
                <td colSpan={3} className="mp8-empty">
                  No roles added yet.
                </td>
              </tr>
            ) : (
              roles.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.description}</td>
                  <td>{r.quantityNeeded}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
