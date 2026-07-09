const urlCache = new Map<string, string>();

type ArchiveItemRef = { ia_item_id: string };
type MinimalIpa = {
  id: number | string;
  filename: string;
  info_plist_path?: string | null;
  archive_item: ArchiveItemRef;
};

export function generateIpaDownloadUrl(ipaFile: MinimalIpa): string {
  const cacheKey = `${ipaFile.id}-${ipaFile.info_plist_path || ipaFile.filename}`;

  const cached = urlCache.get(cacheKey);
  if (cached) return cached;

  let url: string;

  if (ipaFile.info_plist_path) {
    const match = ipaFile.info_plist_path.match(/^(.+\.ipa)\//);
    if (match) {
      const base = match[1];
      if (/^https?:\/\//i.test(base)) {
        url = base;                    // already absolute (10 known rows)
      } else if (base.startsWith('//')) {
        url = `https:${base}`;         // protocol-relative (canonical shape)
      } else {
        url = `https://archive.org/download/${ipaFile.archive_item.ia_item_id}/${encodeURIComponent(ipaFile.filename)}`;
      }
    } else if (ipaFile.archive_item.ia_item_id) {
      url = `https://archive.org/download/${ipaFile.archive_item.ia_item_id}/${encodeURIComponent(ipaFile.filename)}`;
    } else {
      throw new Error('no source for ipa url');
    }
  } else if (ipaFile.archive_item.ia_item_id) {
    url = `https://archive.org/download/${ipaFile.archive_item.ia_item_id}/${encodeURIComponent(ipaFile.filename)}`;
  } else {
    throw new Error('no source for ipa url');
  }

  urlCache.set(cacheKey, url);
  return url;
}


