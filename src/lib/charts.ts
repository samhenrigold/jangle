// Static SVG bar charts, generated server-side and inlined into the page HTML.
//
// The output is plain <svg> markup — only <rect>, <text>, <a> and <title>/<desc>,
// with presentation attributes rather than CSS-in-SVG. No <script>, no SMIL
// <animate>, no CSS animation or class-driven styling. That restriction is
// deliberate: WebKit as old as iPhone OS 3 renders *static* SVG-as-markup fine;
// what was buggy back then was scripted/animated SVG and some CSS-on-SVG combos,
// none of which we use. So these charts display on the same ancient devices the
// archive is for, with zero client JS.
//
// Responsiveness uses the padding-box technique (intrinsic ratio from a
// percentage bottom-padding, SVG absolutely filling it) rather than SVG
// intrinsic sizing, which old browsers get wrong.

export interface BarDatum {
  label: string;
  value: number;
  display: string; // preformatted value text, e.g. "9,413"
  warn?: boolean; // amber fill (reused from the "encrypted" chip palette)
  href?: string; // makes the row label a link
}

interface BarChartOptions {
  title: string; // accessible name for the whole chart
  labelWidth: number; // viewBox units reserved for the left label column
  valueWidth?: number; // viewBox units reserved for the right value column
  mono?: boolean; // monospace label font (for architecture names)
}

const WIDTH = 600;
const ROW_H = 24;
const BAR_H = 13;
const PAD_Y = 5;
const FONT = 14;
// Headroom so the longest bar stops short of the track end — the "little bit of
// margin" a full-width bar otherwise lacks. All bars scale by the same factor,
// so relative lengths stay honest.
const END_GAP = 14;

const SANS = 'Helvetica, Arial, sans-serif';
const MONO = 'Menlo, Monaco, "Courier New", monospace';

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function barChartSVG(rows: BarDatum[], opts: BarChartOptions): string {
  const valueWidth = opts.valueWidth ?? 68;
  const labelWidth = opts.labelWidth;
  const trackFullW = WIDTH - labelWidth - valueWidth;
  const innerW = Math.max(2, trackFullW - END_GAP);
  const max = Math.max(1, ...rows.map((r) => r.value));
  const height = rows.length * ROW_H + PAD_Y * 2;
  const labelFont = opts.mono ? MONO : SANS;

  const parts: string[] = [];
  rows.forEach((r, i) => {
    const y = PAD_Y + i * ROW_H;
    const barY = y + (ROW_H - BAR_H) / 2;
    // Old WebKit ignores dominant-baseline, so center text by nudging the
    // baseline down ~0.35em rather than relying on it.
    const textY = y + ROW_H / 2 + Math.round(FONT * 0.35);
    const fillW = Math.min(innerW, Math.max(2, Math.round((r.value / max) * innerW)));
    const fill = r.warn ? '#ecd39c' : '#6e83a4';
    const fillStroke = r.warn ? '#c9a24e' : '#385487';
    const labelColor = r.href ? '#385487' : '#333';
    const labelWeight = r.href ? ' font-weight="bold"' : '';

    let label =
      `<text x="${labelWidth - 8}" y="${textY}" text-anchor="end" ` +
      `font-family="${labelFont}" font-size="${FONT}" fill="${labelColor}"${labelWeight}>${esc(r.label)}</text>`;
    if (r.href) label = `<a xlink:href="${esc(r.href)}">${label}</a>`;
    parts.push(label);

    // Track (light reference) then the fill on top.
    parts.push(
      `<rect x="${labelWidth}" y="${barY}" width="${trackFullW}" height="${BAR_H}" rx="2" fill="#f2f2f4" stroke="#e1e1e1" stroke-width="1"/>`
    );
    parts.push(
      `<rect x="${labelWidth}" y="${barY}" width="${fillW}" height="${BAR_H}" rx="2" fill="${fill}" stroke="${fillStroke}" stroke-width="1"/>`
    );
    parts.push(
      `<text x="${WIDTH}" y="${textY}" text-anchor="end" font-family="${SANS}" font-size="${FONT}" fill="#666">${esc(r.display)}</text>`
    );
  });

  const desc = rows.map((r) => `${r.label}: ${r.display}`).join('. ');
  const ratio = ((height / WIDTH) * 100).toFixed(3);

  return (
    `<div class="chart-box" style="position:relative;width:100%;height:0;padding-bottom:${ratio}%">` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `viewBox="0 0 ${WIDTH} ${height}" preserveAspectRatio="xMinYMin meet" role="img" ` +
    `style="position:absolute;top:0;left:0;width:100%;height:100%">` +
    `<title>${esc(opts.title)}</title><desc>${esc(desc)}</desc>` +
    parts.join('') +
    `</svg></div>`
  );
}

