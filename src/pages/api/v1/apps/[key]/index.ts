import type { APIRoute } from 'astro';
import { supabaseFor } from '../../../../../lib/supabase';
import { json, degraded, resolveAppOr404, appSummary, idStr, iso, CORS, checkParams } from '../../../../../lib/api';
import { fetchAppCore } from '../../../../../lib/apps';
import { serializeVersions } from '../../../../../lib/v1versions';
import { SITE_ORIGIN as S } from '../../../../../lib/http';

// GET /api/v1/apps/{key} — one app with its full version/copy tree. The same
// loaders and quarantine filtering as the site's app page (function-layer
// dogfooding); raw-vs-derived layering surfaces as release_date (trusted,
// with release_date_source) vs estimated_release_date.
export const GET: APIRoute = async (ctx) => {
  const bad = checkParams(ctx.url, []);
  if (bad) return bad;
  const resolved = await resolveAppOr404(ctx);
  if ('response' in resolved) return resolved.response;
  const app = resolved.app;

  const core = await fetchAppCore(supabaseFor(ctx), Number(app.id));
  if (core.error) return degraded();
  const versions = serializeVersions(core);
  const slug = app.app_store_id && Number(app.app_store_id) !== 0 ? app.app_store_id : app.id;

  return json(
    {
      ...appSummary(app),
      version_count: versions.length, // resolveApp's row doesn't carry the precomputed count; the loaded tree is authoritative here
      display_name: app.display_name ?? null,
      copyright: app.copyright ?? null,
      developer_artist_id: idStr(app.developers?.artist_id),
      genre: app.genres?.genre_name ?? null,
      original_release_date: iso(app.original_release_date),
      original_release_date_source: app.original_release_date_source ?? null,
      catalog_only: !!app.excluded, // catalog-seed stubs: listing metadata, no archived binary
      versions,
      links: {
        versions: `${S}/api/v1/apps/${slug}/versions`,
        charts: `${S}/api/v1/apps/${slug}/charts`,
        ratings: `${S}/api/v1/apps/${slug}/ratings`,
        reviews: `${S}/api/v1/apps/${slug}/reviews`,
        screenshots: `${S}/api/v1/apps/${slug}/screenshots`,
      },
    },
    200,
    900
  );
};
export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });
