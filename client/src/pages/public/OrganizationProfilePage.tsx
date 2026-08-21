import { type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { PublicLayout } from "../../components/public/PublicLayout";
import { RequestCard } from "../../components/public/RequestCard";
import { ShareButton } from "../../components/public/ShareButton";
import { NotFound } from "../NotFound";
import { organizationPath, organizationShareDescription, organizationShareTitle } from "@shared/share-copy";
import allianceLogo from "../../assets/alliance-logo-blue.png";

/**
 * PB-08 — public organization profile.
 * Everything one Alliance member is currently asking for, in one shareable
 * place. Unauthenticated; a non-approved org or an unknown slug is the
 * standard not-found page, never an error or an empty shell.
 */

type OrgCard = { name: string; slug: string; city: string | null; logoUrl: string | null };

type ProfilePayload = {
  organization: {
    name: string;
    slug: string;
    mission: string | null;
    websiteUrl: string | null;
    city: string | null;
    logoUrl: string | null;
  };
  itemRequests: {
    id: string;
    title: string;
    description: string | null;
    imageUrl: string | null;
    organization: OrgCard;
  }[];
  volunteerRequests: {
    id: string;
    title: string;
    description: string | null;
    imageUrl: string | null;
    eventLocation: string | null;
    organization: OrgCard;
  }[];
};

export function OrganizationProfilePage(): ReactElement {
  const params = useParams<{ slug: string }>();
  const slug = params.slug ?? "";
  const { data, isLoading, isError, error } = useQuery<ProfilePayload>({
    queryKey: [`/api/public/organizations/${encodeURIComponent(slug)}`],
    enabled: slug !== "",
  });

  const notFound = isError && error instanceof Error && error.message.startsWith("404");
  // A slug that resolves to nothing public is a page that does not exist —
  // the same treatment the router gives an unknown path.
  if (notFound) return <NotFound />;

  const org = data?.organization;
  // The organization's own logo wins whenever it has one. 8 of 9 live
  // organizations have none, so the fallback is the ordinary case: the site
  // mark, fitted whole inside the same square frame.
  const hasLogo = org != null && org.logoUrl != null && org.logoUrl.trim() !== "";

  return (
    <PublicLayout>
      <div className="pb2-banner">Organization</div>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "16px 16px 64px" }}>
        <p style={{ margin: "8px 0 16px" }}>
          <Link href="/items" style={{ fontWeight: 700, textDecoration: "none" }}>
            &lt; Back to current needs
          </Link>
        </p>

        {isLoading && <p style={{ textAlign: "center", fontSize: 15 }}>Loading this organization…</p>}

        {isError && (
          <p role="alert" style={{ textAlign: "center", fontSize: 15, fontWeight: 700, color: "var(--color-navy)" }}>
            We couldn't load this organization. Please refresh the page to try again.
          </p>
        )}

        {data && org && (
          <>
            <div className="pb7-identity">
              <div className={hasLogo ? "pb7-logo" : "pb7-logo pb7-logo-fallback"}>
                <img src={hasLogo ? (org.logoUrl as string) : allianceLogo} alt={hasLogo ? `${org.name} logo` : ""} />
              </div>
              <div className="pb7-identity-body">
                <h1 className="pb7-name">{org.name}</h1>
                {org.city != null && org.city.trim() !== "" && (
                  <p style={{ margin: "0 0 8px", fontSize: 15 }}>
                    <span className="pub-label">City:</span> {org.city}
                  </p>
                )}
                {org.websiteUrl != null && org.websiteUrl.trim() !== "" && (
                  <p style={{ margin: "0 0 8px", fontSize: 15, overflowWrap: "anywhere" }}>
                    <span className="pub-label">Website:</span>{" "}
                    <a href={org.websiteUrl} target="_blank" rel="noreferrer">
                      {org.websiteUrl}
                    </a>
                  </p>
                )}
                {org.mission != null && org.mission.trim() !== "" && (
                  <p style={{ margin: "0 0 12px", fontSize: 15, lineHeight: 1.6 }}>
                    <span className="pub-label">Mission:</span>
                    <br />
                    {org.mission}
                  </p>
                )}
                <ShareButton
                  path={organizationPath(org.slug)}
                  title={organizationShareTitle(org.name)}
                  text={organizationShareDescription(org.name, org.mission)}
                  label="Share this organization"
                />
              </div>
            </div>

            {data.itemRequests.length > 0 && (
              <>
                <h2 className="pb2-section-heading">Item Needs</h2>
                <div className="pb-grid">
                  {data.itemRequests.map((r) => (
                    <RequestCard
                      key={r.id}
                      requestId={r.id}
                      requestKind="item"
                      href={`/items/${r.id}`}
                      title={r.title}
                      description={r.description}
                      imageUrl={r.imageUrl}
                      orgName={r.organization.name}
                      orgSlug={r.organization.slug}
                      locationLabel="City"
                      locationValue={r.organization.city}
                      buttonText="Learn More / View Details"
                      titleVariant="bar"
                    />
                  ))}
                </div>
              </>
            )}

            {data.volunteerRequests.length > 0 && (
              <>
                <h2 className="pb2-section-heading">Volunteer Opportunities</h2>
                <div className="pb-grid">
                  {data.volunteerRequests.map((r) => (
                    <RequestCard
                      key={r.id}
                      requestId={r.id}
                      requestKind="volunteer"
                      href={`/volunteer/${r.id}`}
                      title={r.title}
                      description={r.description}
                      imageUrl={r.imageUrl}
                      orgName={r.organization.name}
                      orgSlug={r.organization.slug}
                      locationLabel="Location"
                      locationValue={r.eventLocation}
                      buttonText="Learn More / View Roles"
                      titleVariant="caps"
                      underlineLabels
                    />
                  ))}
                </div>
              </>
            )}

            {/* No headings for absent sections — one honest line instead. */}
            {data.itemRequests.length === 0 && data.volunteerRequests.length === 0 && (
              <p style={{ textAlign: "center", fontSize: 15, margin: "36px 0 0" }}>
                {org.name} has no active needs posted right now. Check back soon, or{" "}
                <Link href="/items">browse current item needs</Link> and{" "}
                <Link href="/volunteer">volunteer opportunities</Link> from other organizations.
              </p>
            )}
          </>
        )}
      </div>
    </PublicLayout>
  );
}
