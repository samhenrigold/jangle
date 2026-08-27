import type { APIRoute } from 'astro';
import { supabaseFor } from '../../../../lib/supabase';
import { json, fail, degraded, appSummary, iso, CORS, checkParams } from '../../../../lib/api';
import { fetchCollection, fetchCollectionMembers } from '../../../../lib/collections';
import { flattenAppRow } from '../../../../lib/apps';

// GET /api/v1/collections/{slug} — one collection with its members in curated
// order. Members without an archived app (curator-listed ghosts) carry
// app: null but keep their label/blurb — the curation is data too.
export const GET: APIRoute = async (ctx) => {
  const bad = checkParams(ctx.url, []);
  if (bad) return bad;
  const supabase = supabaseFor(ctx);
  const { collection, dbError } = await fetchCollection(supabase, ctx.params.slug || '');
  if (dbError) return degraded();
  if (!collection) return fail(404, 'not_found', `no collection "${ctx.params.slug}" (or it is unpublished)`);

  const { data: members, error } = await fetchCollectionMembers(supabase, collection.id);
  if (error) return degraded();

  const data = (members || [])
    .filter((m: any) => m.metadata?.kind !== 'media') // media blocks are page furniture, not members
    .map((m: any) => ({
      position: m.position,
      group: m.group_label ?? null,
      label: m.label ?? null,
      blurb: m.blurb ?? null,
      pinned_version: m.app_versions?.version_string ?? null,
      pinned_version_date: iso(m.app_versions?.release_date || m.app_versions?.estimated_release_date),
      app: m.apps ? appSummary(flattenAppRow(m.apps)) : null,
    }));

  return json(
    {
      slug: collection.slug,
      title: collection.title ?? null,
      subtitle: collection.subtitle ?? null,
      description: collection.description ?? null,
      members: data,
    },
    200,
    3600
  );
};
export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });
