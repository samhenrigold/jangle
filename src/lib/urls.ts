const urlCache = new Map<string, string>();

type ArchiveItemRef = { ia_item_id: string };
type MinimalIpa = {
  id: number | string;
  filename: string;
  info_plist_path?: string | null;
  archive_item: ArchiveItemRef;
};

// The direct .ipa URL for an archived copy. info_plist_path is the strongest
// signal — it embeds the path of the .ipa it was read out of (absolute on 10
// known rows; protocol-relative in the canonical shape). Anything else falls
// back to the archive.org item + filename. Throws when no source is usable.
export function generateIpaDownloadUrl(ipaFile: MinimalIpa): string {
  const cacheKey = `${ipaFile.id}-${ipaFile.info_plist_path || ipaFile.filename}`;
  const cached = urlCache.get(cacheKey);
  if (cached) return cached;

  const base = ipaFile.info_plist_path?.match(/^(.+\.ipa)\//)?.[1];
  let url: string | null = null;
  if (base && /^https?:\/\//i.test(base)) {
    url = base; // already absolute
  } else if (base && base.startsWith('//')) {
    url = `https:${base}`; // protocol-relative (canonical shape)
  } else if (ipaFile.archive_item.ia_item_id) {
    url = `https://archive.org/download/${ipaFile.archive_item.ia_item_id}/${encodeURIComponent(ipaFile.filename)}`;
  }
  if (!url) throw new Error('no source for ipa url');

  urlCache.set(cacheKey, url);
  return url;
}
