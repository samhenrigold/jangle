type ArchiveItemRef = { ia_item_id: string };
type MinimalIpa = {
  id: number | string;
  filename: string;
  info_plist_path?: string | null;
  archive_item: ArchiveItemRef;
};

// A download URL is only usable if it points at archive.org — this URL becomes
// a 302 an iOS device follows to install a signed package. info_plist_path is
// trusted DB data today, but constrain it anyway: the blast radius of a tainted
// absolute URL here is an install redirect to an attacker host.
function isArchiveOrgUrl(u: string): boolean {
  try { return new URL(u).hostname.toLowerCase().endsWith('.archive.org') || new URL(u).hostname.toLowerCase() === 'archive.org'; }
  catch { return false; }
}

// The direct .ipa URL for an archived copy. info_plist_path is the strongest
// signal — it embeds the path of the .ipa it was read out of (absolute on 10
// known rows; protocol-relative in the canonical shape). Anything else falls
// back to the archive.org item + filename. Throws when no source is usable.
export function generateIpaDownloadUrl(ipaFile: MinimalIpa): string {
  const base = ipaFile.info_plist_path?.match(/^(.+\.ipa)\//)?.[1];
  if (base && /^https?:\/\//i.test(base) && isArchiveOrgUrl(base)) return base; // already absolute
  if (base && base.startsWith('//') && isArchiveOrgUrl(`https:${base}`)) return `https:${base}`; // protocol-relative (canonical shape)
  if (ipaFile.archive_item.ia_item_id) {
    return `https://archive.org/download/${ipaFile.archive_item.ia_item_id}/${encodeURIComponent(ipaFile.filename)}`;
  }
  throw new Error('no source for ipa url');
}
