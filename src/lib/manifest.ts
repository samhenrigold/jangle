function escapeXml(value: string): string {
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

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
   * Whether SpringBoard should add the glossy shine to the placeholder.
   * Set this to match the real app: `true` when the IPA's Info.plist does NOT
   * set UIPrerenderedIcon (or sets it false). Otherwise the placeholder looks
   * flat and "pops" glossy only after install. Defaults to false.
   */
  needsShine?: boolean;
  /** Second line in the install alert — e.g. version or "via Internet Archive". */
  subtitle?: string | null;
  /** Total IPA size so itunesstored can show an accurate size/progress up front. */
  sizeInBytes?: number | null;
  /** Ignored pre-iOS 7, harmless. Defaults to com.apple.platform.iphoneos. */
  platformIdentifier?: string | null;
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
    sizeInBytes,
    platformIdentifier = 'com.apple.platform.iphoneos',
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
  // software-package (required)
  parts.push('<dict>');
  parts.push('<key>kind</key><string>software-package</string>');
  parts.push('<key>url</key><string>' + escapeXml(ipaUrl) + '</string>');
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
  // metadata
  parts.push('<key>metadata</key>');
  parts.push('<dict>');
  parts.push('<key>bundle-identifier</key><string>' + escapeXml(bundleId) + '</string>');
  parts.push('<key>bundle-version</key><string>' + escapeXml(version || '1.0') + '</string>');
  parts.push('<key>kind</key><string>software</string>');
  if (platformIdentifier) {
    parts.push('<key>platform-identifier</key><string>' + escapeXml(platformIdentifier) + '</string>');
  }
  if (typeof sizeInBytes === 'number' && Number.isFinite(sizeInBytes) && sizeInBytes > 0) {
    parts.push('<key>sizeInBytes</key><integer>' + Math.floor(sizeInBytes) + '</integer>');
  }
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


