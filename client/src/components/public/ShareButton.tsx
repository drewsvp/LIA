import { useEffect, useRef, useState, type ReactElement } from "react";
import { SHARE_REF_PARAM, SHARE_REF_VALUE } from "@shared/share-copy";

/**
 * Share control for the three public detail surfaces (PB-02, PB-04, PB-08).
 *
 * Mobile browsers get the native share sheet through navigator.share. Desktop
 * browsers — where most of this will actually be seen — have no Web Share API,
 * so they get an explicit menu instead: copy link, X (which accepts our
 * pre-fill text), and Facebook (which builds its card from the page's meta
 * tags and ignores custom text — expected, not a bug).
 *
 * `path` is the CANONICAL path of the surface. The ?ref=share tag is appended
 * only to what we hand to the share targets, never to the canonical URL the
 * link preview advertises.
 */
export type ShareButtonProps = {
  /** Canonical app path, e.g. "/items/<id>". */
  path: string;
  /** Share title — from shared/share-copy. */
  title: string;
  /** Share text / description — from shared/share-copy. */
  text: string;
  label?: string;
};

function taggedUrl(path: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const url = new URL(path, origin === "" ? "https://example.invalid" : origin);
  url.searchParams.set(SHARE_REF_PARAM, SHARE_REF_VALUE);
  return url.toString();
}

export function ShareButton(props: ShareButtonProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Resolved after mount: navigator is unavailable during any non-browser
  // render, and the fallback menu is the correct default.
  const [canWebShare, setCanWebShare] = useState(false);
  useEffect(() => {
    setCanWebShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDocumentClick(e: MouseEvent): void {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocumentClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocumentClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const shareUrl = taggedUrl(props.path);
  const label = props.label ?? "Share";

  async function nativeShare(): Promise<void> {
    try {
      await navigator.share({ title: props.title, text: props.text, url: shareUrl });
    } catch {
      // A cancelled share sheet rejects; that is a normal user action.
    }
  }

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission denied: say so rather than silently doing nothing.
      window.prompt("Copy this link:", shareUrl);
    }
  }

  const xHref = `https://x.com/intent/post?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(props.text)}`;
  const facebookHref = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`;

  return (
    <div className="pb-share" ref={wrapRef}>
      <button
        type="button"
        className="btn-teal"
        aria-haspopup={canWebShare ? undefined : "menu"}
        aria-expanded={canWebShare ? undefined : open}
        onClick={() => {
          if (canWebShare) {
            void nativeShare();
            return;
          }
          setOpen((prev) => !prev);
        }}
      >
        {label}
      </button>
      {!canWebShare && open && (
        <div className="pb-share-menu" role="menu">
          <button type="button" role="menuitem" className="pb-share-option" onClick={() => void copyLink()}>
            {copied ? "Link copied!" : "Copy link"}
          </button>
          <a
            role="menuitem"
            className="pb-share-option"
            href={xHref}
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
          >
            Share on X
          </a>
          <a
            role="menuitem"
            className="pb-share-option"
            href={facebookHref}
            target="_blank"
            rel="noreferrer"
            onClick={() => setOpen(false)}
          >
            Share on Facebook
          </a>
        </div>
      )}
    </div>
  );
}
