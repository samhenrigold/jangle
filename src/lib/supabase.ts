import { createClient } from '@supabase/supabase-js';

type RuntimeEnv = Record<string, string | undefined> | undefined;

function readEnv(candidates: string[], runtimeEnv?: RuntimeEnv): string | undefined {
  const meta = (import.meta as any).env || {};
  for (const key of candidates) {
    if (runtimeEnv && runtimeEnv[key] && typeof runtimeEnv[key] === 'string') return runtimeEnv[key] as string;
    if (meta[key] && typeof meta[key] === 'string') return meta[key];
    if (typeof process !== 'undefined' && process.env && typeof process.env[key] === 'string') return process.env[key];
  }
  return undefined;
}

const SUPABASE_URL_KEYS = [
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'VITE_SUPABASE_URL',
  'SUPABASE_PROJECT_URL',
];

const SUPABASE_ANON_KEYS = [
  'SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_PUBLIC_ANON_KEY',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_KEY',
];

export function getSupabaseClient(runtimeEnv?: RuntimeEnv) {
  const supabaseUrl = readEnv(SUPABASE_URL_KEYS, runtimeEnv);
  const supabaseAnonKey = readEnv(SUPABASE_ANON_KEYS, runtimeEnv);
  if (!supabaseUrl || !supabaseAnonKey) {
    const missing = [!supabaseUrl ? 'SUPABASE_URL' : null, !supabaseAnonKey ? 'SUPABASE_ANON_KEY' : null]
      .filter(Boolean)
      .join(', ');
    throw new Error(`Missing ${missing} environment variables.`);
  }
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: {
      // The degraded convention catches errors but not hangs: without a
      // client-side deadline a slow/stuck PostgREST request rides the platform
      // limit and holds the isolate. An 8s abort turns a hang into a normal
      // error, so callers fall through to setDegraded() (503, no-store) instead.
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000) }),
    },
  });
}