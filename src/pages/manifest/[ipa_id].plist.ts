import type { APIRoute } from 'astro';
import { buildItmsManifestPlist } from '../../lib/manifest';
import { supabaseFor } from '../../lib/supabase';
import { generateIpaDownloadUrl } from '../../lib/urls';
import { absoluteIconSrc } from '../../lib/icons';
import { appTitleOf } from '../../lib/apps';

export const GET: APIRoute = async (ctx) => {
  try {
    const ipaId = ctx.params.ipa_id;
    if (!ipaId || !/^\d+$/.test(String(ipaId))) {
      return new Response('Not found', { status: 404 });
    }

    const supabase = supabaseFor(ctx);

    const { data: ipa, error } = await supabase
      .from('ipa_files')
      .select(`
        id, filename, info_plist_path, file_size, md5_hash, binary_sha1, available,
        app_version:app_versions!ipa_files_app_version_id_fkey(
          version_string,
          app:apps!app_versions_app_id_fkey(bundle_id, app_store_name, display_name, icon_url)
        ),
        archive_item:archive_items!ipa_files_archive_item_id_fkey(ia_item_id)
      `)
      .eq('id', ipaId)
      .maybeSingle();

    if (error) throw error;

    const version = ipa?.app_version;
    const app = (version as any)?.app;
    if (!ipa || !version || !app) {
      return new Response('Not found', { status: 404 });
    }
    // Dead archive.org copies can't install; don't hand out a manifest for one.
    if ((ipa as any).available === false) {
      return new Response('Not found', { status: 404 });
    }

    const origin = new URL(ctx.request.url).origin;

    // Validate that a real archive.org source exists (else 404 the manifest),
    // but point itunesstored at our own redirector instead of the raw URL. The
    // redirector steers vintage iOS clients to a data node whose TLS they can
    // handshake — archive.org's newer dn### nodes are ECDSA/AES-GCM-only, which
    // iOS 6 can't negotiate, so a direct /download/ URL fails whenever the
    // round-robin lands there. It 302s straight back to archive.org (not a
    // proxy — bytes never transit us). See src/pages/ipa/[id].ts.
    try {
      generateIpaDownloadUrl({
        id: ipa.id,
        filename: ipa.filename,
        info_plist_path: ipa.info_plist_path,
        archive_item: { ia_item_id: (ipa as any).archive_item?.ia_item_id || '' },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
    const ipaUrl = `${origin}/ipa/${ipa.id}`;

    // Icons from this copy's own binary, served same-origin and content-
    // addressed: the native bundle icon as the download placeholder
    // (period-accurate), the iTunesArtwork-derived icon (typically 512px) as
    // the full-size image. Best-effort — the modern CDN icon_url is the
    // fallback, and a manifest without images still installs.
    let displayIconSha: string | null = null;
    let largeIconSha: string | null = null;
    if ((ipa as any).binary_sha1) {
      const { data: bin } = await supabase
        .from('binaries')
        .select('itunes_artwork_sha256, bundle_icon_sha256, hidden')
        .eq('sha1', (ipa as any).binary_sha1)
        .maybeSingle();
      // Quarantined repackage (binaries.hidden — the DB-generated column is the
      // single definition of the quarantine set): never serve an install
      // manifest, no matter how the URL was obtained — the app page hides
      // these, but itms-services URLs are shareable. NULL (unclassified)
      // passes. This lookup is best-effort for icons but load-bearing here: a
      // failed query yields bin=undefined, which fails open by design (same as
      // unclassified) rather than 404ing every install during a DB blip.
      if (bin?.hidden) {
        return new Response('Not found', { status: 404 });
      }
      displayIconSha = bin?.bundle_icon_sha256 || bin?.itunes_artwork_sha256 || null;
      largeIconSha = bin?.itunes_artwork_sha256 || null;
    }

    const versionString = (version as any).version_string || '';
    const fileSize = Number((ipa as any).file_size);
    // Integrity check with data we already have: with the chunk size set to
    // the whole file, md5s is just [md5_hash] — itunesstored then rejects
    // truncated/corrupt archive.org downloads instead of installing them.
    const md5 = String((ipa as any).md5_hash || '');
    const hasMd5 = /^[0-9a-f]{32}$/i.test(md5) && Number.isFinite(fileSize) && fileSize > 0;

    const xml = buildItmsManifestPlist({
      bundleId: app.bundle_id,
      title: appTitleOf(app),
      version: versionString || '1.0',
      ipaUrl,
      iconUrl: displayIconSha
        ? `${origin}/icon/${displayIconSha}`
        : absoluteIconSrc(app.icon_url, origin),
      largeIconUrl: largeIconSha ? `${origin}/icon/${largeIconSha}` : null,
      subtitle: versionString ? `Version ${versionString} · Internet Archive` : 'Internet Archive',
      ipaMd5s: hasMd5 ? [md5.toLowerCase()] : null,
      md5ChunkSize: hasMd5 ? fileSize : null,
      // needsShine stays at its default (false): whether the placeholder
      // should get the gloss depends on the app's UIPrerenderedIcon flag,
      // which the pipeline doesn't extract yet. The raw Info.plists are in
      // R2 (binaries.artifact_key), so this is a backend backfill away.
    });
    return new Response(xml, {
      status: 200,
      headers: {
        'Content-Type': 'text/xml',
        // Manifest content only changes when a row is edited (icon backfills,
        // availability flips) — let the edge absorb repeat installs.
        'Cache-Control': 'public, max-age=600, s-maxage=3600',
      },
    });
  } catch (err) {
    console.error('manifest error:', (err as any)?.message);
    return new Response('Internal error', { status: 500 });
  }
};
