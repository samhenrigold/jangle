import { createClient } from '@supabase/supabase-js';

function readEnv(candidates: string[]): string | undefined {
  const meta = (import.meta as any).env || {};
  for (const key of candidates) {
    if (meta[key] && typeof meta[key] === 'string') return meta[key];
    if (process.env[key] && typeof process.env[key] === 'string') return process.env[key];
  }
  return undefined;
}

const SUPABASE_URL_KEYS = [
  'SUPABASE_PROJECT_URL',
];

const SUPABASE_ANON_KEYS = [
  'SUPABASE_PUBLISHABLE_KEY',
];

export function getSupabaseClient() {
  const supabaseUrl = readEnv(SUPABASE_URL_KEYS);
  const supabaseAnonKey = readEnv(SUPABASE_ANON_KEYS);
  if (!supabaseUrl || !supabaseAnonKey) {
    const missing = [!supabaseUrl ? 'SUPABASE_URL' : null, !supabaseAnonKey ? 'SUPABASE_ANON_KEY' : null]
      .filter(Boolean)
      .join(', ');
    throw new Error(`Missing ${missing} environment variables.`);
  }
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
  });
}