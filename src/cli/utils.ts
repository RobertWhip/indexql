import * as fs   from 'fs';
import * as path from 'path';
import { ArtifactFile } from '../core/types';

// Re-export formatting utilities so existing consumers don't break
export { log, fmtBytes, fmtMs } from '../fmt';

// ── Hashing ───────────────────────────────────────────────────────────────────

/**
 * Compute a deterministic 64-bit hex hash of a string.
 * Uses two independent FNV-1a passes for a 64-bit result.
 */
export function hashString(input: string): string {
  const buf = Buffer.from(input, 'utf8');
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < buf.length; i++) {
    h1 = Math.imul(h1 ^ buf[i], 0x01000193);
    h2 = Math.imul(h2 ^ buf[i], 0x01000193) ^ (i & 0xff);
  }
  const lo = (h1 >>> 0).toString(16).padStart(8, '0');
  const hi = (h2 >>> 0).toString(16).padStart(8, '0');
  return lo + hi;
}

// ── File I/O ──────────────────────────────────────────────────────────────────

/** Write a Buffer to a binary file; returns ArtifactFile metadata. */
export function writeBinaryArtifact(
  dir: string,
  filename: string,
  data: Buffer,
  count?: number
): ArtifactFile {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, data);
  return {
    name:      filename,
    hash:      hashString(data.toString('base64')),
    sizeBytes: data.byteLength,
    ...(count !== undefined && { count }),
  };
}

/** Write a JSON-serializable value to a file; returns ArtifactFile metadata. */
export function writeJsonArtifact(
  dir: string,
  filename: string,
  value: unknown,
  count?: number
): ArtifactFile {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  const json = JSON.stringify(value);
  fs.writeFileSync(filePath, json, 'utf8');
  return {
    name:      filename,
    hash:      hashString(json),
    sizeBytes: Buffer.byteLength(json, 'utf8'),
    ...(count !== undefined && { count }),
  };
}

/** Read and parse a JSON file. */
export function readJson<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

/** Check whether a file exists. */
export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}
