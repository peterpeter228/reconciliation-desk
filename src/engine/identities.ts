import { sha256 as sha256Bytes } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
/** Unambiguous namespaces. Never compare raw batch/payment/deposit values across kinds. */
export function typedIdentity(
  company: string,
  system: string,
  kind: string,
  value: string,
): string {
  return JSON.stringify([company, system, kind, value]);
}
export function stableJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(',')}]`;
  return `{${Object.keys(value as object)
    .sort()
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableJSON((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}
/** Content integrity only: approval identity/authentication is a separate workflow. */
export function sha256(text: string): string {
  return bytesToHex(sha256Bytes(new TextEncoder().encode(text)));
}
export function contentHash(value: unknown): string {
  return sha256(stableJSON(value));
}
