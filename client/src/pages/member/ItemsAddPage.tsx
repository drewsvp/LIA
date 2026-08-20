/**
 * MP-08 — /dashboard/items/:id/add. Add items, then submit (docs/specs/MP-08.md).
 *
 * Finish & Submit is disabled until the first item lands (§7) and the server
 * enforces the same gate. A foreign or missing :id gets the API's
 * byte-identical 404, rendered here as a plain not-found view. A request no
 * longer at draft loads read-only with the form and submit absent (§11).
 *
 * The instructional copy names buttons ("Add Another Item", "Submit for
 * Approval") that don't match the real labels ("Add Item", "Finish &
 * Submit") — a live-site inconsistency preserved verbatim (§8).
 */
import { useEffect, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { productUrlProblem } from "@shared/item-product-url";

const REQUIRED_MSG = "This field is required";
const ADD_SUCCESS_MSG = "Item added.";
const ADD_FAILURE_MSG = "That didn't save. Please check the form and try again.";
const SUBMIT_FAILURE_MSG = "Something went wrong and your request wasn't saved. Please try again.";

const CONDITION_LABELS: Record<string, string> = {
  new: "New",
  gently_used: "Gently Used",
  any: "Any",
};

type RequestItem = {
  id: string;
  name: string;
  description: string | null;
  productUrl: string | null;
  quantityRequested: number;
  quantityClaimed: number;
  condition: string | null;
  sortOrder: number;
};

type Payload = {
  request: {
    id: string;
    title: string;
    description: string | null;
    imageUrl: string | null;
    deadlineType: string;
    deadlineDate: string | null;
    status: string;
  };
  items: RequestItem[];
};

function formatDeadline(iso: string): string {
  const parts = iso.split("-").map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  return new Date(y, m - 1, d).toLocaleDateString("en-US");
}

export function ItemsAddPage() {
  const [, params] = useRoute("/dashboard/items/:id/add");
  const [, navigate] = useLocation();
  const id = params?.id ?? "";

  const query = useQuery<Payload>({ queryKey: [`/api/dashboard/items/${id}`] });

  const [items, setItems] = useState<RequestItem[]>([]);
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (!seeded && query.data) {
      setItems(query.data.items);
      setSeeded(true);
    }
  }, [seeded, query.data]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("");
  const [condition, setCondition] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  if (query.isError) {
    const notFound = query.error instanceof Error && query.error.message.startsWith("404");
    return (
      <div className="mp8-page">
        <div className="mp8-band">
          <h1 className="mp8-band-title">ADD ITEMS TO REQUEST</h1>
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

  const request = query.data?.request ?? null;
  const isDraft = request?.status === "draft";

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (name.trim() === "") errs.name = REQUIRED_MSG;
    if (description.trim() === "") errs.description = REQUIRED_MSG;
    const q = quantity.trim();
    if (q === "") errs.quantity = REQUIRED_MSG;
    else if (!/^\d+$/.test(q) || Number(q) < 1) errs.quantity = "Please enter a whole number greater than zero.";
    if (condition === "") errs.condition = REQUIRED_MSG;
    const urlProblem = productUrlProblem(productUrl);
    if (urlProblem) errs.productUrl = urlProblem;
    return errs;
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    setMessage(null);
    if (Object.keys(errs).length > 0) return;

    setAdding(true);
    try {
      const res = await fetch(`/api/dashboard/items/${id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          quantityRequested: Number(quantity.trim()),
          condition,
          productUrl: productUrl.trim() === "" ? null : productUrl.trim(),
        }),
      });
      if (res.ok) {
        const body = (await res.json()) as { item: RequestItem };
        setItems((prev) => [...prev, body.item]);
        setName("");
        setDescription("");
        setQuantity("");
        setCondition("");
        setProductUrl("");
        setErrors({});
        setMessage({ kind: "success", text: ADD_SUCCESS_MSG });
      } else {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setMessage({ kind: "error", text: body?.message ?? ADD_FAILURE_MSG });
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
      const res = await fetch(`/api/dashboard/items/${id}/submit`, { method: "POST" });
      if (res.ok) {
        navigate("/dashboard");
        return;
      }
      setMessage({ kind: "error", text: SUBMIT_FAILURE_MSG });
    } catch {
      setMessage({ kind: "error", text: SUBMIT_FAILURE_MSG });
    } finally {
      setSubmitting(false);
    }
  }

  const fieldError = (key: string) => (errors[key] ? <p className="mp3-field-error">{errors[key]}</p> : null);

  return (
    <div className="mp8-page">
      <div className="mp8-band">
        <h1 className="mp8-band-title">ADD ITEMS TO REQUEST</h1>
      </div>
      <div className="mp8-body">
        <Link href="/dashboard" className="mp5-back">
          &lt; Back
        </Link>

        {request ? (
          <div className="mp8-summary">
            <h2 className="mp8-summary-title">{request.title}</h2>
            {request.description ? <p className="mp8-summary-desc">{request.description}</p> : null}
            {request.deadlineType === "date_specific" && request.deadlineDate ? (
              <p className="mp8-summary-deadline">Deadline: {formatDeadline(request.deadlineDate)}</p>
            ) : null}
            {request.imageUrl ? <img className="mp8-summary-img" src={request.imageUrl} alt={request.title} /> : null}
          </div>
        ) : null}

        {isDraft ? (
          <>
            <h2 className="mp8-section">ADD AN ITEM</h2>
            <p className="mp6-copy">
              Please add each item (or group of the same items) individually then click the{" "}
              <strong>Add Another Item</strong> button. Repeat as needed then click the{" "}
              <strong>Submit for Approval</strong> button when you&apos;re all done.
            </p>

            <form className="mp8-form" onSubmit={onAdd} noValidate>
              <label className="mp5-label" htmlFor="mp8-name">
                Item Name *
              </label>
              <input
                id="mp8-name"
                className="pub-input mp5-input"
                type="text"
                placeholder="Ex: Twin Bed, Size 2 Diapers, Double Stroller, Teen Bike, etc."
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {fieldError("name")}

              <label className="mp5-label" htmlFor="mp8-desc">
                Item Descripton *
              </label>
              <textarea
                id="mp8-desc"
                className="pub-input mp5-input mp8-textarea"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
              {fieldError("description")}

              <label className="mp5-label" htmlFor="mp8-qty">
                Number of This Item Needed *
              </label>
              <input
                id="mp8-qty"
                className="pub-input mp5-input"
                type="number"
                min={1}
                step={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
              {fieldError("quantity")}

              <label className="mp5-label" htmlFor="mp8-condition">
                Item Condition *
              </label>
              <select
                id="mp8-condition"
                className="pub-input mp5-input mp8-select"
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
              >
                <option value="" hidden></option>
                <option value="new">New</option>
                <option value="gently_used">Gently Used</option>
                <option value="any">Any</option>
              </select>
              {fieldError("condition")}

              <label className="mp5-label" htmlFor="mp8-url">
                Website URL if a Specific Item is Needed
              </label>
              <input
                id="mp8-url"
                className="pub-input mp5-input"
                type="text"
                value={productUrl}
                onChange={(e) => setProductUrl(e.target.value)}
              />
              {fieldError("productUrl")}

              <div className="mp8-buttons">
                <button type="submit" className="mp5-submit mp8-add-btn" disabled={adding}>
                  {adding ? "Adding…" : "Add Item"}
                </button>
                <button
                  type="button"
                  className="mp8-finish-btn"
                  disabled={items.length === 0 || submitting}
                  onClick={onSubmitRequest}
                >
                  {submitting ? "Submitting…" : "Finish & Submit"}
                </button>
              </div>

              {message ? (
                <p
                  className={message.kind === "success" ? "mp5-success" : "mp5-failure"}
                  role={message.kind === "error" ? "alert" : "status"}
                >
                  {message.text}
                </p>
              ) : null}
            </form>
          </>
        ) : null}

        <h2 className="mp8-section">ITEMS IN THIS REQUEST</h2>
        <table className="mp8-table">
          <thead>
            <tr>
              <th>Item Name</th>
              <th>Item Description</th>
              <th>Quantity</th>
              <th>Claimed Quantity</th>
              <th>Item Condition</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className="mp8-empty">
                  No items added yet.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{item.description}</td>
                  <td>{item.quantityRequested}</td>
                  <td>{item.quantityClaimed}</td>
                  <td>{item.condition ? (CONDITION_LABELS[item.condition] ?? item.condition) : ""}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
