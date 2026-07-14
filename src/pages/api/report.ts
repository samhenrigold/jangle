import type { APIRoute } from 'astro';
import { supabaseFor } from '../../lib/supabase';

// "Report an issue" sink. A plain <form> POSTs here (works with no JS, on iOS
// 4–6), we sanitize, and hand the row to submit_issue_report — a SECURITY
// DEFINER function that is the ONLY write the anon key can reach (the
// issue_reports table itself is RLS-locked to anon). Sanitization is duplicated
// in the DB function too, since anon holds EXECUTE and could call it directly.

// Strip control chars (keep tab/newline), trim, cap. Mirrors the manifest
// escape set and the DB function's regexp.
function clean(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
    .slice(0, max);
}

function intOrNull(value: unknown): number | null {
  const n = Number(String(value ?? '').trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location } });
}

export const POST: APIRoute = async (ctx) => {
  let form: FormData;
  try {
    form = await ctx.request.formData();
  } catch {
    return seeOther('/');
  }

  const appStoreId = intOrNull(form.get('app_store_id'));
  const appId = intOrNull(form.get('app_id'));
  // Redirect target is rebuilt from a validated numeric id — never the raw
  // submitted path — so this can't be turned into an open redirect.
  const back = appStoreId ? `/app/${appStoreId}` : appId ? `/app/${appId}` : '/';

  // Honeypot: a hidden field real users never see. If it's filled, it's a bot —
  // drop it silently (report success so the bot learns nothing).
  if (clean(form.get('website'), 200)) return seeOther(`${back}?reported=1`);

  const message = clean(form.get('message'), 4000);
  if (!message) return seeOther(`${back}?reported=0`);

  const path = clean(form.get('path'), 300);
  const userAgent = clean(ctx.request.headers.get('user-agent'), 500);

  try {
    const supabase = supabaseFor(ctx);
    const { error } = await supabase.rpc('submit_issue_report', {
      p_message: message,
      p_app_id: appId,
      p_app_store_id: appStoreId,
      p_path: path || null,
      p_user_agent: userAgent || null,
    });
    if (error) {
      console.error('report insert failed:', error.message);
      return seeOther(`${back}?reported=0`);
    }
  } catch (err) {
    console.error('report route error:', (err as any)?.message);
    return seeOther(`${back}?reported=0`);
  }

  return seeOther(`${back}?reported=1`);
};
