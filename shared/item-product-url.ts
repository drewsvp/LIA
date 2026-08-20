export const MAX_PRODUCT_URL_LENGTH = 8_192;

const INVALID_PRODUCT_URL_MESSAGE = "Please enter a valid product URL starting with http:// or https://.";
const PRODUCT_URL_TOO_LONG_MESSAGE = `Product URL must be ${MAX_PRODUCT_URL_LENGTH.toLocaleString("en-US")} characters or fewer.`;

export type ProductUrlParseResult =
  | { ok: true; value: string | null }
  | { ok: false; message: string };

/**
 * Product links are optional, but any supplied value must remain intact and
 * pass the same HTTP(S) validation on every client and server path.
 */
export function parseProductUrl(input: unknown): ProductUrlParseResult {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== "string") return { ok: false, message: INVALID_PRODUCT_URL_MESSAGE };

  const value = input.trim();
  if (value === "") return { ok: true, value: null };
  if (value.length > MAX_PRODUCT_URL_LENGTH) {
    return { ok: false, message: PRODUCT_URL_TOO_LONG_MESSAGE };
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, message: INVALID_PRODUCT_URL_MESSAGE };
    }
  } catch {
    return { ok: false, message: INVALID_PRODUCT_URL_MESSAGE };
  }

  return { ok: true, value };
}

export function productUrlProblem(input: string): string | null {
  const parsed = parseProductUrl(input);
  return parsed.ok ? null : parsed.message;
}