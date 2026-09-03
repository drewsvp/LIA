/**
 * MP-04 — /dashboard. The organization's hub (docs/specs/MP-04.md).
 *
 * Read-only: this surface only routes. Requests are fetched through the
 * session-scoped overview endpoint — no organization identifier exists in
 * any URL here (§11). A failed query renders a stated error in place of
 * the selector, never an empty selector (§12).
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "../../hooks/useSession";
import { useSiteSettings } from "../../hooks/useSiteSettings";
import { ApiResponseError } from "../../lib/queryClient";
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
  itemRequestsError?: boolean;
  volunteerRequests: OverviewRequest[];
  volunteerRequestsError?: boolean;
};

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  month: "2-digit",
  day: "2-digit",
  year: "numeric",
});

/** Option label: `{Title} - {MM/DD/YYYY} [{Status}]` — status included so Draft
 *  requests are visibly distinct from submitted/active ones (§5). */
function statusLabel(status: string): string {
  if (status === "draft") return "Draft";
  if (status === "pending") return "Pending review";
  if (status === "active") return "Active";
  if (status === "archived") return "Archived";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function optionLabel(r: OverviewRequest): string {
  return `${r.title} - ${DATE_FMT.format(new Date(r.createdAt))} [${statusLabel(r.status)}]`;
}

const ITEM_QUERY_ERROR_COPY = "Item requests could not be loaded. Please refresh the page and try again.";
const VOLUNTEER_QUERY_ERROR_COPY = "Volunteer requests could not be loaded. Please refresh the page and try again.";
const ONLINE_COMMUNITY_LOGIN_URL = "https://www.alliancemembercommunity.org/users/sign_in#email";

type DashboardTile =
  | { img: string; label: string; to: string }
  | { img: string; label: string; href: string }
  | { img: string; label: string; notice: true };

function RequestSelector({
  label,
  placeholder,
  emptyCopy,
  buttonLabel,
  requests,
  failed,
  errorCopy,
  loading,
  onEdit,
}: {
  label: string;
  placeholder: string;
  emptyCopy: string;
  buttonLabel: string;
  requests: OverviewRequest[] | undefined;
  failed: boolean;
  errorCopy: string;
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
          {errorCopy}
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
  const queryClient = useQueryClient();
  const { session } = useSession();
  const { settings: siteSettings } = useSiteSettings();
  const overviewQuery = useQuery<Overview>({ queryKey: ["/api/dashboard/overview"] });
  const accessFailure =
    overviewQuery.error instanceof ApiResponseError &&
    (overviewQuery.error.status === 401 ||
      overviewQuery.error.status === 403 ||
      overviewQuery.error.status === 409);

  // A rejected session/context is an access-state change, not two data-source
  // failures. Refresh the session so DashboardGate can route to login,
  // organization selection, pending approval, or staff organization selection.
  useEffect(() => {
    if (accessFailure) {
      void queryClient.invalidateQueries({ queryKey: ["/api/session"] });
    }
  }, [accessFailure, queryClient]);

  const overview = overviewQuery.data;
  // Org name resolves from the session even if the overview query fails.
  const sessionOrgName =
    session?.organizationContext?.organizationName ??
    session?.memberships.find((m) => m.orgId === session.activeOrgId)?.orgName ?? "";
  const activeMembership = session?.memberships.find((m) => m.orgId === session.activeOrgId);
  const isPlatformOwner = activeMembership?.orgKind === "platform_owner";
  const orgName = overview?.org.name ?? sessionOrgName;
  const logoUrl = overview?.org.logoUrl ?? null;

  const tiles = [
    { img: tileItem, label: "New Item(s) Request", to: "/dashboard/items/new" },
    { img: tileVolunteer, label: "New Volunteer Request", to: "/dashboard/volunteer/new" },
    { img: tileDonors, label: "View Donors/Volunteers", to: "/dashboard/supporters" },
    { img: tileOrg, label: "Edit My Organization", to: "/dashboard/organization" },
    isPlatformOwner
      ? session?.staffRole === "staff_admin"
        ? { img: tileUsers, label: "Invite staff member (Admin → Roles)", to: "/admin/roles" }
        : { img: tileUsers, label: "Contact a staff admin to invite staff", notice: true as const }
      : { img: tileUsers, label: "Add Another User", to: "/dashboard/members/new" },
    {
      img: tileCommunity,
      label: "Online Community Login",
      href: ONLINE_COMMUNITY_LOGIN_URL,
    },
  ] satisfies DashboardTile[];

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
          <strong>{siteSettings.directorName}</strong> at{" "}
          <a href={`mailto:${siteSettings.directorEmail}`}>{siteSettings.directorEmail}</a>.
        </p>

        <div className="mp4-grid">
          {tiles.map((tile) => (
            <div key={tile.label} className="mp4-tile">
              <img className="mp4-tile-img" src={tile.img} alt="" />
              {"href" in tile ? (
                <a
                  className="mp4-tile-link"
                  href={tile.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {tile.label}
                </a>
              ) : "to" in tile && typeof tile.to === "string" ? (
                <button type="button" className="mp4-tile-btn" onClick={() => navigate(tile.to)}>
                  {tile.label}
                </button>
              ) : (
                <p className="mp4-tile-link">{tile.label}</p>
              )}
            </div>
          ))}
        </div>

        <section className="mp4-edit-region">
          <h2 className="mp4-edit-heading">EDIT/ARCHIVE EXISTING REQUESTS</h2>
          <RequestSelector
            label="Item Requests"
            placeholder="Select Item Request..."
            emptyCopy="Your organization doesn't have any item requests yet."
            buttonLabel="Edit Item Request"
            requests={overview?.itemRequests}
            failed={(overviewQuery.isError && !accessFailure) || overview?.itemRequestsError === true}
            errorCopy={ITEM_QUERY_ERROR_COPY}
            loading={overviewQuery.isLoading}
            onEdit={(id) => navigate(`/dashboard/items/${id}/edit`)}
          />
          <RequestSelector
            label="Volunteer Requests"
            placeholder="Select Volunteer Request..."
            emptyCopy="Your organization doesn't have any volunteer requests yet."
            buttonLabel="Edit Volunteer Request"
            requests={overview?.volunteerRequests}
            failed={(overviewQuery.isError && !accessFailure) || overview?.volunteerRequestsError === true}
            errorCopy={VOLUNTEER_QUERY_ERROR_COPY}
            loading={overviewQuery.isLoading}
            onEdit={(id) => navigate(`/dashboard/volunteer/${id}/edit`)}
          />
        </section>

      </div>
    </div>
  );
}
