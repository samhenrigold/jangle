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
        id, filename, info_plist_path, file_size, binary_sha1,
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

    let ipaUrl: string;
    try {
      ipaUrl = generateIpaDownloadUrl({
        id: ipa.id,
        filename: ipa.filename,
        info_plist_path: ipa.info_plist_path,
        archive_item: { ia_item_id: (ipa as any).archive_item?.ia_item_id || '' },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }

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
        .select('icon_sha256, bundle_icon_sha256')
        .eq('sha1', (ipa as any).binary_sha1)
        .maybeSingle();
      displayIconSha = bin?.bundle_icon_sha256 || bin?.icon_sha256 || null;
      largeIconSha = bin?.icon_sha256 || null;
    }

    const origin = new URL(ctx.request.url).origin;
    const versionString = (version as any).version_string || '';
    const fileSize = Number((ipa as any).file_size);

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
      sizeInBytes: Number.isFinite(fileSize) && fileSize > 0 ? fileSize : null,
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
