import type { APIRoute } from 'astro';
import { buildItmsManifestPlist } from '../../lib/manifest';
import { supabaseFor } from '../../lib/supabase';
import { generateIpaDownloadUrl } from '../../lib/urls';
import { absoluteIconSrc } from '../../lib/icons';

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
        id, filename, info_plist_path,
        app_version:app_versions!ipa_files_app_version_id_fkey(
          version_string,
          app:apps!app_versions_app_id_fkey(bundle_id, display_name, icon_url)
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

    const xml = buildItmsManifestPlist({
      bundleId: app.bundle_id,
      title: app.display_name || app.bundle_id,
      version: (version as any).version_string || '1.0',
      ipaUrl: ipaUrl,
      iconUrl: absoluteIconSrc(app.icon_url, new URL(ctx.request.url).origin),
    });
    return new Response(xml, {
      status: 200,
      headers: {
        'Content-Type': 'text/xml',
        'Cache-Control': 'public, max-age=600',
      },
    });
  } catch (err) {
    console.error('manifest error:', (err as any)?.message);
    return new Response('Internal error', { status: 500 });
  }
};


