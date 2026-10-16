import type { APIRoute } from 'astro';

// The "Apps for iOS N" pages moved under /collections (2026-10). Permanent
// redirect, keeping ?page=, so old links and search results carry over.
export const GET: APIRoute = ({ params, url }) =>
  new Response(null, {
    status: 301,
    headers: { Location: `/collections/ios-${params.major}${url.search}`, 'Cache-Control': 'public, max-age=86400' },
  });
