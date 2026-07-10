// All formatting happens server-side (workerd ships full ICU), so old devices
// get pre-formatted text without running any client JS. The try/catch
// fallbacks only matter for exotic runtimes without Intl.

let numberFmt: Intl.NumberFormat | null = null;
try {
  numberFmt = new Intl.NumberFormat('en-US');
} catch {
  numberFmt = null;
}

export function formatNumber(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n ?? '');
  return numberFmt ? numberFmt.format(v) : String(v);
}

let dateFmt: Intl.DateTimeFormat | null = null;
try {
  dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
} catch {
  dateFmt = null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "Mar 12, 2011" — UTC so a date never shifts across the server's timezone.
export function formatDate(iso: unknown): string {
  if (!iso || typeof iso !== 'string') return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  if (dateFmt) return dateFmt.format(d);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
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
