import type { APIRoute } from 'astro';
import { json, CORS } from '../../../lib/api';
import { SITE_ORIGIN as S } from '../../../lib/http';

// GET /api/v1 — the self-describing index. Everything a client needs to start
// without reading docs; the openapi.yaml is the full contract.
const INDEX = {
  service: 'Legacy Store API',
  describe:
    'Open, read-only JSON API over the Legacy Store preservation archive — apps, versions, ' +
    'archived copies, historical App Store charts, reviews, screenshots, collections, and stats. ' +
    'No authentication. Lists are {data, total, next_url}; follow next_url for more. ' +
    'All ids are strings; timestamps are ISO 8601 UTC. Please cache — responses carry long edge TTLs.',
  identifiers:
    'An app {key} is its App Store ID (canonical), bundle_id, or internal id — non-canonical keys 301 to the canonical URL.',
  endpoints: {
    apps: `${S}/api/v1/apps?q={query}&genre={id}&sort={versions|first_date|newest|name}&limit={1-200}`,
    app: `${S}/api/v1/apps/{key}`,
    app_versions: `${S}/api/v1/apps/{key}/versions`,
    app_charts: `${S}/api/v1/apps/{key}/charts`,
    app_ratings: `${S}/api/v1/apps/{key}/ratings`,
    app_reviews: `${S}/api/v1/apps/{key}/reviews`,
    app_screenshots: `${S}/api/v1/apps/{key}/screenshots`,
    app_ids: `${S}/api/v1/apps/ids`,
    copy: `${S}/api/v1/copies/{ipa_id}`,
    charts: `${S}/api/v1/charts?type={slug}&genre={id}&date={YYYY-MM-DD}&device={iphone|ipad}`,
    chart_types: `${S}/api/v1/charts/types`,
    genres: `${S}/api/v1/genres`,
    collections: `${S}/api/v1/collections`,
    collection: `${S}/api/v1/collections/{slug}`,
    stats: `${S}/api/v1/stats`,
    coverage: `${S}/api/v1/coverage (see its own usage doc)`,
  },
  schema: `${S}/openapi.yaml`,
  docs: `${S}/api`,
};

export const GET: APIRoute = () => json(INDEX, 200, 3600);
export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });
