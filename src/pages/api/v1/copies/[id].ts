import type { APIRoute } from 'astro';
import { supabaseFor } from '../../../../lib/supabase';
import { json, fail, degraded, idStr, CORS, checkParams } from '../../../../lib/api';
import { SITE_ORIGIN as S } from '../../../../lib/http';

// GET /api/v1/copies/{ipa_id} — one archived copy (a mirrored .ipa file) with
// its content-addressed binary. Flat route: ipa_ids are globally unique.
// Quarantined (hidden) binaries and excluded apps 404 — same rule as every
// public surface. Same 3-step lookup as /api/emulator/apps?ipa_id.
export const GET: APIRoute = async (ctx) => {
  const bad = checkParams(ctx.url, []);
  if (bad) return bad;
  const id = ctx.params.id || '';
  if (!/^\d+$/.test(id)) return fail(400, 'invalid_request', 'ipa_id must be a positive integer');
  const supabase = supabaseFor(ctx);

  try {
    const { data: f, error: fe } = await supabase
      .from('ipa_files')
      .select(
        'id, app_version_id, filename, file_size, md5_hash, available, ' +
          'archive_items!ipa_files_archive_item_id_fkey(ia_item_id), ' +
          'binaries!ipa_files_binary_sha1_fkey(sha1, install_status, architectures, macho_min_os, hidden, device_family_macho, has_watch_app, has_extensions, retina_iphone, retina_ipad, bundle_icon_sha256)'
      )
      .eq('id', id)
      .maybeSingle();
    if (fe) throw new Error(fe.message);
    const bin: any = (f as any)?.binaries;
    if (!f || bin?.hidden) return fail(404, 'not_found', 'no such archived copy');

    const { data: version, error: ve } = await supabase
      .from('app_versions')
      .select('version_string, app_id')
      .eq('id', f.app_version_id)
      .maybeSingle();
    if (ve) throw new Error(ve.message);
    const { data: app, error: ae } = version
      ? await supabase.from('apps').select('id, app_store_id, bundle_id, excluded').eq('id', version.app_id).maybeSingle()
      : { data: null, error: null };
    if (ae) throw new Error(ae.message);
    if (app?.excluded) return fail(404, 'not_found', 'no such archived copy');

    const slug = app ? (app.app_store_id && Number(app.app_store_id) !== 0 ? app.app_store_id : app.id) : null;
    return json(
      {
        ipa_id: idStr(f.id),
        filename: f.filename ?? null,
        size: f.file_size != null ? Number(f.file_size) : null,
        md5: f.md5_hash ?? null,
        available: f.available !== false,
        ia_item_id: (f as any).archive_items?.ia_item_id ?? null,
        version: version?.version_string ?? null,
        app_store_id: idStr(app?.app_store_id && Number(app.app_store_id) !== 0 ? app.app_store_id : null),
        bundle_id: app?.bundle_id ?? null,
        binary: bin
          ? {
              sha1: bin.sha1,
              install_status: bin.install_status ?? null,
              architectures: bin.architectures ?? null,
              macho_min_os: bin.macho_min_os ?? null,
              device_family_macho: bin.device_family_macho ?? null,
              has_watch_app: bin.has_watch_app ?? null,
              has_extensions: bin.has_extensions ?? null,
              retina_iphone: bin.retina_iphone ?? null,
              retina_ipad: bin.retina_ipad ?? null,
              icon_url: bin.bundle_icon_sha256 ? `${S}/icon/${bin.bundle_icon_sha256}` : null,
            }
          : null,
        download_url: `${S}/ipa/${f.id}`,
        manifest_url: `${S}/manifest/${f.id}.plist`,
        app_url: slug != null ? `${S}/api/v1/apps/${slug}` : null,
      },
      200,
      3600
    );
  } catch (err) {
    console.error('v1 copy error:', (err as any)?.message);
    return degraded();
  }
};
export const OPTIONS: APIRoute = () => new Response(null, { status: 204, headers: CORS });
