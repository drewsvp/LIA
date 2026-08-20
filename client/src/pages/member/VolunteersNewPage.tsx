/**
 * MP-10 — /dashboard/volunteer/new (docs/specs/MP-10.md).
 *
 * First step of a volunteer request: describe the opportunity, then MP-11
 * adds the roles. Draft only; no approval_events row and no email here (§3).
 * Two deadline options (Ongoing, Date Specific) plus the deviation-one date
 * picker. Field labels and helper copy are transcribed from the captures
 * verbatim — including "take place a your location" (§5) and the run-on
 * first paragraph (§8). This surface never completes anything (§1).
 */
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import heroImg from "../../assets/requests/volunteer-hero.png";
import { DeadlineField, type DeadlineTypeValue } from "../../components/member/DeadlineField";

const REQUIRED_MSG = "This field is required";
const FAILURE_MSG = "Something went wrong and your request wasn't saved. Please try again.";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const VOLUNTEER_DEADLINE_OPTIONS: ReadonlyArray<{ value: DeadlineTypeValue; label: string }> = [
  { value: "ongoing", label: "Ongoing" },
  { value: "date_specific", label: "Date Specific" },
];

type Overview = { org: { name: string } };
type VolunteerCategory = { id: string; name: string; isActive: boolean };

export function VolunteersNewPage() {
  const [, navigate] = useLocation();
  const overviewQuery = useQuery<Overview>({ queryKey: ["/api/dashboard/overview"] });
  const categoriesQuery = useQuery<{ categories: VolunteerCategory[] }>({
    queryKey: ["/api/dashboard/volunteer-categories"],
  });
  const orgName = overviewQuery.data?.org.name ?? "";
  const categories = categoriesQuery.data?.categories ?? [];

  const [contactFirstName, setContactFirstName] = useState("");
  const [contactLastName, setContactLastName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [deadlineType, setDeadlineType] = useState<DeadlineTypeValue | "">("");
  const [deadlineDate, setDeadlineDate] = useState("");
  const [details, setDetails] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [eventLocation, setEventLocation] = useState("");
  const [peopleHelped, setPeopleHelped] = useState("");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
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
    if (details.trim() === "") errs.details = REQUIRED_MSG;
    if (title.trim() === "") errs.title = REQUIRED_MSG;
    if (description.trim() === "") errs.description = REQUIRED_MSG;
    if (eventLocation.trim() === "") errs.eventLocation = REQUIRED_MSG;
    if (categoryIds.length === 0) errs.categoryIds = "Select at least one volunteer category.";
    const ph = peopleHelped.trim();
    if (ph === "") errs.peopleHelped = REQUIRED_MSG;
    else if (!/^\d+$/.test(ph)) errs.peopleHelped = "Please enter a whole number of zero or more.";
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
      const res = await fetch("/api/dashboard/volunteers", {
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
          title: title.trim(),
          description: description.trim(),
          eventLocation: eventLocation.trim(),
          peopleHelped: Number(peopleHelped.trim()),
          categoryIds,
        }),
      });
      if (res.ok) {
        const body = (await res.json()) as { id: string };
        navigate(`/dashboard/volunteer/${body.id}/add`);
      } else {
        setFailure(FAILURE_MSG);
      }
    } catch {
      setFailure(FAILURE_MSG);
    } finally {
      setSubmitting(false);
    }
  }

  const fieldError = (key: string) => (errors[key] ? <p className="mp3-field-error">{errors[key]}</p> : null);

  return (
    <div className="mp10-page">
      <div className="mp10-hero">
        <img src={heroImg} alt="Volunteer Request" />
      </div>
      <div className="mp10-band">
        <h1 className="mp10-band-title">POST VOLUNTEER ROLES</h1>
      </div>
      <div className="mp10-body">
        <Link href="/dashboard" className="mp5-back">
          &lt; Back
        </Link>
        <p className="mp6-copy">
          Please complete the form below to create a new volunteer request. On this page you will provide the details
          about the child, teen, parent or caregiver this opportunity will serve them you will be able to add volunteer
          roles to the request on the following page.
        </p>
        <p className="mp6-copy">
          Make your request compelling by keeping the post title and description brief but including details about the
          impact this role will make for kids/families to inspire people to sign up.
        </p>

        <form className="mp10-form" onSubmit={onSubmit} noValidate>
          <label className="mp5-label" htmlFor="mp10-org">
            Organization *
          </label>
          <input id="mp10-org" className="pub-input mp5-input mp6-readonly" type="text" value={orgName} disabled />

          <label className="mp5-label" htmlFor="mp10-contact-first">
            Contact First Name *
          </label>
          <input
            id="mp10-contact-first"
            className="pub-input mp5-input"
            type="text"
            value={contactFirstName}
            onChange={(e) => setContactFirstName(e.target.value)}
          />
          {fieldError("contactFirstName")}

          <label className="mp5-label" htmlFor="mp10-contact-last">
            Contact Last Name *
          </label>
          <input
            id="mp10-contact-last"
            className="pub-input mp5-input"
            type="text"
            value={contactLastName}
            onChange={(e) => setContactLastName(e.target.value)}
          />
          {fieldError("contactLastName")}

          <label className="mp5-label" htmlFor="mp10-contact-email">
            Contact Email Address *
          </label>
          <input
            id="mp10-contact-email"
            className="pub-input mp5-input"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
          {fieldError("contactEmail")}

          <label className="mp5-label" htmlFor="mp10-contact-phone">
            Contact Phone Number *
          </label>
          <input
            id="mp10-contact-phone"
            className="pub-input mp5-input"
            type="text"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
          />
          {fieldError("contactPhone")}

          <span className="mp5-label">Deadline Type *</span>
          <DeadlineField
            idPrefix="mp10"
            value={deadlineType}
            onChange={setDeadlineType}
            date={deadlineDate}
            onDateChange={setDeadlineDate}
            typeError={errors.deadlineType}
            dateError={errors.deadlineDate}
            options={VOLUNTEER_DEADLINE_OPTIONS}
          />

          <label className="mp5-label" htmlFor="mp10-details">
            Details: *
          </label>
          <input
            id="mp10-details"
            className="pub-input mp5-input"
            type="text"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
          />
          {fieldError("details")}
          <ul className="mp7-helper">
            <li>
              Please include the following details:
              <ul>
                <li>
                  <strong>Ongoing:</strong> Please share the frequency and time commitment for these roles.
                  <ul>
                    <li>Ex: 1 hour/month, every second Tuesday, intermittently during the year, etc.</li>
                  </ul>
                </li>
                <li>
                  <strong>Date Specific:</strong> Please include the date or dates you need help
                  <ul>
                    <li>Ex: Saturday June 5th 6-9pm, the weekend of November 25-26, etc.</li>
                  </ul>
                </li>
              </ul>
            </li>
          </ul>

          <label className="mp5-label" htmlFor="mp10-title">
            Request Title *
          </label>
          <input
            id="mp10-title"
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
                  Examples: Soccer Coach for Refugee Youth | Event Volunteers for Pregnancy Center Gala | At-Risk Youth
                  Camp Counselor
                </li>
              </ul>
            </li>
          </ul>

          <label className="mp5-label" htmlFor="mp10-description">
            Request Description *
          </label>
          <textarea
            id="mp10-description"
            className="pub-input mp5-input mp10-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {fieldError("description")}
          <ul className="mp7-helper">
            <li>
              In 2-4 sentences please give people more details about the volunteer opportunity and the impact your
              service will have on vulnerable kids &amp; families.
              <ul>
                <li>
                  Examples: Join us as an event volunteer at our upcoming Gala. This black tie event allows us to share
                  our mission and fund our programs including free ultrasound services, diapers and labor and delivery
                  classes for women facing unplanned pregnancies.
                </li>
              </ul>
            </li>
          </ul>

          <label className="mp5-label" htmlFor="mp10-location">
            Volunteer Role Location *
          </label>
          <input
            id="mp10-location"
            className="pub-input mp5-input"
            type="text"
            value={eventLocation}
            onChange={(e) => setEventLocation(e.target.value)}
          />
          {fieldError("eventLocation")}
          <ul className="mp7-helper">
            <li>
              Does this role take place a your location or at another site in the community?
              <ul>
                <li>Examples: Our Warehouse | Community Park | Specific Address.</li>
              </ul>
            </li>
          </ul>

          <label className="mp5-label" htmlFor="mp10-people">
            How many kids and/or families will this help? *
          </label>
          <input
            id="mp10-people"
            className="pub-input mp5-input"
            type="number"
            min={0}
            step={1}
            value={peopleHelped}
            onChange={(e) => setPeopleHelped(e.target.value)}
          />
          {fieldError("peopleHelped")}

          <fieldset className="mp10-categories" aria-describedby={errors.categoryIds ? "mp10-categories-error" : undefined}>
            <legend className="mp5-label">Volunteer Categories *</legend>
            <p className="mp7-helper">Select every category that fits this opportunity.</p>
            {categoriesQuery.isLoading ? (
              <p className="mp7-helper">Loading categories…</p>
            ) : categoriesQuery.isError ? (
              <p className="mp3-field-error" role="alert">
                Categories could not be loaded. Please refresh and try again.
              </p>
            ) : categories.length === 0 ? (
              <p className="mp3-field-error" role="alert">
                No volunteer categories are available yet. Please contact staff before posting this request.
              </p>
            ) : (
              <div className="mp10-category-list">
                {categories.map((category) => {
                  const checked = categoryIds.includes(category.id);
                  return (
                    <label key={category.id} className="mp10-category-option">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setCategoryIds((current) =>
                            checked ? current.filter((id) => id !== category.id) : [...current, category.id],
                          )
                        }
                      />{" "}
                      {category.name}
                    </label>
                  );
                })}
              </div>
            )}
            {errors.categoryIds ? (
              <p id="mp10-categories-error" className="mp3-field-error">
                {errors.categoryIds}
              </p>
            ) : null}
          </fieldset>

          {failure ? (
            <p className="mp5-failure" role="alert">
              {failure}
            </p>
          ) : null}

          <button type="submit" className="mp5-submit" disabled={submitting || categoriesQuery.isLoading}>
            {submitting ? "Saving…" : "Continue to Adding Roles ›"}
          </button>
        </form>
      </div>
    </div>
  );
}
