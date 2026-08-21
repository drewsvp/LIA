import { useMemo, useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PublicLayout } from "../../components/public/PublicLayout";
import { RequestCard } from "../../components/public/RequestCard";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import provideHeader from "../../assets/headers/Provide-an-Item-Header.png";

/**
 * PB-01 — Browse item requests (docs/specs/PB-01.md).
 * Public list of active item needs. Client-side search across request title,
 * organization name, and organization city; 300ms debounce (C7).
 */

type ListPayload = {
  requests: {
    id: string;
    title: string;
    description: string | null;
    imageUrl: string | null;
    organization: { name: string; city: string | null; logoUrl: string | null };
  }[];
};

export function ItemsBrowsePage(): ReactElement {
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedTerm = useDebouncedValue(searchTerm, 300);
  const { data, isLoading, isError } = useQuery<ListPayload>({ queryKey: ["/api/public/item-requests"] });

  const requests = data?.requests;
  const filtered = useMemo(() => {
    if (!requests) return [];
    const term = debouncedTerm.trim().toLowerCase();
    if (term === "") return requests;
    return requests.filter(
      (r) =>
        r.title.toLowerCase().includes(term) ||
        r.organization.name.toLowerCase().includes(term) ||
        (r.organization.city ?? "").toLowerCase().includes(term),
    );
  }, [requests, debouncedTerm]);

  return (
    <PublicLayout>
      <img src={provideHeader} alt="Provide an Item" className="pb-page-header-img" />
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "32px 16px 64px" }}>
        {/* Search intro copy reproduced exactly as captured, grammar included (PB-01 §8). */}
        <p style={{ maxWidth: 760, margin: "0 auto 16px", textAlign: "center", fontSize: 15, lineHeight: 1.6 }}>
          Check out the needs of local kids and families by scrolling through our database or using the search bar
          to find specific items to donation or organizations to support.
        </p>
        <p style={{ maxWidth: 760, margin: "0 auto 12px", textAlign: "center", fontSize: 15, fontWeight: 700 }}>
          Search for needs by item, city or requesting organization.
        </p>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 32 }}>
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search..."
            aria-label="Search item requests"
            className="public-search"
          />
        </div>

        {isLoading && (
          <p style={{ textAlign: "center", fontSize: 15 }}>Loading current needs…</p>
        )}

        {/* A failed query is a STATED error — never an empty list (PB-01 §12). */}
        {isError && (
          <p role="alert" style={{ textAlign: "center", fontSize: 15, fontWeight: 700, color: "var(--color-navy)" }}>
            We couldn't load the current item needs. Please refresh the page to try again.
          </p>
        )}

        {requests && requests.length === 0 && (
          <p style={{ textAlign: "center", fontSize: 15 }}>
            No items needed right now, check back soon or{" "}
            <Link href="/volunteer">browse volunteer opportunities</Link> instead.
          </p>
        )}

        {requests && requests.length > 0 && filtered.length === 0 && (
          <p style={{ textAlign: "center", fontSize: 15 }}>No items match your search.</p>
        )}

        {filtered.length > 0 && (
          <div className="pb-grid">
            {filtered.map((r) => (
              <RequestCard
                key={r.id}
                href={`/items/${r.id}`}
                requestKind="item"
                requestId={r.id}
                title={r.title}
                description={r.description}
                imageUrl={r.imageUrl}
                orgName={r.organization.name}
                orgLogoUrl={r.organization.logoUrl}
                locationLabel="City"
                locationValue={r.organization.city}
                buttonText="Learn More / View Details"
                titleVariant="bar"
              />
            ))}
          </div>
        )}
      </div>
    </PublicLayout>
  );
}
