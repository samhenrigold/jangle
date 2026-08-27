import { cacheGet, cacheSet, cached } from './cache';

// Shared collection loaders — used by the /collections pages AND /api/v1/collections
// (function-layer dogfooding: one query, one filter set, two presentations).

// Published collections (RLS hides drafts) with members embedded — editorial-
// scale (dozens of rows), one round trip. Members are pre-filtered to
// non-excluded apps and sorted by position.
export async function fetchCollectionsWithMembers(supabase: any): Promise<{ data: any[] | null; error: any }> {
  return cached<any[]>('collections_index_v2', 10 * 60 * 1000, async () => {
    const { data, error } = await supabase
      .from('collections')
      .select('slug, title, subtitle, series, sort_order, collection_members(position, apps!collection_members_app_id_fkey(rep_icon_sha256, oldest_icon_sha256, icon_url:live_icon_url, excluded))')
      .order('sort_order', { ascending: true, nullsFirst: false });
    if (error) return { data: null, error };
    return {
      data: (data || []).map((c: any) => ({
        ...c,
        collection_members: (c.collection_members || [])
          .filter((m: any) => m.apps && !m.apps.excluded)
          .sort((x: any, y: any) => x.position - y.position),
      })),
      error: null,
    };
  });
}

// Resolve one collection by slug. maybeSingle distinguishes "no such
// collection" (which under RLS also covers unpublished drafts → 404) from a
// transient DB failure (degraded) — a blip must not become a cached 404, so
// only found rows cache.
export async function fetchCollection(supabase: any, slug: string): Promise<{ collection: any | null; dbError: boolean }> {
  const key = `collection:${slug}`;
  const hit = cacheGet<any>(key);
  if (hit) return { collection: hit, dbError: false };
  const { data, error } = await supabase
    .from('collections')
    .select('id, slug, title, subtitle, description')
    .eq('slug', slug)
    .maybeSingle();
  if (error) {
    console.error('collection fetch failed:', error.message);
    return { collection: null, dbError: true };
  }
  if (data) cacheSet(key, data, 10 * 60 * 1000);
  return { collection: data, dbError: false };
}

// Members in curated order with app (and optional pinned version) embedded;
// excluded apps dropped (ghost members with no app row are kept — the curator
// listed them on purpose).
export async function fetchCollectionMembers(supabase: any, collectionId: number): Promise<{ data: any[] | null; error: any }> {
  return cached<any[]>(`collection_members:v2:${collectionId}`, 10 * 60 * 1000, async () => {
    const { data, error } = await supabase
      .from('collection_members')
      .select('position, group_label, label, blurb, metadata, app_versions!collection_members_app_version_id_fkey(version_string, release_date, estimated_release_date), apps!collection_members_app_id_fkey(id, app_store_id, bundle_id, app_store_name, display_name, version_count, rep_icon_sha256, oldest_icon_sha256, excluded, icon_url:live_icon_url, developers!apps_developer_id_fkey(artist_name))')
      .eq('collection_id', collectionId)
      .order('position', { ascending: true });
    return { data: error ? null : (data || []).filter((m: any) => !m.apps || !m.apps.excluded), error };
  });
}
