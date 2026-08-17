/**
 * The storage adapter — the ONLY module that touches object storage.
 * Everything else works with stable app URLs (/storage/images/<key>) that the
 * adapter returns; no provider client, bucket name, or provider URL appears
 * anywhere else. Uploaded images are read/written/deleted here; external
 * source-hosted URLs are never written to the database (Handbook §7).
 *
 * Backing store: Replit App Storage (object storage). If no bucket exists the
 * adapter fails loudly with setup instructions — silent failure is worse.
 */
import { randomUUID } from "node:crypto";
import { Client } from "@replit/object-storage";

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

export type StoredImage = {
  /** Stable app URL, e.g. /storage/images/3f2c…-logo.png. Safe to store in *_url columns. */
  url: string;
};

export type ImageDownload = {
  data: Buffer;
  contentType: string;
};

const URL_PREFIX = "/storage/";

const EXTENSION_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

let client: Client | null = null;

function getClient(): Client {
  if (client === null) {
    try {
      client = new Client();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new StorageError(
        `Object storage is not available (${message}). Create a bucket in the App Storage tool, then retry.`,
      );
    }
  }
  return client;
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
  return ext in EXTENSION_TYPES ? ext : "png";
}

function contentTypeFor(objectName: string): string {
  const ext = extensionOf(objectName);
  return EXTENSION_TYPES[ext] ?? "application/octet-stream";
}

/** app URL -> object name, validating the prefix. */
/**
 * Only the exact form `storeImage` generates is a valid storage URL:
 * /storage/images/<uuid>.<known extension>. Anything else — traversal,
 * other prefixes, arbitrary bucket keys — is rejected loudly. This is the
 * single choke point for read/delete, so the /storage/* route cannot be
 * used to fish other objects out of the application bucket.
 */
const OBJECT_NAME_RE = new RegExp(
  `^images/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(?:${Object.keys(EXTENSION_TYPES).join("|")})$`,
);

function objectNameFromUrl(url: string): string {
  if (!url.startsWith(URL_PREFIX)) {
    throw new StorageError(`Not a storage URL: ${url} (expected ${URL_PREFIX}… — external URLs are never stored)`);
  }
  const objectName = url.slice(URL_PREFIX.length);
  if (!OBJECT_NAME_RE.test(objectName)) {
    throw new StorageError(`Not a storage URL: ${url} (only ${URL_PREFIX}images/<uuid>.<ext> is served)`);
  }
  return objectName;
}

/**
 * Store an image and return its stable app URL. The object name embeds a
 * uuid, so names never collide and reveal nothing about the uploader.
 */
export async function storeImage(input: { data: Buffer; filename: string }): Promise<StoredImage> {
  const ext = extensionOf(input.filename);
  const objectName = `images/${randomUUID()}.${ext}`;
  const result = await getClient().uploadFromBytes(objectName, input.data);
  if (!result.ok) {
    throw new StorageError(
      `Image upload failed: ${result.error.message}. If no bucket exists yet, create one in the App Storage tool.`,
    );
  }
  return { url: `${URL_PREFIX}${objectName}` };
}

/** Read an image by its app URL. Throws StorageError when missing. */
export async function readImage(url: string): Promise<ImageDownload> {
  const objectName = objectNameFromUrl(url);
  const result = await getClient().downloadAsBytes(objectName);
  if (!result.ok) {
    throw new StorageError(`Image not found: ${url} (${result.error.message})`);
  }
  const buffer = result.value[0];
  if (!buffer) throw new StorageError(`Image empty: ${url}`);
  return { data: buffer, contentType: contentTypeFor(objectName) };
}

/** Delete an image by its app URL. Missing objects are not an error. */
export async function deleteImage(url: string): Promise<void> {
  const objectName = objectNameFromUrl(url);
  const result = await getClient().delete(objectName, { ignoreNotFound: true });
  if (!result.ok) {
    throw new StorageError(`Image delete failed: ${url} (${result.error.message})`);
  }
}

/** True when the adapter can reach its bucket (used by setup checks). */
export async function isAvailable(): Promise<boolean> {
  try {
    const result = await getClient().list({ prefix: "images/", maxResults: 1 });
    return result.ok;
  } catch {
    return false;
  }
}
