/**
 * MP-12 — /dashboard/volunteer/:id/edit (docs/specs/MP-12.md).
 *
 * Three independently-submitted forms on one page, not one form (§1):
 * request info, the paginated roles list, and an inline add-role form.
 * Interested is display-only (D1); the status selector never offers
 * `active` (D2) and drops `pending` while the request has no roles (§7).
 * Lowering Quantity below the interested count blocks the save, naming the
 * role (§5 conflict 2). Label reads "Toggle status of this Volunteer
 * Request" — the live site's "Item Request" there is a copy-paste leftover
 * the rebuild corrects (§5). Pagination is real, against the actual role
 * count, not Wix's broken "1 / 1000" repeater default (§5). Add-form labels
 * ("Descripton *", "Number of Volunteers Needed *", no placeholder) follow
 * this surface's capture, not MP-11's.
 */
import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { DeadlineField, type DeadlineTypeValue } from "../../components/member/DeadlineField";

const REQUIRED_MSG = "This field is required";
const SAVE_FAILURE_MSG = "That didn't save. Please check the form and try again.";
const REQUEST_SAVED_MSG = "Your request has been updated.";
const ROLES_SAVED_MSG = "Your role edits have been saved.";
const ADD_SUCCESS_MSG = "Role added.";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending: "Pending",
  active: "Active",
  archived: "Archived",
};

/** D2: the complete set of member-initiated moves. */
const MEMBER_TARGETS: Record<string, string[]> = {
  draft: ["pending"],
  pending: [],
  active: ["archived"],
  archived: ["pending"],
};

/** Volunteer requests offer two deadline types (MP-10 §5), not items' three. */
const VOLUNTEER_DEADLINE_OPTIONS: ReadonlyArray<{ value: DeadlineTypeValue; label: string }> = [
  { value: "ongoing", label: "Ongoing" },
  { value: "date_specific", label: "Date Specific" },
];

type PayloadRole = {
  id: string;
  name: string;
  description: string | null;
  quantityNeeded: number;
  quantityInterested: number;
  quantityConfirmed: number;
  sortOrder: number;
};

type Payload = {
  request: {
    id: string;
    title: string;
    description: string | null;
    details: string | null;
    eventLocation: string | null;
    peopleHelped: number | null;
    deadlineType: string;
    deadlineDate: string | null;
    status: string;
  };
  contact: { firstName: string; lastName: string; email: string; phone: string | null } | null;
  roles: PayloadRole[];
};

type RowState = {
  id: string;
  name: string;
  description: string;
  quantityNeeded: string;
  quantityInterested: number;
  quantityConfirmed: string;
};

type RegionMessage = { kind: "success" | "error"; text: string } | null;

function toRow(role: PayloadRole): RowState {
  return {
    id: role.id,
    name: role.name,
    description: role.description ?? "",
    quantityNeeded: String(role.quantityNeeded),
    quantityInterested: role.quantityInterested,
    quantityConfirmed: String(role.quantityConfirmed),
  };
}

/** §5 conflict 2 — written fresh for this surface, mirrored on the server. */
function overInterestMessage(name: string, interested: number): string {
  return `"${name}" has ${interested} interested volunteers — Quantity can't go below ${interested}.`;
}

/** §14: remaining recomputes live and always equals needed minus interested, floored at zero. */
function remainingOf(row: RowState): number {
  const needed = /^\d+$/.test(row.quantityNeeded.trim()) ? Number(row.quantityNeeded.trim()) : 0;
  return Math.max(0, needed - row.quantityInterested);
}

/** Row-level checks mirrored on the server; enablement per §6. */
function rowProblem(row: RowState): string | null {
  if (row.name.trim() === "") return REQUIRED_MSG;
  const qn = row.quantityNeeded.trim();
  if (!/^\d+$/.test(qn) || Number(qn) < 1) return "Please enter a whole number greater than zero.";
  if (Number(qn) < row.quantityInterested) return overInterestMessage(row.name, row.quantityInterested);
  const qc = row.quantityConfirmed.trim();
  if (qc !== "" && (!/^\d+$/.test(qc) || Number(qc) < 0)) return "Please enter a whole number.";
  return null;
}

