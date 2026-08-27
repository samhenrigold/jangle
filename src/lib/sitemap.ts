// Shared sitemap plumbing for the index (/sitemap.xml) and its paginated
// children (/sitemap-<n>.xml). The catalog is already past the sitemaps.org
// 50,000-URL / 50 MB per-file limit, so one flat urlset is no longer valid;
// large sites answer this with a sitemap INDEX that points at chunked child
// sitemaps, which is what we emit.

// URLs per child sitemap. Well under the 50k cap, with headroom as the catalog
// grows, and small enough that each child is quick to generate and cache.
export const SITEMAP_CHUNK = 10000;

// Every app's public URL slug: app_store_id when real (what /app/ links prefer),
// else the internal id. The 0 sentinel is not a real store id. One RPC round
// trip returning the whole sorted list as a single json array (a one-row
// response, so the max-rows cap doesn't apply). A failure throws — the edge
// serves the last good copy via stale-if-error rather than a wrong sitemap.
export async function fetchSitemapSlugs(supabase: any): Promise<string[]> {
  const { data: slugs, error } = await supabase.rpc('get_sitemap_slugs');
  if (error || !Array.isArray(slugs)) throw new Error(`get_sitemap_slugs failed: ${error?.message}`);
  return slugs;
}

// Published collections (RLS hides drafts under the anon key). Best-effort: a
// failure here shouldn't take the sitemap down. These ride in the first child
// sitemap alongside the /collections landing — a sitemapindex can only hold
// <sitemap> entries, so the collection <url>s can't live in the index itself.
export async function fetchCollectionSlugs(supabase: any): Promise<string[]> {
  const { data, error } = await supabase.from('collections').select('slug');
  if (error) {
    console.error('sitemap collections query failed:', error.message);
    return [];
  }
  return (data || []).map((c: any) => c.slug);
}

// Shared cache headers for every sitemap response (browser-short, edge-long).
// Split headers, not s-maxage — s-maxage disables stale-while-revalidate /
// stale-if-error at the shared cache (RFC 9111 §4.2.4; see lib/http.ts), and
// the sitemap relies on stale-if-error to survive an RPC blip.
const STALE = 'stale-while-revalidate=86400, stale-if-error=604800';
export const SITEMAP_HEADERS = {
  'Content-Type': 'application/xml',
  'Cache-Control': `public, max-age=3600, ${STALE}`,
  'Cloudflare-CDN-Cache-Control': `public, max-age=86400, ${STALE}`,
};
