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
  iconUrl?: string | null;
}): string {
  const { bundleId, title, version, ipaUrl, iconUrl } = params;

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
  // software-package
  parts.push('<dict>');
  parts.push('<key>kind</key><string>software-package</string>');
  parts.push('<key>url</key><string>' + escapeXml(ipaUrl) + '</string>');
  parts.push('</dict>');
  // display-image (optional)
  if (iconUrl) {
    parts.push('<dict>');
    parts.push('<key>kind</key><string>display-image</string>');
    parts.push('<key>needs-shine</key><false/>');
    parts.push('<key>url</key><string>' + escapeXml(iconUrl) + '</string>');
    parts.push('</dict>');
  }
  parts.push('</array>');
  // metadata
  parts.push('<key>metadata</key>');
  parts.push('<dict>');
  parts.push('<key>bundle-identifier</key><string>' + escapeXml(bundleId) + '</string>');
  parts.push('<key>bundle-version</key><string>' + escapeXml(version || '1.0') + '</string>');
  parts.push('<key>kind</key><string>software</string>');
  parts.push('<key>title</key><string>' + escapeXml(title || bundleId) + '</string>');
  parts.push('</dict>');
  parts.push('</dict>');
  parts.push('</array>');
  parts.push('</dict>');
  parts.push('</plist>');
  return parts.join('');
}


