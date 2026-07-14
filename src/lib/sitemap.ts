// Shared sitemap plumbing for the index (/sitemap.xml) and its paginated
// children (/sitemap-<n>.xml). The catalog is already past the sitemaps.org
// 50,000-URL / 50 MB per-file limit, so one flat urlset is no longer valid;
// large sites answer this with a sitemap INDEX that points at chunked child
// sitemaps, which is what we emit.

// URLs per child sitemap. Well under the 50k cap, with headroom as the catalog
// grows, and small enough that each child is quick to generate and cache.
export const SITEMAP_CHUNK = 10000;

// PostgREST caps responses at 1000 rows; the fallback pager costs one round trip
// per 1000 apps.
const PAGE = 1000;
const MAX_PAGES = 100; // runaway guard: 100k rows, well above the catalog

// Every app's public URL slug: app_store_id when real (what /app/ links prefer),
// else the internal id. The 0 sentinel is not a real store id. Returned sorted
// so chunk boundaries are stable between the index and each child within a
// deploy (the RPC already sorts; the fallback sorts here).
export async function fetchSitemapSlugs(supabase: any): Promise<string[]> {
  // Preferred path: one RPC round trip returning the whole list as a single
  // json array (a one-row response, so the max-rows cap doesn't apply).
  const { data: slugs, error: rpcError } = await supabase.rpc('get_sitemap_slugs');
  if (!rpcError && Array.isArray(slugs)) return slugs;
  console.error('get_sitemap_slugs rpc failed, falling back to paging:', rpcError?.message);

  const seen = new Set<string>();
  for (let i = 0; i < MAX_PAGES; i++) {
    const from = i * PAGE;
    const { data, error } = await supabase
      .from('apps')
      .select('id, app_store_id')
      .not('excluded', 'is', true)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`sitemap query failed: ${error.message}`);
    const rows = data || [];
    for (const a of rows) seen.add(String(a.app_store_id || a.id));
    if (rows.length < PAGE) break;
  }
  return Array.from(seen).sort();
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
export const SITEMAP_HEADERS = {
  'Content-Type': 'application/xml',
  'Cache-Control': 'public, max-age=3600, s-maxage=86400',
};
