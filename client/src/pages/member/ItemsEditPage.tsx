/**
 * MP-09 — /dashboard/items/:id/edit (docs/specs/MP-09.md).
 *
 * Three independently-submitted forms on one page, not one form (§1):
 * request info, the items list, and an inline add-item form (the MP-08
 * component's field set, "Item Descripton" typo included). Claimed is
 * display-only (D1); the status selector never offers `active` (D2) and
 * drops `pending` while the request has no items (§7). Lowering # Requested
 * below the claimed count blocks the save, naming the item (§5 conflict 2).
 */
import { useEffect, useState } from "react";
import { Link, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { DeadlineField, type DeadlineTypeValue } from "../../components/member/DeadlineField";
import { productUrlProblem } from "@shared/item-product-url";

const REQUIRED_MSG = "This field is required";
const SAVE_FAILURE_MSG = "That didn't save. Please check the form and try again.";
const REQUEST_SAVED_MSG = "Your request has been updated.";
const ITEMS_SAVED_MSG = "Your item edits have been saved.";
const ADD_SUCCESS_MSG = "Item added.";

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

const CONDITION_OPTIONS = [
  { value: "new", label: "New" },
  { value: "gently_used", label: "Gently Used" },
  { value: "any", label: "Any" },
];

type PayloadItem = {
  id: string;
  name: string;
  description: string | null;
  productUrl: string | null;
  condition: string | null;
  quantityRequested: number;
  quantityClaimed: number;
  quantityReceived: number;
  sortOrder: number;
};

type Payload = {
  request: {
    id: string;
    title: string;
    description: string | null;
    dropoffLocation: string | null;
    peopleHelped: number | null;
    deadlineType: string;
    deadlineDate: string | null;
    status: string;
    imageUrl: string | null;
  };
  contact: { firstName: string; lastName: string; email: string; phone: string | null } | null;
  items: PayloadItem[];
};

type RowState = {
  id: string;
  name: string;
  description: string;
  productUrl: string;
  condition: string;
  quantityRequested: string;
  quantityClaimed: number;
  quantityReceived: string;
};

type RegionMessage = { kind: "success" | "error"; text: string } | null;

function toRow(item: PayloadItem): RowState {
  return {
    id: item.id,
    name: item.name,
    description: item.description ?? "",
    productUrl: item.productUrl ?? "",
    condition: item.condition ?? "",
    quantityRequested: String(item.quantityRequested),
    quantityClaimed: item.quantityClaimed,
    quantityReceived: String(item.quantityReceived),
  };
}

function overClaimMessage(name: string, claimed: number): string {
  return `"${name}" has ${claimed} claimed — # Requested can't go below ${claimed}.`;
}

/** Row-level checks mirrored on the server; enablement per §6. */
function rowProblem(row: RowState): string | null {
  if (row.name.trim() === "") return REQUIRED_MSG;
  const qr = row.quantityRequested.trim();
  if (!/^\d+$/.test(qr) || Number(qr) < 1) return "Please enter a whole number greater than zero.";
  if (Number(qr) < row.quantityClaimed) return overClaimMessage(row.name, row.quantityClaimed);
  const rec = row.quantityReceived.trim();
  if (rec !== "" && (!/^\d+$/.test(rec) || Number(rec) < 0)) return "Please enter a whole number.";
  const urlProblem = productUrlProblem(row.productUrl);
  if (urlProblem) return urlProblem;
  return null;
}

export function ItemsEditPage() {
  const [, params] = useRoute("/dashboard/items/:id/edit");
  const id = params?.id ?? "";

  const query = useQuery<Payload>({ queryKey: [`/api/dashboard/items/${id}/edit`] });

  // Region A — request info.
  const [contactFirstName, setContactFirstName] = useState("");
  const [contactLastName, setContactLastName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [deadlineType, setDeadlineType] = useState<DeadlineTypeValue | "">("");
  const [deadlineDate, setDeadlineDate] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dropoffLocation, setDropoffLocation] = useState("");
  const [peopleHelped, setPeopleHelped] = useState("");
  const [currentStatus, setCurrentStatus] = useState("");
  const [statusSel, setStatusSel] = useState("");
  const [errorsA, setErrorsA] = useState<Record<string, string>>({});
  const [savingA, setSavingA] = useState(false);
  const [msgA, setMsgA] = useState<RegionMessage>(null);

  // Region B — items list.
  const [rows, setRows] = useState<RowState[]>([]);
  const [savingB, setSavingB] = useState(false);
  const [msgB, setMsgB] = useState<RegionMessage>(null);

  // Region C — add item.
  const [addName, setAddName] = useState("");
  const [addDescription, setAddDescription] = useState("");
  const [addQuantity, setAddQuantity] = useState("");
  const [addCondition, setAddCondition] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [errorsC, setErrorsC] = useState<Record<string, string>>({});
  const [savingC, setSavingC] = useState(false);
  const [msgC, setMsgC] = useState<RegionMessage>(null);

  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (!seeded && query.data) {
      const { request, contact, items } = query.data;
      setContactFirstName(contact?.firstName ?? "");
      setContactLastName(contact?.lastName ?? "");
      setContactEmail(contact?.email ?? "");
      setContactPhone(contact?.phone ?? "");
      setDeadlineType(request.deadlineType as DeadlineTypeValue);
      setDeadlineDate(request.deadlineDate ?? "");
      setTitle(request.title);
      setDescription(request.description ?? "");
      setDropoffLocation(request.dropoffLocation ?? "");
      setPeopleHelped(request.peopleHelped === null ? "" : String(request.peopleHelped));
      setCurrentStatus(request.status);
      setStatusSel(request.status);
      setRows(items.map(toRow));
      setSeeded(true);
    }
  }, [seeded, query.data]);

  if (query.isError) {
    const notFound = query.error instanceof Error && query.error.message.startsWith("404");
    return (
      <div className="mp9-page">
        <div className="mp9-band">
          <h1 className="mp9-band-title">EDIT ITEM REQUEST</h1>
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

  // §7: pending is not offered while the request has no items.
  const statusOptions = [
    currentStatus,
    ...(MEMBER_TARGETS[currentStatus] ?? []).filter((t) => t !== "pending" || rows.length > 0),
  ];

  function validateA(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (contactFirstName.trim() === "") errs.contactFirstName = REQUIRED_MSG;
    if (contactLastName.trim() === "") errs.contactLastName = REQUIRED_MSG;
    if (contactEmail.trim() === "") errs.contactEmail = REQUIRED_MSG;
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())) errs.contactEmail = "Please enter a valid email address.";
    if (contactPhone.trim() === "") errs.contactPhone = REQUIRED_MSG;
    if (deadlineType === "") errs.deadlineType = REQUIRED_MSG;
    if (deadlineType === "date_specific" && deadlineDate.trim() === "") errs.deadlineDate = REQUIRED_MSG;
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
      const res = await fetch(`/api/dashboard/items/${id}/edit/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactFirstName: contactFirstName.trim(),
          contactLastName: contactLastName.trim(),
          contactEmail: contactEmail.trim(),
          contactPhone: contactPhone.trim(),
          deadlineType,
          deadlineDate: deadlineType === "date_specific" ? deadlineDate.trim() : "",
          title: title.trim(),
          description: description.trim(),
          dropoffLocation: dropoffLocation.trim(),
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

  const itemsValid = rows.length > 0 && rows.every((r) => rowProblem(r) === null);

  async function onSaveItems() {
    setMsgB(null);
    if (!itemsValid) return;
    setSavingB(true);
    try {
      const res = await fetch(`/api/dashboard/items/${id}/edit/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: rows.map((r) => ({
            id: r.id,
            name: r.name.trim(),
            description: r.description.trim(),
            productUrl: r.productUrl.trim(),
            condition: r.condition,
            quantityRequested: Number(r.quantityRequested.trim()),
            quantityReceived: r.quantityReceived.trim() === "" ? 0 : Number(r.quantityReceived.trim()),
          })),
        }),
      });
      if (res.ok) {
        const body = (await res.json()) as { items: PayloadItem[] };
        setRows(body.items.map(toRow));
        setMsgB({ kind: "success", text: ITEMS_SAVED_MSG });
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
    if (addCondition === "") errs.addCondition = REQUIRED_MSG;
    const urlProblem = productUrlProblem(addUrl);
    if (urlProblem) errs.addUrl = urlProblem;
    return errs;
  }

  async function onAddItem(e: React.FormEvent) {
    e.preventDefault();
    const errs = validateC();
    setErrorsC(errs);
    setMsgC(null);
    if (Object.keys(errs).length > 0) return;
    setSavingC(true);
    try {
      const res = await fetch(`/api/dashboard/items/${id}/edit/add-item`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: addName.trim(),
          description: addDescription.trim(),
          quantityRequested: Number(addQuantity.trim()),
          condition: addCondition,
          productUrl: addUrl.trim() === "" ? null : addUrl.trim(),
        }),
      });
      if (res.ok) {
        const body = (await res.json()) as { item: PayloadItem };
        setRows((prev) => [...prev, toRow(body.item)]);
        setAddName("");
        setAddDescription("");
        setAddQuantity("");
        setAddCondition("");
        setAddUrl("");
        setErrorsC({});
        setMsgC({ kind: "success", text: ADD_SUCCESS_MSG });
      } else {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setMsgC({ kind: "error", text: body?.message ?? SAVE_FAILURE_MSG });
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

  return (
    <div className="mp9-page">
      <div className="mp9-band">
        <h1 className="mp9-band-title">EDIT ITEM REQUEST</h1>
      </div>
      <div className="mp9-body">
        <Link href="/dashboard" className="mp5-back">
          &lt; Back
        </Link>
        <p className="mp6-copy">
          This page allows you to update the information about your item request, change details or quantities about
          each item, and add additional items. Use each part of the form separately and click the submit button. Once
          you&apos;re done updating this request, use the back button (top left) to return to your Organization
          Dashboard.
        </p>

        <h2 className="mp9-section">EDIT REQUEST INFO</h2>
        <form className="mp9-form" onSubmit={onSaveRequest} noValidate>
          <label className="mp5-label" htmlFor="mp9-contact-first">
            Contact Full Name *
          </label>
          <div className="mp5-name-row">
            <div className="mp5-name-col">
              <input
                id="mp9-contact-first"
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

          <label className="mp5-label" htmlFor="mp9-contact-email">
            Contact Email Address *
          </label>
          <input
            id="mp9-contact-email"
            className="pub-input mp5-input"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
          {fieldErrorA("contactEmail")}

          <label className="mp5-label" htmlFor="mp9-contact-phone">
            Contact Phone Number *
          </label>
          <input
            id="mp9-contact-phone"
            className="pub-input mp5-input"
            type="text"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
          />
          {fieldErrorA("contactPhone")}

          <span className="mp5-label">Deadline Type *</span>
          <DeadlineField
            idPrefix="mp9"
            value={deadlineType}
            onChange={setDeadlineType}
            date={deadlineDate}
            onDateChange={setDeadlineDate}
            typeError={errorsA.deadlineType}
            dateError={errorsA.deadlineDate}
            dateLabel="Deadline Date *"
          />

          <label className="mp5-label" htmlFor="mp9-title">
            Request Title *
          </label>
          <input
            id="mp9-title"
            className="pub-input mp5-input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          {fieldErrorA("title")}

          <label className="mp5-label" htmlFor="mp9-description">
            Request Description *
          </label>
          <textarea
            id="mp9-description"
            className="pub-input mp5-input mp9-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {fieldErrorA("description")}

          <label className="mp5-label" htmlFor="mp9-dropoff">
            Item Dropoff Location
          </label>
          <input
            id="mp9-dropoff"
            className="pub-input mp5-input"
            type="text"
            value={dropoffLocation}
            onChange={(e) => setDropoffLocation(e.target.value)}
          />

          <label className="mp5-label" htmlFor="mp9-people">
            How many kids and/or families will this help? *
          </label>
          <input
            id="mp9-people"
            className="pub-input mp5-input"
            type="number"
            min={0}
            step={1}
            value={peopleHelped}
            onChange={(e) => setPeopleHelped(e.target.value)}
          />
          {fieldErrorA("peopleHelped")}

          <label className="mp5-label" htmlFor="mp9-status">
            Toggle status of this Item Request
          </label>
          <select
            id="mp9-status"
            className="pub-input mp5-input mp9-select"
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

        <h2 className="mp9-section">EDIT ITEMS</h2>
        {rows.length === 0 ? (
          <p className="mp9-empty">No items added yet.</p>
        ) : (
          <div className="mp9-items">
            {rows.map((row) => {
              const problem = rowProblem(row);
              return (
                <div key={row.id} className="mp9-item">
                  <div className="mp9-cell mp9-cell-name">
                    <span className="mp9-item-label">Name *</span>
                    <input
                      className="pub-input mp5-input"
                      type="text"
                      value={row.name}
                      onChange={(e) => setRow(row.id, { name: e.target.value })}
                      aria-label={`Item name`}
                    />
                  </div>
                  <div className="mp9-cell mp9-cell-req">
                    <span className="mp9-item-label"># Requested *</span>
                    <input
                      className="pub-input mp5-input"
                      type="number"
                      min={1}
                      step={1}
                      value={row.quantityRequested}
                      onChange={(e) => setRow(row.id, { quantityRequested: e.target.value })}
                      aria-label={`Quantity requested`}
                    />
                  </div>
                  <div className="mp9-cell mp9-cell-claimed">
                    <span className="mp9-item-label"># Claimed</span>
                    <input
                      className="pub-input mp5-input mp9-readonly"
                      type="number"
                      value={row.quantityClaimed}
                      disabled
                      aria-label={`Quantity claimed`}
                    />
                  </div>
                  <div className="mp9-cell mp9-cell-desc">
                    <span className="mp9-item-label">Description</span>
                    <textarea
                      className="pub-input mp5-input mp9-item-desc"
                      value={row.description}
                      onChange={(e) => setRow(row.id, { description: e.target.value })}
                      aria-label={`Item description`}
                    />
                  </div>
                  <div className="mp9-cell mp9-cell-url">
                    <span className="mp9-item-label">URL</span>
                    <input
                      className="pub-input mp5-input"
                      type="text"
                      value={row.productUrl}
                      onChange={(e) => setRow(row.id, { productUrl: e.target.value })}
                      aria-label={`Item URL`}
                    />
                  </div>
                  <div className="mp9-cell mp9-cell-cond">
                    <span className="mp9-item-label">Condition</span>
                    <select
                      className="pub-input mp5-input mp9-select"
                      value={row.condition}
                      onChange={(e) => setRow(row.id, { condition: e.target.value })}
                      aria-label={`Item condition`}
                    >
                      <option value="" hidden></option>
                      {CONDITION_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="mp9-cell mp9-cell-rec">
                    <span className="mp9-item-label"># Received</span>
                    <input
                      className="pub-input mp5-input"
                      type="number"
                      min={0}
                      step={1}
                      value={row.quantityReceived}
                      onChange={(e) => setRow(row.id, { quantityReceived: e.target.value })}
                      aria-label={`Quantity received`}
                    />
                  </div>
                  {problem ? <p className="mp3-field-error mp9-row-error">{problem}</p> : null}
                </div>
              );
            })}
          </div>
        )}
        {rows.length > 0 ? (
          <div className="mp9-submit-row">
            <button type="button" className="mp5-submit" disabled={!itemsValid || savingB} onClick={onSaveItems}>
              {savingB ? "Saving…" : "Submit Item Edits"}
            </button>
          </div>
        ) : null}
        {regionMessage(msgB)}

        <h2 className="mp9-section">ADD ITEMS TO THIS REQUEST</h2>
        <form className="mp9-form" onSubmit={onAddItem} noValidate>
          <label className="mp5-label" htmlFor="mp9-add-name">
            Item Name *
          </label>
          <input
            id="mp9-add-name"
            className="pub-input mp5-input"
            type="text"
            placeholder="Ex: Twin Bed, Size 2 Diapers, Double Stroller, Teen Bike, etc."
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
          />
          {fieldErrorC("addName")}

          <label className="mp5-label" htmlFor="mp9-add-desc">
            Item Descripton *
          </label>
          <textarea
            id="mp9-add-desc"
            className="pub-input mp5-input mp9-textarea"
            value={addDescription}
            onChange={(e) => setAddDescription(e.target.value)}
          />
          {fieldErrorC("addDescription")}

          <label className="mp5-label" htmlFor="mp9-add-qty">
            Number of This Item Needed *
          </label>
          <input
            id="mp9-add-qty"
            className="pub-input mp5-input"
            type="number"
            min={1}
            step={1}
            value={addQuantity}
            onChange={(e) => setAddQuantity(e.target.value)}
          />
          {fieldErrorC("addQuantity")}

          <label className="mp5-label" htmlFor="mp9-add-condition">
            Item Condition *
          </label>
          <select
            id="mp9-add-condition"
            className="pub-input mp5-input mp9-select"
            value={addCondition}
            onChange={(e) => setAddCondition(e.target.value)}
          >
            <option value="" hidden></option>
            {CONDITION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {fieldErrorC("addCondition")}

          <label className="mp5-label" htmlFor="mp9-add-url">
            Website URL if a Specific Item is Needed
          </label>
          <input
            id="mp9-add-url"
            className="pub-input mp5-input"
            type="text"
            value={addUrl}
            onChange={(e) => setAddUrl(e.target.value)}
          />
          {fieldErrorC("addUrl")}

          <div className="mp9-submit-row">
            <button type="submit" className="mp5-submit" disabled={savingC}>
              {savingC ? "Adding…" : "Add This Item"}
            </button>
          </div>
          {regionMessage(msgC)}
        </form>
      </div>
    </div>
  );
}
