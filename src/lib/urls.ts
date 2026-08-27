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
  const base = ipaFile.info_plist_path?.match(/^(.+\.ipa)\//)?.[1];
  if (base && /^https?:\/\//i.test(base)) return base; // already absolute
  if (base && base.startsWith('//')) return `https:${base}`; // protocol-relative (canonical shape)
  if (ipaFile.archive_item.ia_item_id) {
    return `https://archive.org/download/${ipaFile.archive_item.ia_item_id}/${encodeURIComponent(ipaFile.filename)}`;
  }
  throw new Error('no source for ipa url');
}
