function escapeXml(value: string): string {
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Schema below is verified against the iOS 6.1.3 (build 10B329) `itunesstored`
// binary (iTunesStore.framework). The external-manifest parser reads exactly
// these keys and no others:
//   top level        : items                                    (_parsePropertyList:)
//   each item        : assets, metadata          (initWithExternalManifestDictionary:)
//   metadata dict    : kind, bundle-identifier, bundle-version, title, subtitle
//   each asset dict  : kind, url, needs-shine, md5s, md5-size
// Asset `kind` values it dispatches on: software-package, display-image,
//   full-size-image, newsstand-image, vpn-plugin-package, transit-data.
// Notably ABSENT from the binary: `sizeInBytes`, `platform-identifier` — those
// are silently ignored on this OS, so we don't emit them.

export function buildItmsManifestPlist(params: {
  bundleId: string;
  title: string;
  version: string;
  ipaUrl: string;
  /** 57x57 (ship a 114x114 PNG here for crisp retina placeholders). PNG only. */
  iconUrl?: string | null;
  /** 512x512 PNG. Higher-res source so the placeholder isn't upscaled from 57px. */
  largeIconUrl?: string | null;
  /**
   * Whether SpringBoard should add the glossy shine to the placeholder icon.
   * Set to match the real app: `true` when the IPA's Info.plist does NOT set
   * UIPrerenderedIcon. Otherwise the placeholder looks flat then "pops" glossy
   * after install. (asset key `needs-shine`, read at 0x851be.)
   */
  needsShine?: boolean;
  /** Second line in the install alert. (metadata key `subtitle`, read at 0x84d92.) */
  subtitle?: string | null;
  /**
   * Per-chunk MD5 hashes of the IPA, in order. Lets itunesstored verify the
   * download against `md5-size` byte chunks (asset keys `md5s` + `md5-size`,
   * read at 0x8583a / 0x8584c). Big win for flaky Internet Archive fetches:
   * a truncated/corrupt download fails verification instead of installing
   * broken. Compute server-side by MD5'ing consecutive `md5ChunkSize`-byte
   * chunks of the .ipa. Omit both to skip integrity checking.
   */
  ipaMd5s?: string[] | null;
  /** Chunk size in bytes that each entry of `ipaMd5s` covers. */
  md5ChunkSize?: number | null;
}): string {
  const {
    bundleId,
    title,
    version,
    ipaUrl,
    iconUrl,
    largeIconUrl,
    needsShine = false,
    subtitle,
    ipaMd5s,
    md5ChunkSize,
  } = params;

  const shineTag = needsShine ? '<true/>' : '<false/>';

  const imageAsset = (kind: string, url: string): string =>
    '<dict>'
    + '<key>kind</key><string>' + kind + '</string>'
    + '<key>needs-shine</key>' + shineTag
    + '<key>url</key><string>' + escapeXml(url) + '</string>'
    + '</dict>';

  const header = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">';
  const parts: string[] = [];
  parts.push(header);
  parts.push('<plist version="1.0">');
  parts.push('<dict>');
  parts.push('<key>items</key>');
  parts.push('<array>');
  parts.push('<dict>');
  parts.push('<key>assets</key>');
  parts.push('<array>');
  // software-package (required) — the IPA, optionally integrity-checked
  parts.push('<dict>');
  parts.push('<key>kind</key><string>software-package</string>');
  parts.push('<key>url</key><string>' + escapeXml(ipaUrl) + '</string>');
  if (ipaMd5s && ipaMd5s.length > 0 && typeof md5ChunkSize === 'number' && md5ChunkSize > 0) {
    parts.push('<key>md5-size</key><integer>' + Math.floor(md5ChunkSize) + '</integer>');
    parts.push('<key>md5s</key>');
    parts.push('<array>');
    for (const h of ipaMd5s) {
      parts.push('<string>' + escapeXml(h) + '</string>');
    }
    parts.push('</array>');
  }
  parts.push('</dict>');
  // display-image — the home-screen placeholder icon during download
  if (iconUrl) {
    parts.push(imageAsset('display-image', iconUrl));
  }
  // full-size-image — higher-res source (falls back to the display icon)
  const bigIcon = largeIconUrl || iconUrl;
  if (bigIcon) {
    parts.push(imageAsset('full-size-image', bigIcon));
  }
  parts.push('</array>');
  parts.push('<key>metadata</key>');
  parts.push('<dict>');
  parts.push('<key>bundle-identifier</key><string>' + escapeXml(bundleId) + '</string>');
  parts.push('<key>bundle-version</key><string>' + escapeXml(version || '1.0') + '</string>');
  parts.push('<key>kind</key><string>software</string>');
  parts.push('<key>title</key><string>' + escapeXml(title || bundleId) + '</string>');
  if (subtitle) {
    parts.push('<key>subtitle</key><string>' + escapeXml(subtitle) + '</string>');
  }
  parts.push('</dict>');
  parts.push('</dict>');
  parts.push('</array>');
  parts.push('</dict>');
  parts.push('</plist>');
  return parts.join('');
}


