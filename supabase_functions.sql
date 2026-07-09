-- SQL functions to add to Supabase for efficient app sorting
-- These should be run in the Supabase SQL editor

-- Function to get apps sorted by version count.
-- Reads precomputed apps.version_count (maintained by trg_app_version_stats)
-- instead of aggregating all of app_versions on every call. Return type no
-- longer includes search_vector (was pure egress waste). Return-type change
-- requires DROP+CREATE rather than CREATE OR REPLACE.
DROP FUNCTION IF EXISTS get_apps_sorted_by_version_count(integer,integer,bigint,boolean,text);
CREATE FUNCTION get_apps_sorted_by_version_count(
  p_limit INTEGER DEFAULT 20, p_offset INTEGER DEFAULT 0,
  p_genre_id BIGINT DEFAULT NULL, p_ascending BOOLEAN DEFAULT TRUE,
  p_search_query TEXT DEFAULT NULL
)
RETURNS TABLE (
  id BIGINT, bundle_id TEXT, app_store_id INTEGER, app_store_name TEXT,
  developer_id BIGINT, genre_id BIGINT, copyright TEXT, icon_url TEXT,
  display_name TEXT, executable_name TEXT, created_at TIMESTAMPTZ,
  developer_artist_name TEXT, genre_genre_name TEXT,
  version_count BIGINT, first_version_date TIMESTAMPTZ
)
LANGUAGE SQL STABLE
SET search_path = public, pg_temp
AS $$
  SELECT a.id, a.bundle_id, a.app_store_id, a.app_store_name,
         a.developer_id, a.genre_id, a.copyright, a.icon_url,
         a.display_name, a.executable_name, a.created_at,
         d.artist_name, g.genre_name,
         a.version_count::bigint, a.first_version_date
  FROM apps a
  LEFT JOIN developers d ON a.developer_id = d.id
  LEFT JOIN genres g ON a.genre_id = g.id
  WHERE (p_genre_id IS NULL OR a.genre_id = p_genre_id)
    AND (p_search_query IS NULL OR a.search_vector @@ to_tsquery('english', p_search_query))
  ORDER BY
    CASE WHEN p_ascending THEN a.version_count END ASC,
    CASE WHEN NOT p_ascending THEN a.version_count END DESC,
    a.display_name ASC
  LIMIT p_limit OFFSET p_offset;
$$;
GRANT EXECUTE ON FUNCTION get_apps_sorted_by_version_count(integer,integer,bigint,boolean,text) TO anon, authenticated;

-- Function to get apps sorted by first version date (precomputed column).
DROP FUNCTION IF EXISTS get_apps_sorted_by_first_version_date(integer,integer,bigint,boolean,text);
CREATE FUNCTION get_apps_sorted_by_first_version_date(
  p_limit INTEGER DEFAULT 20, p_offset INTEGER DEFAULT 0,
  p_genre_id BIGINT DEFAULT NULL, p_ascending BOOLEAN DEFAULT TRUE,
  p_search_query TEXT DEFAULT NULL
)
RETURNS TABLE (
  id BIGINT, bundle_id TEXT, app_store_id INTEGER, app_store_name TEXT,
  developer_id BIGINT, genre_id BIGINT, copyright TEXT, icon_url TEXT,
  display_name TEXT, executable_name TEXT, created_at TIMESTAMPTZ,
  developer_artist_name TEXT, genre_genre_name TEXT,
  version_count BIGINT, first_version_date TIMESTAMPTZ
)
LANGUAGE SQL STABLE
SET search_path = public, pg_temp
AS $$
  SELECT a.id, a.bundle_id, a.app_store_id, a.app_store_name,
         a.developer_id, a.genre_id, a.copyright, a.icon_url,
         a.display_name, a.executable_name, a.created_at,
         d.artist_name, g.genre_name,
         a.version_count::bigint, a.first_version_date
  FROM apps a
  LEFT JOIN developers d ON a.developer_id = d.id
  LEFT JOIN genres g ON a.genre_id = g.id
  WHERE (p_genre_id IS NULL OR a.genre_id = p_genre_id)
    AND (p_search_query IS NULL OR a.search_vector @@ to_tsquery('english', p_search_query))
  ORDER BY
    CASE WHEN p_ascending THEN (a.first_version_date IS NULL) ELSE (a.first_version_date IS NOT NULL) END,
    CASE WHEN p_ascending THEN a.first_version_date END ASC,
    CASE WHEN NOT p_ascending THEN a.first_version_date END DESC,
    a.display_name ASC
  LIMIT p_limit OFFSET p_offset;
$$;
GRANT EXECUTE ON FUNCTION get_apps_sorted_by_first_version_date(integer,integer,bigint,boolean,text) TO anon, authenticated;

