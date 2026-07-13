import type { APIRoute } from 'astro';
import { supabaseFor } from '../../lib/supabase';
import { generateIpaDownloadUrl } from '../../lib/urls';
import { resolveCompatibleNodeUrl } from '../../lib/archiveNode';

// OTA-install byte source. The manifest's `software-package` points here rather
// than straight at archive.org so we can steer vintage clients (iOS 6
// itunesstored) to a data node whose TLS they can actually handshake — the
// newer dn### nodes are ECDSA/AES-GCM-only, which iOS 6 can't negotiate. See
// src/lib/archiveNode.ts for the why.
//
// This is a 302 redirect, NOT a proxy: the .ipa flows archive.org → device and
// never transits our infra. Same liability posture as linking (we already hand
// out archive.org URLs); near-zero cost (no streaming, no egress). Falls back to
// the plain download URL for items with no compatible node so behaviour is never
// worse than pointing straight at archive.org.
export const GET: APIRoute = async (ctx) => {
  try {
    const id = ctx.params.id;
    if (!id || !/^\d+$/.test(String(id))) {
      return new Response('Not found', { status: 404 });
    }

    const supabase = supabaseFor(ctx);
    const { data: ipa, error } = await supabase
      .from('ipa_files')
      .select(
        'id, filename, info_plist_path, binary_sha1, available, archive_item:archive_items!ipa_files_archive_item_id_fkey(ia_item_id)'
      )
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!ipa) return new Response('Not found', { status: 404 });
    // Dead archive.org copy — nothing to hand out (mirrors the manifest route).
    if ((ipa as any).available === false) {
      return new Response('Not found', { status: 404 });
    }

    // Quarantined repackage (binaries.hidden generated column): the manifest
    // route refuses these and this URL is just as shareable, so refuse here too.
    // Same fail-open-on-DB-blip logic — an errored/absent lookup leaves `bin`
    // undefined and passes (treated as unclassified), rather than 404ing every
    // install during a transient DB issue.
    if ((ipa as any).binary_sha1) {
      const { data: bin } = await supabase
        .from('binaries')
        .select('hidden')
        .eq('sha1', (ipa as any).binary_sha1)
        .maybeSingle();
      if (bin?.hidden) return new Response('Not found', { status: 404 });
    }

    // The plain archive.org URL — always valid, and the fallback when the item
    // has no iOS-6-compatible node (fully migrated to dn###) or metadata is
    // unreachable. Non-vintage clients handle it fine.
    let target: string;
    try {
      target = generateIpaDownloadUrl({
        id: (ipa as any).id,
        filename: (ipa as any).filename,
        info_plist_path: (ipa as any).info_plist_path,
        archive_item: { ia_item_id: (ipa as any).archive_item?.ia_item_id || '' },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }

    // Steer to a TLS-compatible node when the item still has one.
    const item = (ipa as any).archive_item?.ia_item_id as string | undefined;
    const filename = (ipa as any).filename as string | undefined;
    if (item && filename) {
      const nodeUrl = await resolveCompatibleNodeUrl(item, filename, Number((ipa as any).id) || 0);
      if (nodeUrl) target = nodeUrl;
    }

    return new Response(null, {
      status: 302,
      headers: {
        Location: target,
        // Let the edge/client cache the redirect briefly — bounds IA metadata
        // load and keeps OTA retries snappy — but short enough that node health
        // (workable_servers) stays fresh enough to fail over.
        'Cache-Control': 'public, max-age=900',
      },
    });
  } catch (err) {
    console.error('ipa redirect error:', (err as any)?.message);
    return new Response('Internal error', { status: 500 });
  }
};
