// YES, it was originally called "iPhone OS" but according to Apple,
// the rename was retroactive as well. See this Wayback capture: "Requires iOS 3"
// https://web.archive.org/web/20101104064841/http://itunes.apple.com/us/app/movies-by-flixster-rotten/id284235722?mt=8
// So as far as I'm concerned, we can say "iOS 2" and "iOS 3". Them's the rules.

// "Requires iOS 6.0+". Empty for a missing version.
export function osRequirementLabel(version: unknown): string {
  if (!version) return '';
  return `Requires iOS ${version}+`;
}

// Short label from a major version alone. Used by the "Runs on" filter chips and the stats charts.
export function osShortLabel(major: number): string {
  return `iOS ${major}`;
}

// Per-idiom Retina label for a version row (plan 013). iPhone got Retina 2010-06,
// iPad not until 2012-03, so a universal app can be Retina on one and not the
// other — we detect and say which. `retina_*` on the binary are True | False |
// null (null = N/A/unknown for that idiom). Returns null when there's no signal.
export function retinaLabel(
  bin: { retina_iphone?: boolean | null; retina_ipad?: boolean | null; retina_iphone_plus?: boolean | null } | null | undefined,
  deviceFamily: string[]
): { text: string; title?: string } | null {
  if (!bin) return null;
  const iph = bin.retina_iphone ?? null;
  const ipad = bin.retina_ipad ?? null;
  const plus = bin.retina_iphone_plus === true;
  const hd = (t: string) => (plus ? { text: t, title: 'Also ships @3x (Retina HD) assets for iPhone 6 Plus-class displays' } : { text: t });
  if (iph == null && ipad == null) return null;
  const targetsIpad = deviceFamily.indexOf('2') >= 0;
  const targetsIphone = deviceFamily.indexOf('1') >= 0 || deviceFamily.length === 0;
  // Universal: report both idioms, calling out the asymmetric case explicitly.
  if (targetsIphone && targetsIpad) {
    if (iph && ipad) return hd('Retina');
    if (iph && ipad === false)
      return { text: 'Retina (iPhone only)', title: 'Retina on iPhone; ships standard-resolution iPad assets — this build predates or omits iPad Retina support' };
    if (iph === false && ipad) return { text: 'Retina (iPad only)', title: 'Retina on iPad; standard-resolution on iPhone' };
    if (iph === false && ipad === false) return { text: 'Non-Retina' };
    return null; // one idiom unknown — don't guess
  }
  // Single-idiom app: report that idiom.
  const val = targetsIpad ? ipad : iph;
  if (val === true) return hd('Retina');
  if (val === false) return { text: 'Non-Retina' };
  return null;
}
