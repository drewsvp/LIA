import type { ReactElement } from "react";
import { PublicLayout } from "../../components/public/PublicLayout";

/**
 * PB-06 — About (docs/specs/PB-06.md).
 *
 * Navigation only: reads nothing, writes nothing. Wix never had an
 * LIA-specific About page, so there is no capture to match; this page opens
 * with the "Join Us in Changing the World" section moved off PB-00 verbatim.
 *
 * The TEDx talk URL is captured nowhere in docs/, so the phrase stays
 * bold-but-unlinked rather than pointing somewhere invented — the same
 * decision PB-00 carried. Further content (mission, how a posted need gets
 * fulfilled) is deliberately absent rather than filled with invented copy.
 */
export function AboutPage(): ReactElement {
  return (
    <PublicLayout>
      <div className="pb0-navy">
        <h2 className="pb0-navy-heading">Join Us in Changing the World</h2>
        <p className="pb0-navy-para">
          Each of us have talents, resources and experience that can be used to make a difference for kids &amp;
          families in our community.
        </p>
        <p className="pb0-navy-para">
          If you're looking for some ideas or encouragement, check out this <strong>TEDx talk</strong> by The
          Alliance's very own, <strong>Heidi White</strong>.
        </p>
      </div>
    </PublicLayout>
  );
}
