/**
 * MP-04 — /dashboard. The organization's hub (docs/specs/MP-04.md).
 *
 * Read-only: this surface only routes. Requests are fetched through the
 * session-scoped overview endpoint — no organization identifier exists in
 * any URL here (§11). A failed query renders a stated error in place of
 * the selector, never an empty selector (§12).
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "../../hooks/useSession";
import heroImg from "../../assets/dashboard/hero.png";
import tileItem from "../../assets/dashboard/tile-item.png";
import tileVolunteer from "../../assets/dashboard/tile-volunteer.png";
import tileDonors from "../../assets/dashboard/tile-donors.png";
import tileOrg from "../../assets/dashboard/tile-org.png";
import tileUsers from "../../assets/dashboard/tile-users.png";
import tileCommunity from "../../assets/dashboard/tile-community.png";

type OverviewRequest = { id: string; title: string; createdAt: string; status: string };
type Overview = {
  org: { name: string; logoUrl: string | null };
  itemRequests: OverviewRequest[];
  volunteerRequests: OverviewRequest[];
};

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "2-digit",
  day: "2-digit",
  year: "numeric",
});

/** Option label, capture-grounded format: `{Title} - {MM/DD/YYYY}` (§5). */
function optionLabel(r: OverviewRequest): string {
  return `${r.title} - ${DATE_FMT.format(new Date(r.createdAt))}`;
}

const QUERY_ERROR_COPY = "Your requests could not be loaded. Please refresh the page and try again.";

function RequestSelector({
  label,
  placeholder,
  emptyCopy,
  buttonLabel,
  requests,
  failed,
  loading,
  onEdit,
}: {
  label: string;
  placeholder: string;
  emptyCopy: string;
  buttonLabel: string;
  requests: OverviewRequest[] | undefined;
  failed: boolean;
  loading: boolean;
  onEdit: (id: string) => void;
}) {
  const [selected, setSelected] = useState("");
  const empty = !loading && !failed && (requests?.length ?? 0) === 0;

  return (
    <div className="mp4-select-block">
      <label className="mp4-select-label">{label}</label>
      {failed ? (
        <p className="mp4-query-error" role="alert">
          {QUERY_ERROR_COPY}
        </p>
      ) : empty ? (
        <div className="mp4-select-row">
          <p className="mp4-empty">{emptyCopy}</p>
          <button type="button" className="mp4-edit-btn" disabled>
            {buttonLabel}
          </button>
        </div>
      ) : (
        <div className="mp4-select-row">
          <select
            className="mp4-select"
            value={selected}
            disabled={loading}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">{placeholder}</option>
            {(requests ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {optionLabel(r)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="mp4-edit-btn"
            disabled={selected === ""}
            onClick={() => onEdit(selected)}
          >
            {buttonLabel}
          </button>
        </div>
      )}
    </div>
  );
}

export function DashboardPage() {
  const [, navigate] = useLocation();
  const { session } = useSession();
  const overviewQuery = useQuery<Overview>({ queryKey: ["/api/dashboard/overview"] });

  const overview = overviewQuery.data;
  // Org name resolves from the session even if the overview query fails.
  const sessionOrgName =
    session?.memberships.find((m) => m.orgId === session.activeOrgId)?.orgName ?? "";
  const orgName = overview?.org.name ?? sessionOrgName;
  const logoUrl = overview?.org.logoUrl ?? null;

  const tiles = [
    { img: tileItem, label: "New Item(s) Request", to: "/dashboard/items/new" },
    { img: tileVolunteer, label: "New Volunteer Request", to: "/dashboard/volunteer/new" },
    { img: tileDonors, label: "View Donors/Volunteers", to: "/dashboard/supporters" },
    { img: tileOrg, label: "Edit My Organization", to: "/dashboard/organization" },
    { img: tileUsers, label: "Add Another User", to: "/dashboard/members/new" },
    // External Wix members-community login; destination out of scope (§13).
    { img: tileCommunity, label: "Online Community Login", to: null },
  ];

  return (
    <div className="mp4-page">
      <img className="mp4-hero" src={heroImg} alt="" />
      <div className="mp4-band">
        <h1 className="mp4-band-title">MY ORGANIZATION DASHBOARD</h1>
      </div>

      <div className="mp4-strip">
        <div className="mp4-strip-org">
          {logoUrl ? <img className="mp4-strip-logo" src={logoUrl} alt="" /> : null}
          <span className="mp4-strip-name">{orgName}</span>
        </div>
      </div>

      <div className="mp4-body">
        <p className="mp4-welcome">
          <strong>WELCOME</strong> to your organization's Love in Action Dashboard. Use the buttons below
          to submit new donation/volunteer requests, view the contact info of people who have signed up to
          meet your needs, or make edits to your organization/team/requests.
        </p>
        <p className="mp4-welcome">
          If you have any questions, please email our Love in Action Program Director{" "}
          <strong>Christina Moe</strong> at{" "}
          <a href="mailto:christina@defendingthecause.org">christina@defendingthecause.org</a>.
        </p>

        <div className="mp4-grid">
          {tiles.map((tile) => (
            <div key={tile.label} className="mp4-tile">
              <img className="mp4-tile-img" src={tile.img} alt="" />
              {tile.to !== null ? (
                <button type="button" className="mp4-tile-btn" onClick={() => navigate(tile.to)}>
                  {tile.label}
                </button>
              ) : (
                <button type="button" className="mp4-tile-btn mp4-tile-btn-external" disabled>
                  {tile.label}
                </button>
              )}
            </div>
          ))}
        </div>

        <section className="mp4-edit-region">
          <h2 className="mp4-edit-heading">EDIT/ARCHIVE EXISTING REQUESTS</h2>
          <RequestSelector
            label="Item Requests"
            placeholder="Select Item Request..."
            emptyCopy="You haven't created any item requests yet."
            buttonLabel="Edit Item Request"
            requests={overview?.itemRequests}
            failed={overviewQuery.isError}
            loading={overviewQuery.isLoading}
            onEdit={(id) => navigate(`/dashboard/items/${id}/edit`)}
          />
          <RequestSelector
            label="Volunteer Requests"
            placeholder="Select Volunteer Request..."
            emptyCopy="You haven't created any volunteer requests yet."
            buttonLabel="Edit Volunteer Request"
            requests={overview?.volunteerRequests}
            failed={overviewQuery.isError}
            loading={overviewQuery.isLoading}
            onEdit={(id) => navigate(`/dashboard/volunteer/${id}/edit`)}
          />
        </section>
      </div>
    </div>
  );
}
