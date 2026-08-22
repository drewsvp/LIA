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

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
