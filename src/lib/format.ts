// All formatting happens server-side (workerd ships full ICU), so old devices
// get pre-formatted text without running any client JS — and we can lean on
// Intl without fallbacks.

const numberFmt = new Intl.NumberFormat('en-US');

export function formatNumber(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n ?? '');
  return numberFmt.format(v);
}

// UTC so a date never shifts across the server's timezone.
const dateFmt = new Intl.DateTimeFormat('en-US', {
  month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});

// "Mar 12, 2011"
export function formatDate(iso: unknown): string {
  if (!iso || typeof iso !== 'string') return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return dateFmt.format(d);
}

// "11.7 MB" — decimal-ish sizes people expect on download buttons.
export function formatFileSize(bytes: unknown): string {
  const b = Number(bytes);
  if (!Number.isFinite(b) || b <= 0) return '';
  if (b >= 1024 * 1024 * 1024) return `${(b / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} B`;
}
