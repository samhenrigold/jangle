import type { APIRoute } from 'astro';

// Bare /api is a person typing, not a client — send them to the docs.
export const GET: APIRoute = () =>
  new Response(null, {
    status: 301,
    headers: { Location: '/developers', 'Cache-Control': 'public, max-age=86400' },
  });
