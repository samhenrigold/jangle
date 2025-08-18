import type { APIRoute } from 'astro';
import plist from 'plist';
import { getSupabaseClient } from '../../lib/supabase';
import { generateIpaDownloadUrl } from '../../lib/urls';

export const GET: APIRoute = async (ctx) => {
  try {
    const ipaId = ctx.params.ipa_id;
    if (!ipaId) {
      return new Response('Missing ipa_id', { status: 400 });
    }

    const supabase = getSupabaseClient(ctx.locals?.runtime?.env as any);

    const { data: ipa } = await supabase
      .from('ipa_files')
      .select('id, filename, info_plist_path, archive_item_id, app_version_id')
      .eq('id', ipaId)
      .single();
    if (!ipa) return new Response('IPA not found', { status: 404 });

    const { data: version } = await supabase
      .from('app_versions')
      .select('id, app_id, version_string')
      .eq('id', ipa.app_version_id)
      .single();
    if (!version) return new Response('Version not found', { status: 404 });

    const { data: app } = await supabase
      .from('apps')
      .select('bundle_id, display_name, icon_url')
      .eq('id', version.app_id)
      .single();
    if (!app) return new Response('App not found', { status: 404 });

    // Build full upstream IPA URL
    let iaItemId: string | undefined;
    if (ipa.archive_item_id) {
      const { data: item } = await supabase
        .from('archive_items')
        .select('ia_item_id')
        .eq('id', ipa.archive_item_id)
        .single();
      iaItemId = item?.ia_item_id as string | undefined;
    }
    const ipaUrl = generateIpaDownloadUrl({
      id: ipa.id,
      filename: ipa.filename,
      info_plist_path: ipa.info_plist_path,
      archive_item: { ia_item_id: iaItemId || '' },
    });

    const manifest = {
      items: [
        {
          assets: [
            { kind: 'software-package', url: ipaUrl },
            app.icon_url
              ? { kind: 'display-image', 'needs-shine': false, url: app.icon_url }
              : undefined,
          ].filter(Boolean),
          metadata: {
            'bundle-identifier': app.bundle_id,
            'bundle-version': version.version_string || '1.0',
            kind: 'software',
            title: app.display_name || app.bundle_id,
          },
        },
      ],
    } as any;

    const xml = plist.build(manifest);
    return new Response(xml, {
      status: 200,
      headers: {
        'Content-Type': 'text/xml',
        'Cache-Control': 'public, max-age=600',
      },
    });
  } catch (err: any) {
    return new Response(err?.message || 'Error', { status: 500 });
  }
};


