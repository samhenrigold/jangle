import type { APIRoute } from 'astro';

// The API docs moved to /api (the /developers slug collided with the
// /developer/{id} route family). Permanent redirect for old links.
export const GET: APIRoute = () =>
  new Response(null, {
    status: 301,
    headers: { Location: '/api', 'Cache-Control': 'public, max-age=86400' },
  });
