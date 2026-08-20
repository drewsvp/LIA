import { useMemo, useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PublicLayout } from "../../components/public/PublicLayout";
import { RequestCard } from "../../components/public/RequestCard";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import volunteerHeader from "../../assets/headers/Volunteer-your-Time-Header.png";

/**
 * PB-03 — Browse volunteer requests (docs/specs/PB-03.md).
 * Parallel to PB-01 with one extra searchable field: request title,
 * organization name, EVENT LOCATION, and organization city (4 fields).
 * 300ms debounce (C7). Most-recent-first comes from the shared DAL helper.
 */

type ListPayload = {
  requests: {
    id: string;
    title: string;
    description: string | null;
    imageUrl: string | null;
    eventLocation: string | null;
    organization: { name: string; city: string | null; logoUrl: string | null };
  }[];
};

export function VolunteerBrowsePage(): ReactElement {
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedTerm = useDebouncedValue(searchTerm, 300);
  const { data, isLoading, isError } = useQuery<ListPayload>({ queryKey: ["/api/public/volunteer-requests"] });

  const requests = data?.requests;
  const filtered = useMemo(() => {
    if (!requests) return [];
    const term = debouncedTerm.trim().toLowerCase();
    if (term === "") return requests;
    return requests.filter(
      (r) =>
        r.title.toLowerCase().includes(term) ||
        r.organization.name.toLowerCase().includes(term) ||
        (r.eventLocation ?? "").toLowerCase().includes(term) ||
        (r.organization.city ?? "").toLowerCase().includes(term),
    );
  }, [requests, debouncedTerm]);

  return (
    <PublicLayout>
      <img src={volunteerHeader} alt="Volunteer Your Time" className="pb-page-header-img" />
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "32px 16px 64px" }}>
        <p style={{ maxWidth: 760, margin: "0 auto 16px", textAlign: "center", fontSize: 15, lineHeight: 1.6 }}>
          Check out different volunteer opportunities by scrolling through our database or using the search bar to
          find specific organizations to support or service options near you.
        </p>
        <p style={{ maxWidth: 760, margin: "0 auto 12px", textAlign: "center", fontSize: 15, fontWeight: 700 }}>
          Search for volunteer opportunities by role, city or requesting organization.
        </p>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 32 }}>
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search..."
            aria-label="Search volunteer opportunities"
            className="public-search"
          />
        </div>

        {isLoading && <p style={{ textAlign: "center", fontSize: 15 }}>Loading volunteer opportunities…</p>}

        {/* A failed query is a STATED error — never an empty list (PB-03 §12). */}
        {isError && (
          <p role="alert" style={{ textAlign: "center", fontSize: 15, fontWeight: 700, color: "var(--color-navy)" }}>
            We couldn't load the current volunteer opportunities. Please refresh the page to try again.
          </p>
        )}

        {requests && requests.length === 0 && (
          <p style={{ textAlign: "center", fontSize: 15 }}>
            No volunteer opportunities right now, check back soon or <Link href="/items">browse item needs</Link>{" "}
            instead.
          </p>
        )}

        {requests && requests.length > 0 && filtered.length === 0 && (
          <p style={{ textAlign: "center", fontSize: 15 }}>No volunteer opportunities match your search.</p>
        )}

        {filtered.length > 0 && (
          <div className="pb-grid">
            {filtered.map((r) => (
              <RequestCard
                key={r.id}
                href={`/volunteer/${r.id}`}
                title={r.title}
                description={r.description}
                imageUrl={r.imageUrl}
                orgName={r.organization.name}
                orgLogoUrl={r.organization.logoUrl}
                locationLabel="Location"
                locationValue={r.eventLocation}
                buttonText="Learn More / View Roles"
                titleVariant="caps"
                underlineLabels
                iconPlacement="overlay"
              />
            ))}
          </div>
        )}
      </div>
    </PublicLayout>
  );
}