export function VolunteersEditPage() {
  const [, params] = useRoute("/dashboard/volunteer/:id/edit");
  const id = params?.id ?? "";

  const query = useQuery<Payload>({ queryKey: [`/api/dashboard/volunteers/${id}/edit`] });

  // Region A — request info.
  const [contactFirstName, setContactFirstName] = useState("");
  const [contactLastName, setContactLastName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [deadlineType, setDeadlineType] = useState<DeadlineTypeValue | "">("");
  const [deadlineDate, setDeadlineDate] = useState("");
  const [details, setDetails] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [peopleHelped, setPeopleHelped] = useState("");
  const [currentStatus, setCurrentStatus] = useState("");
  const [statusSel, setStatusSel] = useState("");
  const [errorsA, setErrorsA] = useState<Record<string, string>>({});
  const [savingA, setSavingA] = useState(false);
  const [msgA, setMsgA] = useState<RegionMessage>(null);

  // Region B — roles list (paginated, one role per page).
  const [rows, setRows] = useState<RowState[]>([]);
  const [page, setPage] = useState(0);
  const [savingB, setSavingB] = useState(false);
  const [msgB, setMsgB] = useState<RegionMessage>(null);

  // Region C — add role.
  const [addName, setAddName] = useState("");
  const [addDescription, setAddDescription] = useState("");
  const [addQuantity, setAddQuantity] = useState("");
  const [errorsC, setErrorsC] = useState<Record<string, string>>({});
  const [savingC, setSavingC] = useState(false);
  const [msgC, setMsgC] = useState<RegionMessage>(null);

  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (!seeded && query.data) {
      const { request, contact, roles } = query.data;
      setContactFirstName(contact?.firstName ?? "");
      setContactLastName(contact?.lastName ?? "");
      setContactEmail(contact?.email ?? "");
      setContactPhone(contact?.phone ?? "");
      setDeadlineType(request.deadlineType as DeadlineTypeValue);
      setDeadlineDate(request.deadlineDate ?? "");
      setDetails(request.details ?? "");
      setEventLocation(request.eventLocation ?? "");
      setTitle(request.title);
      setDescription(request.description ?? "");
      setPeopleHelped(request.peopleHelped === null ? "" : String(request.peopleHelped));
      setCurrentStatus(request.status);
      setStatusSel(request.status);
      setRows(roles.map(toRow));
      setSeeded(true);
    }
  }, [seeded, query.data]);

  if (query.isError) {
    const notFound = query.error instanceof Error && query.error.message.startsWith("404");
    return (
      <div className="mp12-page">
        <div className="mp11-band">
          <h1 className="mp11-band-title">EDIT VOLUNTEER REQUEST</h1>
        </div>
        <div className="mp9-body">
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

  // §7: pending is not offered while the request has no roles.
  const statusOptions = [
    currentStatus,
    ...(MEMBER_TARGETS[currentStatus] ?? []).filter((t) => t !== "pending" || rows.length > 0),
  ];

  const safePage = Math.min(page, Math.max(0, rows.length - 1));
  const activeRow = rows[safePage];

  function validateA(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (contactFirstName.trim() === "") errs.contactFirstName = REQUIRED_MSG;
    if (contactLastName.trim() === "") errs.contactLastName = REQUIRED_MSG;
    if (contactEmail.trim() === "") errs.contactEmail = REQUIRED_MSG;
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())) errs.contactEmail = "Please enter a valid email address.";
    if (contactPhone.trim() === "") errs.contactPhone = REQUIRED_MSG;
    if (deadlineType === "") errs.deadlineType = REQUIRED_MSG;
    if (deadlineType === "date_specific" && deadlineDate.trim() === "") errs.deadlineDate = REQUIRED_MSG;
    if (details.trim() === "") errs.details = REQUIRED_MSG;
    if (eventLocation.trim() === "") errs.eventLocation = REQUIRED_MSG;
    if (title.trim() === "") errs.title = REQUIRED_MSG;
    if (description.trim() === "") errs.description = REQUIRED_MSG;
    const ph = peopleHelped.trim();
    if (ph !== "" && !/^\d+$/.test(ph)) errs.peopleHelped = "Please enter a whole number.";
    return errs;
  }

  async function onSaveRequest(e: React.FormEvent) {
    e.preventDefault();
    const errs = validateA();
    setErrorsA(errs);
    setMsgA(null);
    if (Object.keys(errs).length > 0) return;
    setSavingA(true);
    try {
      const res = await fetch(`/api/dashboard/volunteers/${id}/edit/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactFirstName: contactFirstName.trim(),
          contactLastName: contactLastName.trim(),
          contactEmail: contactEmail.trim(),
          contactPhone: contactPhone.trim(),
          deadlineType,
          deadlineDate: deadlineType === "date_specific" ? deadlineDate.trim() : "",
          details: details.trim(),
          eventLocation: eventLocation.trim(),
          title: title.trim(),
          description: description.trim(),
          peopleHelped: peopleHelped.trim() === "" ? null : Number(peopleHelped.trim()),
          statusTo: statusSel !== currentStatus ? statusSel : null,
        }),
      });
      if (res.ok) {
        const body = (await res.json()) as { request: Payload["request"] };
        setCurrentStatus(body.request.status);
        setStatusSel(body.request.status);
        setMsgA({ kind: "success", text: REQUEST_SAVED_MSG });
      } else {
        setMsgA({ kind: "error", text: SAVE_FAILURE_MSG });
      }
    } catch {
      setMsgA({ kind: "error", text: SAVE_FAILURE_MSG });
    } finally {
      setSavingA(false);
    }
  }

  function setRow(rowId: string, patch: Partial<RowState>) {
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, ...patch } : r)));
  }

  const rolesValid = rows.length > 0 && rows.every((r) => rowProblem(r) === null);

  async function onSaveRoles() {
    setMsgB(null);
    if (!rolesValid) return;
    setSavingB(true);
    try {
      const res = await fetch(`/api/dashboard/volunteers/${id}/edit/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roles: rows.map((r) => ({
            id: r.id,
            name: r.name.trim(),
            description: r.description.trim(),
            quantityNeeded: Number(r.quantityNeeded.trim()),
            quantityConfirmed: r.quantityConfirmed.trim() === "" ? 0 : Number(r.quantityConfirmed.trim()),
          })),
        }),
      });
      if (res.ok) {
        const body = (await res.json()) as { roles: PayloadRole[] };
        setRows(body.roles.map(toRow));
        setMsgB({ kind: "success", text: ROLES_SAVED_MSG });
      } else {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setMsgB({ kind: "error", text: body?.message ?? SAVE_FAILURE_MSG });
      }
    } catch {
      setMsgB({ kind: "error", text: SAVE_FAILURE_MSG });
    } finally {
      setSavingB(false);
    }
  }

  function validateC(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (addName.trim() === "") errs.addName = REQUIRED_MSG;
    if (addDescription.trim() === "") errs.addDescription = REQUIRED_MSG;
    const q = addQuantity.trim();
    if (q === "") errs.addQuantity = REQUIRED_MSG;
    else if (!/^\d+$/.test(q) || Number(q) < 1) errs.addQuantity = "Please enter a whole number greater than zero.";
    return errs;
  }

  async function onAddRole(e: React.FormEvent) {
    e.preventDefault();
    const errs = validateC();
    setErrorsC(errs);
    setMsgC(null);
    if (Object.keys(errs).length > 0) return;
    setSavingC(true);
    try {
      const res = await fetch(`/api/dashboard/volunteers/${id}/edit/add-role`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: addName.trim(),
          description: addDescription.trim(),
          quantityNeeded: Number(addQuantity.trim()),
        }),
      });
      if (res.ok) {
        const body = (await res.json()) as { role: PayloadRole };
        setRows((prev) => [...prev, toRow(body.role)]);
        setAddName("");
        setAddDescription("");
        setAddQuantity("");
        setErrorsC({});
        setMsgC({ kind: "success", text: ADD_SUCCESS_MSG });
      } else {
        setMsgC({ kind: "error", text: SAVE_FAILURE_MSG });
      }
    } catch {
      setMsgC({ kind: "error", text: SAVE_FAILURE_MSG });
    } finally {
      setSavingC(false);
    }
  }

  const fieldErrorA = (key: string) => (errorsA[key] ? <p className="mp3-field-error">{errorsA[key]}</p> : null);
  const fieldErrorC = (key: string) => (errorsC[key] ? <p className="mp3-field-error">{errorsC[key]}</p> : null);

  const regionMessage = (msg: RegionMessage) =>
    msg ? (
      <p className={msg.kind === "success" ? "mp5-success" : "mp5-failure"} role={msg.kind === "error" ? "alert" : "status"}>
        {msg.text}
      </p>
    ) : null;

  const activeProblem = activeRow ? rowProblem(activeRow) : null;

  return (
    <div className="mp12-page">
      <div className="mp11-band">
        <h1 className="mp11-band-title">EDIT VOLUNTEER REQUEST</h1>
      </div>
      <div className="mp9-body">
        <Link href="/dashboard" className="mp5-back">
          &lt; Back
        </Link>
        <p className="mp6-copy">
          This page allows you to update the information about your volunteer request, change details or quantities
          about each role, and add new roles. Use each part of the form separately and click the submit button. Once
          you&apos;re done updating this request, use the back button (top left) to return to your Organization
          Dashboard.
        </p>

        <h2 className="mp9-section">EDIT REQUEST INFO</h2>
        <form className="mp9-form" onSubmit={onSaveRequest} noValidate>
          <label className="mp5-label" htmlFor="mp12-contact-first">
            Contact Full Name *
          </label>
          <div className="mp5-name-row">
            <div className="mp5-name-col">
              <input
                id="mp12-contact-first"
                className="pub-input mp5-input"
                type="text"
                value={contactFirstName}
                onChange={(e) => setContactFirstName(e.target.value)}
                aria-label="Contact first name"
              />
              {fieldErrorA("contactFirstName")}
            </div>
            <div className="mp5-name-col">
              <input
                className="pub-input mp5-input"
                type="text"
                value={contactLastName}
                onChange={(e) => setContactLastName(e.target.value)}
                aria-label="Contact last name"
              />
              {fieldErrorA("contactLastName")}
            </div>
          </div>

          <label className="mp5-label" htmlFor="mp12-contact-email">
            Contact Email Address *
          </label>
          <input
            id="mp12-contact-email"
            className="pub-input mp5-input"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
          {fieldErrorA("contactEmail")}

          <label className="mp5-label" htmlFor="mp12-contact-phone">
            Contact Phone Number *
          </label>
          <input
            id="mp12-contact-phone"
            className="pub-input mp5-input"
            type="text"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
          />
          {fieldErrorA("contactPhone")}

          <span className="mp5-label">Deadline Type *</span>
          <DeadlineField
            idPrefix="mp12"
            options={VOLUNTEER_DEADLINE_OPTIONS}
            value={deadlineType}
            onChange={setDeadlineType}
            date={deadlineDate}
            onDateChange={setDeadlineDate}
            typeError={errorsA.deadlineType}
            dateError={errorsA.deadlineDate}
            dateLabel="Deadline Date *"
          />

          <label className="mp5-label" htmlFor="mp12-details">
            Details: *
          </label>
          <input
            id="mp12-details"
            className="pub-input mp5-input"
            type="text"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
          />
          {fieldErrorA("details")}

          <label className="mp5-label" htmlFor="mp12-location">
            Volunteer Role Location *
          </label>
          <input
            id="mp12-location"
            className="pub-input mp5-input"
            type="text"
            value={eventLocation}
            onChange={(e) => setEventLocation(e.target.value)}
          />
          {fieldErrorA("eventLocation")}

          <label className="mp5-label" htmlFor="mp12-title">
            Request Title *
          </label>
          <input
            id="mp12-title"
            className="pub-input mp5-input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          {fieldErrorA("title")}

          <label className="mp5-label" htmlFor="mp12-description">
            Request Description *
          </label>
          <textarea
            id="mp12-description"
            className="pub-input mp5-input mp12-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {fieldErrorA("description")}

          <label className="mp5-label" htmlFor="mp12-people">
            How many kids and/or families will this help? *
          </label>
          <input
            id="mp12-people"
            className="pub-input mp5-input"
            type="number"
            min={0}
            step={1}
            value={peopleHelped}
            onChange={(e) => setPeopleHelped(e.target.value)}
          />
          {fieldErrorA("peopleHelped")}

          <label className="mp5-label" htmlFor="mp12-status">
            Toggle status of this Volunteer Request
          </label>
          <select
            id="mp12-status"
            className="pub-input mp5-input mp12-select"
            value={statusSel}
            onChange={(e) => setStatusSel(e.target.value)}
          >
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s] ?? s}
              </option>
            ))}
          </select>

          <div className="mp9-submit-row">
            <button type="submit" className="mp5-submit" disabled={savingA}>
              {savingA ? "Saving…" : "Submit Request Edits"}
            </button>
          </div>
          {regionMessage(msgA)}
        </form>

        <h2 className="mp9-section">EDIT ROLES</h2>
        {rows.length === 0 ? (
          <p className="mp9-empty">No roles added yet.</p>
        ) : (
          <>
            <div className="mp12-pager">
              <button
                type="button"
                className="mp12-pager-btn"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                aria-label="Previous role"
              >
                &lsaquo;
              </button>
              <span className="mp12-pager-count">
                {safePage + 1} / {rows.length}
              </span>
              <button
                type="button"
                className="mp12-pager-btn"
                onClick={() => setPage((p) => Math.min(rows.length - 1, p + 1))}
                disabled={safePage >= rows.length - 1}
                aria-label="Next role"
              >
                &rsaquo;
              </button>
            </div>
            {activeRow ? (
              <div className="mp12-role">
                <div className="mp12-cell mp12-cell-name">
                  <span className="mp9-item-label">Role Name *</span>
                  <input
                    className="pub-input mp5-input"
                    type="text"
                    value={activeRow.name}
                    onChange={(e) => setRow(activeRow.id, { name: e.target.value })}
                    aria-label="Role name"
                  />
                </div>
                <div className="mp12-cell mp12-cell-desc">
                  <span className="mp9-item-label">Role Description</span>
                  <textarea
                    className="pub-input mp5-input mp12-role-desc"
                    value={activeRow.description}
                    onChange={(e) => setRow(activeRow.id, { description: e.target.value })}
                    aria-label="Role description"
                  />
                </div>
                <div className="mp12-cell">
                  <span className="mp9-item-label">Quantity *</span>
                  <input
                    className="pub-input mp5-input"
                    type="number"
                    min={1}
                    step={1}
                    value={activeRow.quantityNeeded}
                    onChange={(e) => setRow(activeRow.id, { quantityNeeded: e.target.value })}
                    aria-label="Quantity needed"
                  />
                </div>
                <div className="mp12-cell">
                  <span className="mp9-item-label"># Confirmed</span>
                  <input
                    className="pub-input mp5-input"
                    type="number"
                    min={0}
                    step={1}
                    value={activeRow.quantityConfirmed}
                    onChange={(e) => setRow(activeRow.id, { quantityConfirmed: e.target.value })}
                    aria-label="Quantity confirmed"
                  />
                </div>
                <div className="mp12-cell">
                  <span className="mp9-item-label"># Interested</span>
                  <input
                    className="pub-input mp5-input mp9-readonly"
                    type="number"
                    value={activeRow.quantityInterested}
                    disabled
                    aria-label="Quantity interested"
                  />
                </div>
                <div className="mp12-cell">
                  <span className="mp9-item-label"># Remaining</span>
                  <input
                    className="pub-input mp5-input mp9-readonly"
                    type="number"
                    value={remainingOf(activeRow)}
                    disabled
                    aria-label="Quantity remaining"
                  />
                </div>
                {activeProblem ? <p className="mp3-field-error mp12-row-error">{activeProblem}</p> : null}
              </div>
            ) : null}
            <div className="mp9-submit-row">
              <button type="button" className="mp5-submit" disabled={!rolesValid || savingB} onClick={onSaveRoles}>
                {savingB ? "Saving…" : "Submit Role Edits"}
              </button>
            </div>
          </>
        )}
        {regionMessage(msgB)}

        <h2 className="mp9-section">ADD A NEW ROLE TO THIS REQUEST</h2>
        <form className="mp9-form" onSubmit={onAddRole} noValidate>
          <label className="mp5-label" htmlFor="mp12-add-name">
            Role Name *
          </label>
          <input
            id="mp12-add-name"
            className="pub-input mp5-input"
            type="text"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
          />
          {fieldErrorC("addName")}

          <label className="mp5-label" htmlFor="mp12-add-desc">
            Descripton *
          </label>
          <textarea
            id="mp12-add-desc"
            className="pub-input mp5-input mp12-textarea"
            value={addDescription}
            onChange={(e) => setAddDescription(e.target.value)}
          />
          {fieldErrorC("addDescription")}

          <label className="mp5-label" htmlFor="mp12-add-qty">
            Number of Volunteers Needed *
          </label>
          <input
            id="mp12-add-qty"
            className="pub-input mp5-input"
            type="number"
            min={1}
            step={1}
            value={addQuantity}
            onChange={(e) => setAddQuantity(e.target.value)}
          />
          {fieldErrorC("addQuantity")}

          <div className="mp9-submit-row">
            <button type="submit" className="mp5-submit" disabled={savingC}>
              {savingC ? "Adding…" : "Add This Role"}
            </button>
          </div>
          {regionMessage(msgC)}
        </form>
      </div>
    </div>
  );
}