export interface LinePoint {
  t: number; // x position (e.g. a timestamp in ms)
  y: number; // value
  label: string; // per-point accessible/hover label, e.g. "5.3 MB — Dec 2010"
}

interface LineChartOptions {
  title: string;
  yFormat: (n: number) => string; // format a y value for the axis (bytes → "5.3 MB")
  xStartLabel: string; // label under the left edge
  xEndLabel: string; // label under the right edge
}

// Static line chart (e.g. bundle size over time). Same static-SVG rules as the
// bar chart — plain <polyline>/<circle>/<text>, no script — so it renders on
// iOS 4-6 WebKit. y runs from 0 to the data max; x from the first to last t.
export function lineChartSVG(points: LinePoint[], opts: LineChartOptions): string {
  const H = 200;
  const FONT = 11;
  const ML = 54; // room for the y-axis labels
  const MR = 8;
  const MT = 10;
  const MB = 22; // room for x-labels
  const plotW = WIDTH - ML - MR;
  const plotH = H - MT - MB;
  const DIV = 4; // y-axis gridline intervals

  const pts = points.slice().sort((a, b) => a.t - b.t);
  const tMin = pts[0].t;
  const tMax = pts[pts.length - 1].t;
  const tSpan = tMax - tMin || 1;
  const yMax = Math.max(1, ...pts.map((p) => p.y));

  const sx = (t: number) => ML + ((t - tMin) / tSpan) * plotW;
  const sy = (y: number) => MT + (1 - y / yMax) * plotH;

  const coords = pts.map((p) => `${Math.round(sx(p.t))},${Math.round(sy(p.y))}`).join(' ');
  const dots = pts
    .map((p) => `<circle cx="${Math.round(sx(p.t))}" cy="${Math.round(sy(p.y))}" r="2.5" fill="#385487"><title>${esc(p.label)}</title></circle>`)
    .join('');

  const parts: string[] = [];
  // Horizontal gridlines with a y-axis label at each.
  for (let i = 0; i <= DIV; i++) {
    const val = (yMax * i) / DIV;
    const y = Math.round(sy(val));
    parts.push(`<line x1="${ML}" y1="${y}" x2="${WIDTH - MR}" y2="${y}" stroke="${i === 0 ? '#e1e1e1' : '#f0f0f0'}" stroke-width="1"/>`);
    parts.push(`<text x="${ML - 6}" y="${y + 4}" text-anchor="end" font-family="${SANS}" font-size="${FONT}" fill="#a0a0a5">${esc(opts.yFormat(val))}</text>`);
  }
  parts.push(`<polyline points="${coords}" fill="none" stroke="#6e83a4" stroke-width="2"/>`);
  parts.push(dots);
  // X-axis endpoint labels.
  parts.push(`<text x="${ML}" y="${H - 6}" font-family="${SANS}" font-size="${FONT}" fill="#a0a0a5">${esc(opts.xStartLabel)}</text>`);
  parts.push(`<text x="${WIDTH - MR}" y="${H - 6}" text-anchor="end" font-family="${SANS}" font-size="${FONT}" fill="#a0a0a5">${esc(opts.xEndLabel)}</text>`);

  const desc = pts.map((p) => p.label).join('. ');
  const ratio = ((H / WIDTH) * 100).toFixed(3);
  return (
    `<div class="chart-box" style="position:relative;width:100%;height:0;padding-bottom:${ratio}%">` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${H}" ` +
    `preserveAspectRatio="xMinYMin meet" role="img" ` +
    `style="position:absolute;top:0;left:0;width:100%;height:100%">` +
    `<title>${esc(opts.title)}</title><desc>${esc(desc)}</desc>` +
    parts.join('') +
    `</svg></div>`
  );
}
