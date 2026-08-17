/**
 * MP-07 — /dashboard/items/new. Item request, step one (docs/specs/MP-07.md).
 *
 * Creates the request at draft and hands off to MP-08 to add items — this
 * surface never completes anything (§1). Contact name is two fields per D41
 * even though the live site combined them. Organization is display only;
 * the server takes org_id from the session alone (§11). Instructional copy
 * is captured verbatim, run-on grammar included (§8).
 */
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import heroImg from "../../assets/requests/item-hero.png";
import { DeadlineField, type DeadlineTypeValue } from "../../components/member/DeadlineField";

const REQUIRED_MSG = "This field is required";
const FAILURE_MSG = "Something went wrong and your request wasn't saved. Please try again.";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Overview = { org: { name: string } };

export function ItemsNewPage() {
  const [, navigate] = useLocation();
  const overviewQuery = useQuery<Overview>({ queryKey: ["/api/dashboard/overview"] });
  const orgName = overviewQuery.data?.org.name ?? "";

  const [contactFirstName, setContactFirstName] = useState("");
  const [contactLastName, setContactLastName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [deadlineType, setDeadlineType] = useState<DeadlineTypeValue | "">("");
  const [deadlineDate, setDeadlineDate] = useState("");
  const [peopleHelped, setPeopleHelped] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (contactFirstName.trim() === "") errs.contactFirstName = REQUIRED_MSG;
    if (contactLastName.trim() === "") errs.contactLastName = REQUIRED_MSG;
    if (contactEmail.trim() === "") errs.contactEmail = REQUIRED_MSG;
    else if (!EMAIL_RE.test(contactEmail.trim())) errs.contactEmail = "Please enter a valid email.";
    if (contactPhone.trim() === "") errs.contactPhone = REQUIRED_MSG;
    if (deadlineType === "") errs.deadlineType = REQUIRED_MSG;
    if (deadlineType === "date_specific" && deadlineDate.trim() === "") errs.deadlineDate = REQUIRED_MSG;
    const ph = peopleHelped.trim();
    if (ph === "") errs.peopleHelped = REQUIRED_MSG;
    else if (!/^\d+$/.test(ph)) errs.peopleHelped = "Please enter a whole number of zero or more.";
    if (title.trim() === "") errs.title = REQUIRED_MSG;
    if (description.trim() === "") errs.description = REQUIRED_MSG;
    return errs;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    setErrors(errs);
    setFailure(null);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/dashboard/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactFirstName: contactFirstName.trim(),
          contactLastName: contactLastName.trim(),
          contactEmail: contactEmail.trim(),
          contactPhone: contactPhone.trim(),
          deadlineType,
          deadlineDate: deadlineType === "date_specific" ? deadlineDate.trim() : null,
          peopleHelped: Number(peopleHelped.trim()),
          title: title.trim(),
          description: description.trim(),
        }),
      });
      if (res.ok) {
        const body = (await res.json()) as { id: string };
        navigate(`/dashboard/items/${body.id}/add`);
        return;
      }
      setFailure(FAILURE_MSG);
    } catch {
      setFailure(FAILURE_MSG);
    } finally {
      setSubmitting(false);
    }
  }

  const fieldError = (key: string) => (errors[key] ? <p className="mp3-field-error">{errors[key]}</p> : null);

  return (
    <div className="mp7-page">
      <img className="mp6-hero" src={heroImg} alt="Item Request" />
      <div className="mp7-band">
        <h1 className="mp7-band-title">POST A DONATION NEED</h1>
      </div>
      <div className="mp7-body">
        <Link href="/dashboard" className="mp5-back">
          &lt; Back
        </Link>
        <p className="mp6-copy">
          Please complete the form below to create a new item donation request. On this page you will provide the
          details about the child, teen, parent or caregiver this request will benefit them you will be able to add
          items to the request on the following page.
        </p>
        <p className="mp6-copy">
          Make your request compelling by keeping the post title and description brief but including as much personal
          information as you can to inspire people to meet this need.
        </p>

        <form className="mp7-form" onSubmit={onSubmit} noValidate>
          <label className="mp5-label" htmlFor="mp7-org">
            Organization *
          </label>
          <input id="mp7-org" className="pub-input mp5-input mp6-readonly" type="text" value={orgName} disabled />

          <label className="mp5-label" htmlFor="mp7-contact-first">
            Contact Full Name *
          </label>
          <div className="mp5-name-row">
            <div className="mp5-name-col">
              <input
                id="mp7-contact-first"
                className="pub-input mp5-input"
                type="text"
                value={contactFirstName}
                onChange={(e) => setContactFirstName(e.target.value)}
                aria-label="Contact first name"
              />
              {fieldError("contactFirstName")}
            </div>
            <div className="mp5-name-col">
              <input
                className="pub-input mp5-input"
                type="text"
                value={contactLastName}
                onChange={(e) => setContactLastName(e.target.value)}
                aria-label="Contact last name"
              />
              {fieldError("contactLastName")}
            </div>
          </div>

          <label className="mp5-label" htmlFor="mp7-contact-email">
            Contact Email Address *
          </label>
          <input
            id="mp7-contact-email"
            className="pub-input mp5-input"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
          {fieldError("contactEmail")}

          <label className="mp5-label" htmlFor="mp7-contact-phone">
            Contact Phone Number *
          </label>
          <input
            id="mp7-contact-phone"
            className="pub-input mp5-input"
            type="text"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
          />
          {fieldError("contactPhone")}

          <span className="mp5-label">Deadline Type *</span>
          <DeadlineField
            idPrefix="mp7"
            value={deadlineType}
            onChange={setDeadlineType}
            date={deadlineDate}
            onDateChange={setDeadlineDate}
            typeError={errors.deadlineType}
            dateError={errors.deadlineDate}
          />

          <label className="mp5-label" htmlFor="mp7-people">
            How many kids and/or families will this help? *
          </label>
          <input
            id="mp7-people"
            className="pub-input mp5-input"
            type="number"
            min={0}
            step={1}
            value={peopleHelped}
            onChange={(e) => setPeopleHelped(e.target.value)}
          />
          {fieldError("peopleHelped")}

          <label className="mp5-label" htmlFor="mp7-title">
            Request Title *
          </label>
          <input
            id="mp7-title"
            className="pub-input mp5-input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          {fieldError("title")}
          <ul className="mp7-helper">
            <li>
              In 5-10 words please let people know what is needed and who this will serve.
              <ul>
                <li>
                  Examples: Single Dad in Need of a Stroller | Bike Needed for Refugee Teen | Diapers for a Child
                  Receiving Cancer Treatment
                </li>
              </ul>
            </li>
          </ul>

          <label className="mp5-label" htmlFor="mp7-description">
            Request Description *
          </label>
          <textarea
            id="mp7-description"
            className="pub-input mp5-input mp7-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {fieldError("description")}
          <ul className="mp7-helper">
            <li>
              In 2-4 sentences please give people more details about the youth or family in need and the impact that
              receiving these items will have.
              <ul>
                <li>
                  Examples: Single dad who just found stable housing for himself and his baby is in need of a stroller
                  to be able to transport his child. Dad has back problems so providing the stroller would help meet
                  many needs.
                </li>
              </ul>
            </li>
          </ul>

          {failure ? (
            <p className="mp5-failure" role="alert">
              {failure}
            </p>
          ) : null}

          <button type="submit" className="mp5-submit" disabled={submitting}>
            {submitting ? "Saving…" : "Continue to Add Items"}
          </button>
        </form>
      </div>
    </div>
  );
}
