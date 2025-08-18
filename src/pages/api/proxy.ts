import type { APIRoute } from 'astro';
import { getSupabaseClient } from '../../lib/supabase';

// Minimal streaming proxy for IPA downloads. Helps with TLS shimming and CORS.
export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const ipaId = url.searchParams.get('ipa_id');
    if (!ipaId) return new Response('Missing ipa_id', { status: 400 });

    const supabase = getSupabaseClient();
    const { data: ipa } = await supabase
      .from('ipa_files')
      .select('id, filename')
      .eq('id', ipaId)
      .single();

    if (!ipa) return new Response('IPA not found', { status: 404 });

    // filename should be a full URL to Internet Archive
    const upstream = await fetch(ipa.filename, {
      redirect: 'follow',
      // Old iOS SNI/TLS: if terminating TLS at your own origin, this endpoint helps.
      // Further adjustments may require an edge or custom CDN with TLS v1.0/weak ciphers.
    });
    if (!upstream.ok || !upstream.body) {
      return new Response('Upstream error', { status: 502 });
    }

    const headers = new Headers();
    headers.set('Content-Type', upstream.headers.get('Content-Type') || 'application/octet-stream');
    const disp = upstream.headers.get('Content-Disposition');
    if (disp) headers.set('Content-Disposition', disp);
    headers.set('Cache-Control', 'public, max-age=3600');

    return new Response(upstream.body, {
      status: 200,
      headers,
    });
  } catch (err: any) {
    return new Response(err?.message || 'Error', { status: 500 });
  }
};


