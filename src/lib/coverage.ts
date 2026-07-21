import type { APIContext } from 'astro';
import { supabaseFor } from './supabase';

// Shared core for the public archive-coverage endpoint (/api/coverage).
//
// FairPlay only encrypts the main Mach-O's __TEXT segment, so the plists inside a
// downloaded .ipa stay readable even while the binary is encrypted. From Info.plist
// and (for iTunes downloads) iTunesMetadata.plist a caller can cheaply pull up to four
// identifiers and ask which of their files the archive already holds copies of, in what
// state — so they only spend decrypt/upload effort on the gaps.
//
// A probe carries any subset of these — iTunes downloads may have all, some, or none —
// and is matched by the strongest identifiers present:
//   bundle_id     CFBundleIdentifier / softwareVersionBundleId
//   app_store_id  itemId (iTunesMetadata.plist)
//   version       CFBundleShortVersionString / bundleShortVersionString
//   external_id   softwareVersionExternalIdentifier (iTunesMetadata.plist) — the precise,
//                 per-build App Store version id
//
// A version is locatable iff the probe has an external_id, OR a version plus an app key
// (bundle_id or app_store_id) to disambiguate it (version strings alone aren't unique).
//
// The answer is a `copies` map keyed by the archive's real install_status vocabulary,
// e.g. {"installable":3,"encrypted":4}; nothing matched -> {}. The map is open-ended:
// statuses the archive doesn't have are simply absent, and any status added later shows
// up as a new key, so treat unrecognized keys gracefully. Counts are publicly-available
// copies only — quarantined/hidden binaries are never counted, so a clean dump of
// something the archive only holds a modified copy of still reads as a gap. Backed by
// the coverage_lookup() SECURITY DEFINER RPC; no uploader/PII is reachable.

export interface Probe {
  bundle_id?: string;
  version?: string;
  external_id?: number;
  app_store_id?: number;
}

export interface CoverageEntry {
  bundle_id: string | null;
  version: string | null;
  external_id: number | null;
  app_store_id: number | null;
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
      // Open data meant for programmatic use, not SERPs — keep JSON responses out
      // of search indexes regardless of what a crawler does with robots.txt.
      'X-Robots-Tag': 'noindex',
      ...CORS,
    },
  });
}

export function fail(status: number, code: string, message: string, extra?: Record<string, unknown>): Response {
  return json({ error: { code, message, ...extra } }, status);
}

const NEEDS_IDENTIFIER = 'each probe needs an external_id, or a version plus a bundle_id or app_store_id';

function str(value: unknown, max: number): string | undefined {
  const s = String(value ?? '').trim().slice(0, max);
  return s || undefined;
}

// App Store ids and external version ids are positive integers; anything else is dropped
// so a stray value can't reach the bigint cast in the RPC.
function posInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER ? n : undefined;
}

// A probe can locate a version iff it has an external id, or a marketing version plus an
// app key (bundle id or store id) to disambiguate it.
export function usable(p: Probe): boolean {
  return (
    p.external_id !== undefined ||
    (p.version !== undefined && (p.bundle_id !== undefined || p.app_store_id !== undefined))
  );
}

// Coerce + trim any identifier subset into a clean Probe (undefined keys stripped so the
// JSON handed to Postgres carries only what was supplied). Returns null if not locatable.
export function toProbe(raw: {
  bundle_id?: unknown;
  version?: unknown;
  external_id?: unknown;
  app_store_id?: unknown;
}): Probe | null {
  const p: Probe = {
    bundle_id: str(raw.bundle_id, BUNDLE_ID_MAX),
    version: str(raw.version, VERSION_MAX),
    external_id: posInt(raw.external_id),
    app_store_id: posInt(raw.app_store_id),
  };
  for (const k of Object.keys(p) as (keyof Probe)[]) {
    if (p[k] === undefined) delete p[k];
  }
  return usable(p) ? p : null;
}

// Strict, order-preserving batch parse. The response is 1:1 with the input, so a probe
// that can't locate a version can't be silently dropped (that would shift every later
// result off its file) — the whole batch is rejected, naming the offending position.
export function parseBatch(input: unknown): { probes: Probe[] } | { error: Response } {
  if (!Array.isArray(input)) {
    return { error: fail(400, 'invalid_request', 'expected an array of identifier probes') };
  }
  if (input.length === 0) {
    return { error: fail(400, 'invalid_request', 'no probes supplied') };
  }
  if (input.length > MAX_PROBES) {
    return { error: fail(400, 'too_many_probes', `at most ${MAX_PROBES} probes per request`, { limit: MAX_PROBES, received: input.length }) };
  }
  const probes: Probe[] = [];
  for (let i = 0; i < input.length; i++) {
    const probe = toProbe((input[i] ?? {}) as any);
    if (!probe) {
      return { error: fail(400, 'invalid_probe', NEEDS_IDENTIFIER, { index: i }) };
    }
    probes.push(probe);
  }
  return { probes };
}

export const INVALID_SINGLE = NEEDS_IDENTIFIER;

// One PostgREST round trip for the whole batch — the DB does N lookups in a single
// planned query, which beats N HTTP calls for the bulk client. Returns entries 1:1
// with `probes`, in order. Throws on RPC error (callers map to 502).
export async function lookupCoverage(ctx: APIContext, probes: Probe[]): Promise<CoverageEntry[]> {
  const supabase = supabaseFor(ctx);
  const { data, error } = await supabase.rpc('coverage_lookup', { probes });
  if (error) throw new Error(error.message);
  return (data ?? []) as CoverageEntry[];
}
