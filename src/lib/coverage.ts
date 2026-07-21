import type { APIContext } from 'astro';
import { supabaseFor } from './supabase';

// Shared core for the public archive-coverage endpoint (/api/coverage).
//
// FairPlay only encrypts the main Mach-O's __TEXT segment — the zip container and
// Info.plist are plaintext even in an encrypted iTunes .ipa. So anyone can read
// CFBundleIdentifier + CFBundleShortVersionString out of their own IPAs with plain
// `unzip` and ask which ones the archive already holds copies of, and in what state,
// so they only spend decrypt/upload effort on the gaps.
//
// A coverage answer is a `copies` map keyed by the archive's real install_status
// vocabulary, e.g. {"installable":3,"encrypted":4}; a version we hold nothing for is
// {}. The map is open-ended — statuses the archive doesn't have are simply absent, and
// any status added later shows up as a new key, so callers should treat unrecognized
// keys gracefully rather than assuming a fixed set. Counts are publicly-available
// copies only; quarantined/hidden binaries are never counted. Backed by the
// coverage_lookup() SECURITY DEFINER RPC; no uploader/PII is reachable.

export interface Probe {
  bundle_id: string;
  version: string;
}

export interface CoverageEntry {
  bundle_id: string;
  version: string;
  copies: Record<string, number>;
}

export const MAX_PROBES = 500;
const BUNDLE_ID_MAX = 300;
const VERSION_MAX = 100;

export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function json(body: unknown, status = 200, cacheControl = 'no-store'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl,
      ...CORS,
    },
  });
}

export function fail(status: number, code: string, message: string, extra?: Record<string, unknown>): Response {
  return json({ error: { code, message, ...extra } }, status);
}

// Trim + length-cap a single probe. Returns null if either field is empty.
export function sanitizeProbe(bundleId: unknown, version: unknown): Probe | null {
  const bundle_id = String(bundleId ?? '').trim().slice(0, BUNDLE_ID_MAX);
  const v = String(version ?? '').trim().slice(0, VERSION_MAX);
  return bundle_id && v ? { bundle_id, version: v } : null;
}

// Strict, order-preserving batch parse. The response is 1:1 with the input, so a
// malformed element can't be silently dropped (that would shift every later result
// off its file) — the whole batch is rejected, naming the offending position.
export function parseBatch(input: unknown): { probes: Probe[] } | { error: Response } {
  if (!Array.isArray(input)) {
    return { error: fail(400, 'invalid_request', 'expected an array of {bundle_id, version} probes') };
  }
  if (input.length === 0) {
    return { error: fail(400, 'invalid_request', 'no probes supplied') };
  }
  if (input.length > MAX_PROBES) {
    return { error: fail(400, 'too_many_probes', `at most ${MAX_PROBES} probes per request`, { limit: MAX_PROBES, received: input.length }) };
  }
  const probes: Probe[] = [];
  for (let i = 0; i < input.length; i++) {
    const probe = sanitizeProbe((input[i] as any)?.bundle_id, (input[i] as any)?.version);
    if (!probe) {
      return { error: fail(400, 'invalid_probe', 'each probe needs a non-empty bundle_id and version', { index: i }) };
    }
    probes.push(probe);
  }
  return { probes };
}

// One PostgREST round trip for the whole batch — the DB does N lookups in a single
// planned query, which beats N HTTP calls for the bulk client. Returns entries 1:1
// with `probes`, in order. Throws on RPC error (callers map to 502).
export async function lookupCoverage(ctx: APIContext, probes: Probe[]): Promise<CoverageEntry[]> {
  const supabase = supabaseFor(ctx);
  const { data, error } = await supabase.rpc('coverage_lookup', { probes });
  if (error) throw new Error(error.message);
  return (data ?? []) as CoverageEntry[];
}
