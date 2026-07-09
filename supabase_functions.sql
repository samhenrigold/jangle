-- SQL functions to add to Supabase for efficient app sorting
-- These should be run in the Supabase SQL editor

-- Function to get apps sorted by version count
CREATE OR REPLACE FUNCTION get_apps_sorted_by_version_count(
  p_limit INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0,
  p_genre_id BIGINT DEFAULT NULL,
  p_ascending BOOLEAN DEFAULT TRUE,
  p_search_query TEXT DEFAULT NULL
)
RETURNS TABLE (
  id BIGINT,
  bundle_id TEXT,
  app_store_id INTEGER,
  app_store_name TEXT,
  developer_id BIGINT,
  genre_id BIGINT,
  copyright TEXT,
  icon_url TEXT,
  display_name TEXT,
  executable_name TEXT,
  search_vector TSVECTOR,
  created_at TIMESTAMPTZ,
  developer_artist_name TEXT,
  genre_genre_name TEXT,
  version_count BIGINT,
  first_version_date TIMESTAMPTZ
) 
LANGUAGE SQL
STABLE
AS $$
  WITH app_stats AS (
    SELECT 
      av.app_id,
      COUNT(*) as version_count,
      MIN(av.release_date) as first_version_date
    FROM app_versions av
    GROUP BY av.app_id
  )
  SELECT 
    a.id,
    a.bundle_id,
    a.app_store_id,
    a.app_store_name,
    a.developer_id,
    a.genre_id,
    a.copyright,
    a.icon_url,
    a.display_name,
    a.executable_name,
    a.search_vector,
    a.created_at,
    d.artist_name as developer_artist_name,
    g.genre_name as genre_genre_name,
    COALESCE(stats.version_count, 0) as version_count,
    stats.first_version_date
  FROM apps a
  LEFT JOIN developers d ON a.developer_id = d.id
  LEFT JOIN genres g ON a.genre_id = g.id
  LEFT JOIN app_stats stats ON a.id = stats.app_id
  WHERE 
    (p_genre_id IS NULL OR a.genre_id = p_genre_id)
    AND (p_search_query IS NULL OR a.search_vector @@ to_tsquery('english', p_search_query))
  ORDER BY 
    CASE 
      WHEN p_ascending THEN COALESCE(stats.version_count, 0)
      ELSE NULL
    END ASC,
    CASE 
      WHEN NOT p_ascending THEN COALESCE(stats.version_count, 0)
      ELSE NULL
    END DESC,
    a.display_name ASC
  LIMIT p_limit
  OFFSET p_offset;
$$;

-- Function to get apps sorted by first version date
CREATE OR REPLACE FUNCTION get_apps_sorted_by_first_version_date(
  p_limit INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0,
  p_genre_id BIGINT DEFAULT NULL,
  p_ascending BOOLEAN DEFAULT TRUE,
  p_search_query TEXT DEFAULT NULL
)
RETURNS TABLE (
  id BIGINT,
  bundle_id TEXT,
  app_store_id INTEGER,
  app_store_name TEXT,
  developer_id BIGINT,
  genre_id BIGINT,
  copyright TEXT,
  icon_url TEXT,
  display_name TEXT,
  executable_name TEXT,
  search_vector TSVECTOR,
  created_at TIMESTAMPTZ,
  developer_artist_name TEXT,
  genre_genre_name TEXT,
  version_count BIGINT,
  first_version_date TIMESTAMPTZ
) 
LANGUAGE SQL
STABLE
AS $$
  WITH app_stats AS (
    SELECT 
      av.app_id,
      COUNT(*) as version_count,
      MIN(av.release_date) as first_version_date
    FROM app_versions av
    GROUP BY av.app_id
  )
  SELECT 
    a.id,
    a.bundle_id,
    a.app_store_id,
    a.app_store_name,
    a.developer_id,
    a.genre_id,
    a.copyright,
    a.icon_url,
    a.display_name,
    a.executable_name,
    a.search_vector,
    a.created_at,
    d.artist_name as developer_artist_name,
    g.genre_name as genre_genre_name,
    COALESCE(stats.version_count, 0) as version_count,
    stats.first_version_date
  FROM apps a
  LEFT JOIN developers d ON a.developer_id = d.id
  LEFT JOIN genres g ON a.genre_id = g.id
  LEFT JOIN app_stats stats ON a.id = stats.app_id
  WHERE 
    (p_genre_id IS NULL OR a.genre_id = p_genre_id)
    AND (p_search_query IS NULL OR a.search_vector @@ to_tsquery('english', p_search_query))
  ORDER BY 
    -- Handle NULLs by putting them at the end
    CASE 
      WHEN p_ascending THEN (stats.first_version_date IS NULL)
      ELSE (stats.first_version_date IS NOT NULL)
    END,
    CASE 
      WHEN p_ascending THEN stats.first_version_date
      ELSE NULL
    END ASC,
    CASE 
      WHEN NOT p_ascending THEN stats.first_version_date
      ELSE NULL
    END DESC,
    a.display_name ASC
  LIMIT p_limit
  OFFSET p_offset;
$$;

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
