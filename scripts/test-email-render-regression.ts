/**
 * Render-regression test: every template that declares `defaultBlocks` must
 * produce byte-for-byte identical HTML and plain-text when rendered via:
 *   (a) the legacy path  — render(sample)  (no bodyBlocks in copy)
 *   (b) the blocks path  — render(sample, { ...defaultCopy, bodyBlocks: defaultBlocks })
 *
 * A section name typo or a missed element in the legacy fallback will fail
 * this test before it can reach production.
 *
 * Usage:
 *   NODE_ENV=development npx tsx scripts/test-email-render-regression.ts
 */

import { PRODUCT_TEMPLATES } from "../server/email/templates/index";
import type { DigestNewNeedsVars } from "../server/email/templates/digest-new-needs";

let passed = 0;
let failed = 0;

function norm(s: string): string {
  // Collapse trailing whitespace on each line and multiple blank lines so
  // inconsequential formatting differences don't mask real mismatches.
  return s
    .replace(/\r\n/g, "\n")
    .replace(/[^\S\n]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function diffPreview(a: string, b: string, label: string): void {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  let shown = 0;
  for (let i = 0; i < Math.max(aLines.length, bLines.length) && shown < 6; i++) {
    if (aLines[i] !== bLines[i]) {
      console.error(`      ${label} line ${i + 1}:`);
      console.error(`        legacy: ${(aLines[i] ?? "<missing>").substring(0, 120)}`);
      console.error(`        blocks: ${(bLines[i] ?? "<missing>").substring(0, 120)}`);
      shown++;
    }
  }
}

function assertDigestOutput(): void {
  const template = PRODUCT_TEMPLATES.digest_new_needs;
  const rendered = template.render(template.sample);
  const expected = [
    'src="https://images.unsplash.com/photo-1609139003551-ee40f5f73ec0?auto=format&amp;fit=crop&amp;w=560&amp;q=80"',
    'src="https://images.unsplash.com/photo-1559027615-cd4628902d4a?auto=format&amp;fit=crop&amp;w=560&amp;q=80"',
    'href="https://example.org/items/10432"',
    'href="https://example.org/volunteer/10433"',
    ">View Item Need</a>",
    ">View Volunteer Need</a>",
    'width="132" height="132"',
    "text-align:center",
    "border-radius:999px",
    "Help local families stay warm",
    "Join a welcoming team",
  ];
  const textUrlsPresent =
    rendered.text.includes("https://example.org/items/10432") &&
    rendered.text.includes("https://example.org/volunteer/10433");
  const footerProgramNameResolved =
    rendered.html.includes("subscribed to the Love in Action weekly digest") &&
    rendered.text.includes("subscribed to the Love in Action weekly digest") &&
    !rendered.html.includes("{programName}") &&
    !rendered.text.includes("{programName}");
  const noImageVars: DigestNewNeedsVars = {
    needs: [{
      name: "Legacy Need Without Image",
      description: "<strong>Safe &amp; readable</strong> " + "description ".repeat(30) + "<script>alert('no')</script>",
      organizationName: "Legacy Organization",
      typeLabel: "Item need",
      url: "https://example.org/items/legacy",
      imageUrl: null,
    }],
    unsubscribeUrl: "https://example.org/unsubscribe/legacy",
  };
  const noImage = template.render(noImageVars);
  const noBrokenImage = !noImage.html.includes('alt="Legacy Need Without Image"');
  const safeExcerpt =
    noImage.html.includes("Safe &amp; readable description") &&
    noImage.text.includes("Safe & readable description") &&
    noImage.html.includes("…") &&
    !noImage.html.includes("&lt;strong&gt;") &&
    !noImage.html.includes("<script>") &&
    !noImage.text.includes("alert(");
  const ok =
    expected.every((fragment) => rendered.html.includes(fragment)) &&
    textUrlsPresent &&
    footerProgramNameResolved &&
    noBrokenImage &&
    safeExcerpt &&
    noImage.html.includes('href="https://example.org/items/legacy"') &&
    noImage.text.includes("https://example.org/items/legacy");

  if (ok) {
    console.log("  PASS  digest_new_needs output details");
    passed++;
  } else {
    console.error("  FAIL  digest_new_needs output details");
    failed++;
  }
}

async function main() {
  console.log("Email render-regression test\n");

  for (const template of Object.values(PRODUCT_TEMPLATES)) {
    if (!template.defaultBlocks || template.defaultBlocks.length === 0) {
      console.log(`  SKIP  ${template.key}  (no defaultBlocks)`);
      continue;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vars = template.sample as any;

    // (a) legacy path: render() with no bodyBlocks override
    const legacy = template.render(vars, template.defaultCopy);

    // (b) blocks path: inject defaultBlocks into copy
    const withBlocks = template.render(vars, {
      ...template.defaultCopy,
      bodyBlocks: template.defaultBlocks,
    });

    const htmlNormLeg = norm(legacy.html);
    const htmlNormBlk = norm(withBlocks.html);
    const textNormLeg = norm(legacy.text);
    const textNormBlk = norm(withBlocks.text);

    const htmlOk = htmlNormLeg === htmlNormBlk;
    const textOk = textNormLeg === textNormBlk;

    if (htmlOk && textOk) {
      console.log(`  PASS  ${template.key}`);
      passed++;
    } else {
      console.error(`  FAIL  ${template.key}`);
      if (!htmlOk) diffPreview(htmlNormLeg, htmlNormBlk, "HTML");
      if (!textOk) diffPreview(textNormLeg, textNormBlk, "TEXT");
      failed++;
    }
  }

  assertDigestOutput();

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
