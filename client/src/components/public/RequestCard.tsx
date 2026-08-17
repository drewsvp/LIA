import { useState, type ReactElement } from "react";
import { Link } from "wouter";

/**
 * Public browse card, shared by PB-01 and PB-03. Confirmed orders:
 *   PB-01 §5: org icon (above), photo, title on a navy bar, plain labels,
 *             "City" value from the org, button "Learn More / View Details".
 *   PB-03 §5: circular org icon overlaid on the photo top-left, title in
 *             bold caps, UNDERLINED labels, "Location" = event_location,
 *             button "Learn More / View Roles".
 * The differences arrive as props — never guessed per surface. Empty fields
 * hide their line entirely.
 */
export type RequestCardProps = {
  href: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  orgName: string;
  orgLogoUrl: string | null;
  locationLabel: "City" | "Location";
  locationValue: string | null;
  buttonText: string;
  titleVariant: "bar" | "caps";
  underlineLabels?: boolean;
  iconPlacement: "above" | "overlay";
};

/** Standard placeholder graphic for requests without an image (PB-01 §7). */
function PlaceholderGraphic(): ReactElement {
  return (
    <div
      aria-hidden
      style={{
        width: "100%",
        aspectRatio: "16 / 10",
        background: "#e8e8e8",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--color-navy)" strokeWidth="1.5">
        <path d="M12 21C12 21 4 15.5 4 9.8C4 6.9 6.2 5 8.5 5C10 5 11.3 5.8 12 7C12.7 5.8 14 5 15.5 5C17.8 5 20 6.9 20 9.8C20 15.5 12 21 12 21Z" />
      </svg>
    </div>
  );
}

export function RequestCard(props: RequestCardProps): ReactElement {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = props.imageUrl != null && props.imageUrl.trim() !== "" && !imageFailed;
  const hasLogo = props.orgLogoUrl != null && props.orgLogoUrl.trim() !== "";
  const labelStyle = {
    color: "var(--color-navy)",
    textDecoration: props.underlineLabels ? "underline" : "none",
  } as const;

  return (
    <article
      style={{
        background: "var(--color-surface)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-card)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {props.iconPlacement === "above" && hasLogo && (
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 12px 0" }}>
          <img
            src={props.orgLogoUrl ?? undefined}
            alt={`${props.orgName} logo`}
            style={{ height: 44, width: 44, objectFit: "contain" }}
          />
        </div>
      )}
      <div style={{ padding: "12px 12px 0", position: "relative" }}>
        {showImage ? (
          <img
            src={props.imageUrl ?? undefined}
            alt={props.title}
            onError={() => setImageFailed(true)}
            style={{ width: "100%", aspectRatio: "16 / 10", objectFit: "cover", display: "block" }}
          />
        ) : (
          <PlaceholderGraphic />
        )}
        {props.iconPlacement === "overlay" && hasLogo && (
          <img
            src={props.orgLogoUrl ?? undefined}
            alt={`${props.orgName} logo`}
            style={{
              position: "absolute",
              top: 20,
              left: 20,
              height: 44,
              width: 44,
              borderRadius: "50%",
              objectFit: "cover",
              background: "#ffffff",
              border: "2px solid #ffffff",
              boxShadow: "var(--shadow-card)",
            }}
          />
        )}
      </div>
      {props.titleVariant === "bar" ? (
        <h3
          style={{
            margin: "12px 12px 0",
            background: "var(--color-navy)",
            color: "#ffffff",
            fontSize: 16,
            fontWeight: 700,
            padding: "10px 12px",
            textAlign: "center",
          }}
        >
          {props.title}
        </h3>
      ) : (
        <h3
          style={{
            margin: "14px 12px 0",
            color: "var(--color-navy)",
            fontSize: 16,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 1,
            textAlign: "center",
          }}
        >
          {props.title}
        </h3>
      )}
      <div style={{ padding: "12px 16px 16px", fontSize: 15, lineHeight: 1.5, flex: 1 }}>
        <p style={{ margin: "0 0 8px" }}>
          <strong style={labelStyle}>Requesting Organization</strong>
          <br />
          {props.orgName}
        </p>
        {props.locationValue != null && props.locationValue.trim() !== "" && (
          <p style={{ margin: "0 0 8px" }}>
            <strong style={labelStyle}>{props.locationLabel}</strong>
            <br />
            {props.locationValue}
          </p>
        )}
        {props.description != null && props.description.trim() !== "" && (
          <p style={{ margin: 0 }}>
            <strong style={labelStyle}>Description</strong>
            <br />
            <span className="clamp-3">{props.description}</span>
          </p>
        )}
      </div>
      <div style={{ padding: "0 16px 16px" }}>
        <Link href={props.href} className="btn-teal" style={{ display: "block", textAlign: "center" }}>
          {props.buttonText}
        </Link>
      </div>
    </article>
  );
}