-- Function to get total count for pagination (with optional filters)
CREATE OR REPLACE FUNCTION get_apps_count(
  p_genre_id BIGINT DEFAULT NULL,
  p_search_query TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE SQL
STABLE
AS $$
  SELECT COUNT(*)
  FROM apps a
  WHERE 
    (p_genre_id IS NULL OR a.genre_id = p_genre_id)
    AND (p_search_query IS NULL OR a.search_vector @@ to_tsquery('english', p_search_query));
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION get_apps_sorted_by_version_count TO authenticated;
GRANT EXECUTE ON FUNCTION get_apps_sorted_by_first_version_date TO authenticated;
GRANT EXECUTE ON FUNCTION get_apps_count TO authenticated;

-- Grant execute permissions to anonymous users (if needed)
GRANT EXECUTE ON FUNCTION get_apps_sorted_by_version_count TO anon;
GRANT EXECUTE ON FUNCTION get_apps_sorted_by_first_version_date TO anon;
GRANT EXECUTE ON FUNCTION get_apps_count TO anon;

CREATE OR REPLACE FUNCTION get_genres_with_counts()
RETURNS TABLE (
  id BIGINT,
  genre_id BIGINT,
  genre_name TEXT,
  created_at TIMESTAMPTZ,
  app_count BIGINT,
  total_apps BIGINT
) 
LANGUAGE SQL
STABLE
AS $$
  WITH total_count AS (
    SELECT COUNT(*) as total FROM apps
  )
  SELECT 
    g.id,
    g.genre_id,
    g.genre_name,
    g.created_at,
    COALESCE(COUNT(a.id), 0) as app_count,
    tc.total as total_apps
  FROM genres g
  LEFT JOIN apps a ON g.id = a.genre_id
  CROSS JOIN total_count tc
  GROUP BY g.id, g.genre_id, g.genre_name, g.created_at, tc.total
  ORDER BY g.genre_name ASC;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_genres_with_counts TO authenticated;
GRANT EXECUTE ON FUNCTION get_genres_with_counts TO anon;

-- ── Precomputed per-app version stats (perf) — applied 2026-07 in production ──
-- Backing columns for the sort functions above; kept correct by a trigger.
ALTER TABLE public.apps
  ADD COLUMN IF NOT EXISTS version_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_version_date timestamptz;

-- One-time backfill (safe to re-run):
-- UPDATE public.apps a SET version_count = s.cnt, first_version_date = s.first_date
-- FROM (SELECT app_id, COUNT(*) cnt, MIN(release_date) first_date FROM public.app_versions GROUP BY app_id) s
-- WHERE a.id = s.app_id;

CREATE OR REPLACE FUNCTION public.refresh_app_version_stats()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE target bigint;
BEGIN
  target := COALESCE(NEW.app_id, OLD.app_id);
  IF target IS NOT NULL THEN
    UPDATE public.apps a SET version_count = COALESCE(s.cnt,0), first_version_date = s.first_date
    FROM (SELECT COUNT(*) cnt, MIN(release_date) first_date FROM public.app_versions WHERE app_id = target) s
    WHERE a.id = target;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.app_id IS DISTINCT FROM OLD.app_id AND OLD.app_id IS NOT NULL THEN
    UPDATE public.apps a SET version_count = COALESCE(s.cnt,0), first_version_date = s.first_date
    FROM (SELECT COUNT(*) cnt, MIN(release_date) first_date FROM public.app_versions WHERE app_id = OLD.app_id) s
    WHERE a.id = OLD.app_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_app_version_stats ON public.app_versions;
CREATE TRIGGER trg_app_version_stats
AFTER INSERT OR UPDATE OF app_id, release_date OR DELETE
ON public.app_versions FOR EACH ROW EXECUTE FUNCTION public.refresh_app_version_stats();

CREATE INDEX IF NOT EXISTS idx_apps_version_count_name
  ON public.apps (version_count DESC, display_name ASC);

-- ── Hardening (applied 2026-07 in production) ───────────────────────────────
-- Public roles (anon/authenticated) keep SELECT (via RLS policies) and EXECUTE
-- on the RPCs; all write privileges are revoked so RLS is no longer the sole
-- barrier to public data destruction. Ingest must use the service role.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLES FROM anon, authenticated;

-- Advisor lint 0011: pin function search_path (object-resolution hardening).
ALTER FUNCTION public.get_apps_sorted_by_version_count(integer, integer, bigint, boolean, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_apps_sorted_by_first_version_date(integer, integer, bigint, boolean, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_apps_count(bigint, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_genres_with_counts() SET search_path = public, pg_temp;
