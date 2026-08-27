import { partitionCopies } from './appdetail';
import { sortVersions } from './sorting';
import { idStr, iso } from './api';
import { SITE_ORIGIN as S } from './http';

// The v1 API's version/copy serialization, shared by /apps/{key} and
// /apps/{key}/versions. Same quarantine/availability filtering as the app
// page (partitionCopies drops hidden binaries and counts unavailable copies);
// newest first, version-string interpolation for undated rows (sortVersions).
export function serializeVersions(core: {
  versions: any[];
  ipaFiles: any[];
  binariesBySha1: Map<string, any>;
}): any[] {
  const { filesByVersionId, unavailableCountByVersion } = partitionCopies(core.ipaFiles, core.binariesBySha1);
  const sorted = sortVersions(core.versions, 'desc', (v: any) => v.release_date || v.estimated_release_date);
  return sorted.map((v: any) => {
    const files = filesByVersionId.get(v.id) || [];
    return {
      version: v.version_string ?? null,
      build_number: v.build_number ?? null,
      release_date: iso(v.release_date),
      estimated_release_date: iso(v.estimated_release_date),
      minimum_os_version: v.minimum_os_version ?? null,
      device_family: v.device_family ?? null,
      external_identifier: idStr(v.external_identifier),
      unavailable_copies: unavailableCountByVersion.get(v.id) || 0,
      copies: files.map((f: any) => {
        const bin = f.binaries || null;
        return {
          ipa_id: idStr(f.id),
          filename: f.filename ?? null,
          size: f.file_size != null ? Number(f.file_size) : null,
          md5: f.md5_hash ?? null,
          ia_item_id: f.archive_items?.ia_item_id ?? null,
          sha1: bin?.sha1 ?? null,
          install_status: bin?.install_status ?? null,
          architectures: bin?.architectures ?? null,
          macho_min_os: bin?.macho_min_os ?? null,
          url: `${S}/api/v1/copies/${f.id}`,
          download_url: `${S}/ipa/${f.id}`,
          manifest_url: `${S}/manifest/${f.id}.plist`,
        };
      }),
    };
  });
}
