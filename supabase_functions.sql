-- SQL functions to add to Supabase for efficient app sorting
-- These should be run in the Supabase SQL editor

-- Function to get apps sorted by version count.
-- Reads precomputed apps.version_count (maintained by trg_app_version_stats)
-- instead of aggregating all of app_versions on every call. Return type no
-- longer includes search_vector (was pure egress waste). Return-type change
-- requires DROP+CREATE rather than CREATE OR REPLACE.
--
-- app_store_id is BIGINT: apps.app_store_id is bigint and 19 modern apps
-- (Fortnite, GTA III/SA, ...) exceed the int4 max, so an INTEGER return column
-- threw "integer out of range" for any page containing one (audit item 1).
--
-- The ORDER BY is split into two static branches rather than CASE-wrapping the
-- sort keys: a CASE-based ORDER BY is opaque to the planner and cannot use
-- idx_apps_version_count_name (it sorted the whole filtered set, ~330ms mean);
-- the static DESC branch does an index top-N (~1ms) (audit item 2).
DROP FUNCTION IF EXISTS get_apps_sorted_by_version_count(integer,integer,bigint,boolean,text);
CREATE FUNCTION get_apps_sorted_by_version_count(
  p_limit INTEGER DEFAULT 20, p_offset INTEGER DEFAULT 0,
  p_genre_id BIGINT DEFAULT NULL, p_ascending BOOLEAN DEFAULT TRUE,
  p_search_query TEXT DEFAULT NULL
)
RETURNS TABLE (
  id BIGINT, bundle_id TEXT, app_store_id BIGINT, app_store_name TEXT,
  developer_id BIGINT, genre_id BIGINT, copyright TEXT, icon_url TEXT,
  display_name TEXT, executable_name TEXT, created_at TIMESTAMPTZ,
  developer_artist_name TEXT, genre_genre_name TEXT,
  version_count BIGINT, first_version_date TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_ascending THEN
    RETURN QUERY
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
      ORDER BY a.version_count ASC, a.display_name ASC
      LIMIT p_limit OFFSET p_offset;
  ELSE
    RETURN QUERY
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
      ORDER BY a.version_count DESC, a.display_name ASC
      LIMIT p_limit OFFSET p_offset;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION get_apps_sorted_by_version_count(integer,integer,bigint,boolean,text) TO anon, authenticated;

-- Function to get apps sorted by first version date (precomputed column).
-- Same bigint + branched-ORDER-BY treatment as above. Default null placement
-- (ASC -> NULLS LAST, DESC -> NULLS FIRST) reproduces the old CASE-based null
-- handling exactly (nulls behave as +infinity). NOTE: the descending path here
-- still lacks a matching index (there is no index on first_version_date) and
-- falls back to a sort; add apps(first_version_date) to make it an index top-N.
DROP FUNCTION IF EXISTS get_apps_sorted_by_first_version_date(integer,integer,bigint,boolean,text);
CREATE FUNCTION get_apps_sorted_by_first_version_date(
  p_limit INTEGER DEFAULT 20, p_offset INTEGER DEFAULT 0,
  p_genre_id BIGINT DEFAULT NULL, p_ascending BOOLEAN DEFAULT TRUE,
  p_search_query TEXT DEFAULT NULL
)
RETURNS TABLE (
  id BIGINT, bundle_id TEXT, app_store_id BIGINT, app_store_name TEXT,
  developer_id BIGINT, genre_id BIGINT, copyright TEXT, icon_url TEXT,
  display_name TEXT, executable_name TEXT, created_at TIMESTAMPTZ,
  developer_artist_name TEXT, genre_genre_name TEXT,
  version_count BIGINT, first_version_date TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_ascending THEN
    RETURN QUERY
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
      ORDER BY a.first_version_date ASC, a.display_name ASC
      LIMIT p_limit OFFSET p_offset;
  ELSE
    RETURN QUERY
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
      ORDER BY a.first_version_date DESC, a.display_name ASC
      LIMIT p_limit OFFSET p_offset;
  END IF;
END;
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

-- ── Archive-wide stats for /stats (applied 2026-07 in production) ────────────
-- The full computation takes ~6s (big-table counts run serially), too close to
-- the anon 8s statement timeout to run per request. Split three ways:
-- compute_archive_stats() is the heavy internal function, a pg_cron job
-- refreshes a one-row cache nightly, and the public get_archive_stats() just
-- reads the cache (synchronous refresh only as a cron-failed fallback).

CREATE OR REPLACE FUNCTION public.compute_archive_stats()
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
SELECT jsonb_build_object(
  'apps',              (SELECT count(*) FROM apps),
  'developers',        (SELECT count(*) FROM developers),
  'versions',          (SELECT count(*) FROM app_versions),
  'binaries',          (SELECT count(*) FROM binaries),
  'copies',            (SELECT count(*) FROM ipa_files),
  'copies_available',  (SELECT count(*) FROM ipa_files WHERE available),
  'archive_items',     (SELECT count(*) FROM archive_items),
  'total_bytes',       (SELECT sum(file_size) FROM ipa_files),
  'distinct_icons',    (SELECT count(DISTINCT coalesce(bundle_icon_sha256, icon_sha256)) FROM binaries),
  'wayback_captures',  (SELECT count(*) FROM wayback_captures),
  'listing_snapshots', (SELECT count(*) FROM app_listing_snapshots),
  'reviews',           (SELECT count(*) FROM app_reviews),
  'review_stars',      (SELECT jsonb_object_agg(stars, n) FROM (SELECT stars, count(*) n FROM app_reviews WHERE stars BETWEEN 1 AND 5 GROUP BY 1) s),
  'chart_positions',   (SELECT count(*) FROM chart_positions),
  'chart_snapshots',   (SELECT count(*) FROM chart_snapshots),
  'chart_years',       (SELECT jsonb_build_object('min', min(substr(captured_ts, 1, 4)), 'max', max(substr(captured_ts, 1, 4))) FROM chart_snapshots),
  'install',           (SELECT jsonb_object_agg(coalesce(install_status, 'unknown'), n) FROM (SELECT install_status, count(*) n FROM binaries GROUP BY 1) s),
  'archs',             (SELECT jsonb_object_agg(a, n) FROM (SELECT unnest(architectures) a, count(*) n FROM binaries GROUP BY 1) s),
  'armv6_only_installable', (SELECT count(*) FROM binaries WHERE architectures = ARRAY['armv6'] AND install_status = 'installable'),
  'watch_apps',        (SELECT count(*) FROM binaries WHERE has_watch_app),
  'apps_checked',      (SELECT count(*) FROM apps WHERE is_available IS NOT NULL),
  'apps_delisted',     (SELECT count(*) FROM apps WHERE is_available = false),
  -- Known dates only; pre-2008 values are ingest junk (the store opened 2008-07-10)
  'by_year',           (SELECT jsonb_object_agg(yr, n) FROM (
                          SELECT extract(year FROM coalesce(release_date, estimated_release_date::timestamptz))::int yr, count(*) n
                          FROM app_versions
                          WHERE coalesce(release_date, estimated_release_date::timestamptz)
                                BETWEEN timestamptz '2008-01-01' AND now()
                          GROUP BY 1) s),
  'versions_dated',    (SELECT count(*) FROM app_versions WHERE coalesce(release_date, estimated_release_date::timestamptz) IS NOT NULL),
  'oldest_version',    (SELECT min(coalesce(release_date, estimated_release_date::timestamptz)) FROM app_versions
                          WHERE coalesce(release_date, estimated_release_date::timestamptz) >= timestamptz '2008-01-01'),
  'min_os',            (SELECT jsonb_object_agg(v, n) FROM (
                          SELECT split_part(minimum_os_version, '.', 1) v, count(*) n
                          FROM app_versions WHERE minimum_os_version ~ '^[0-9]+' GROUP BY 1) s),
  'device_family',     jsonb_build_object(
                         'universal',   (SELECT count(*) FROM app_versions WHERE device_family::text[] @> ARRAY['1','2']),
                         'iphone_only', (SELECT count(*) FROM app_versions WHERE device_family::text[] @> ARRAY['1'] AND NOT device_family::text[] @> ARRAY['2']),
                         'ipad_only',   (SELECT count(*) FROM app_versions WHERE device_family::text[] @> ARRAY['2'] AND NOT device_family::text[] @> ARRAY['1'])),
  'prices',            jsonb_build_object(
                         'known', (SELECT count(*) FROM app_versions WHERE price IS NOT NULL),
                         'free',  (SELECT count(*) FROM app_versions WHERE price = 0),
                         'paid',  (SELECT count(*) FROM app_versions WHERE price > 0)),
  -- price integers mix currencies; ranking only makes sense within one, so USD
  'priciest',          (SELECT jsonb_agg(x) FROM (
                          SELECT jsonb_build_object('name', a.app_store_name, 'id', a.app_store_id, 'price', v.price_display) x
                          FROM app_versions v JOIN apps a ON a.id = v.app_id
                          WHERE v.price > 0 AND v.price_display LIKE '$%'
                          ORDER BY v.price DESC LIMIT 3) s),
  'most_versions',     (SELECT jsonb_agg(x) FROM (
                          SELECT jsonb_build_object('name', coalesce(display_name, app_store_name), 'id', app_store_id, 'n', version_count) x
                          FROM apps WHERE app_store_name IS NOT NULL AND app_store_id IS NOT NULL
                          ORDER BY version_count DESC LIMIT 5) s),
  'biggest',           (SELECT jsonb_agg(x) FROM (
                          SELECT jsonb_build_object('name', a.app_store_name, 'id', a.app_store_id, 'bytes', f.file_size) x
                          FROM ipa_files f
                          JOIN app_versions v ON v.id = f.app_version_id
                          JOIN apps a ON a.id = v.app_id
                          WHERE a.app_store_name IS NOT NULL
                          ORDER BY f.file_size DESC NULLS LAST LIMIT 3) s),
  'top_genres',        (SELECT jsonb_agg(x) FROM (
                          SELECT jsonb_build_object('g', g.genre_name, 'gid', g.id, 'n', count(*)) x
                          FROM apps a JOIN genres g ON g.id = a.genre_id
                          GROUP BY g.genre_name, g.id ORDER BY count(*) DESC LIMIT 10) s),
  'apps_with_genre',   (SELECT count(*) FROM apps WHERE genre_id IS NOT NULL)
);
$$;
REVOKE EXECUTE ON FUNCTION public.compute_archive_stats() FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.archive_stats_cache (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  stats jsonb NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.archive_stats_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read" ON public.archive_stats_cache;
CREATE POLICY "Public read" ON public.archive_stats_cache FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.archive_stats_cache TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_archive_stats()
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.archive_stats_cache AS c (id, stats, computed_at)
  VALUES (1, public.compute_archive_stats(), now())
  ON CONFLICT (id) DO UPDATE SET stats = EXCLUDED.stats, computed_at = EXCLUDED.computed_at;
$$;
REVOKE EXECUTE ON FUNCTION public.refresh_archive_stats() FROM PUBLIC, anon, authenticated;

-- Public accessor: cached read; synchronous recompute only if cron has been
-- dead for 2+ days (rare, and still within the anon statement timeout).
CREATE OR REPLACE FUNCTION public.get_archive_stats()
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  row_stats jsonb;
  row_at timestamptz;
BEGIN
  SELECT stats, computed_at INTO row_stats, row_at FROM public.archive_stats_cache WHERE id = 1;
  IF row_stats IS NULL OR row_at < now() - interval '48 hours' THEN
    PERFORM public.refresh_archive_stats();
    SELECT stats, computed_at INTO row_stats, row_at FROM public.archive_stats_cache WHERE id = 1;
  END IF;
  RETURN jsonb_set(row_stats, '{computed_at}', to_jsonb(row_at));
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_archive_stats() TO anon, authenticated;

-- Nightly refresh at 09:17 UTC.
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('refresh-archive-stats', '17 9 * * *', 'SELECT public.refresh_archive_stats()')
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-archive-stats');

-- ── Category-index row icons (applied 2026-07) ──────────────────────────────
-- Top app (most versions preserved) per genre, for the /categories row icons.
-- Fuck Fox News: skip com.foxnews.foxnews so News picks the next-best icon.
CREATE OR REPLACE FUNCTION public.get_genre_top_apps()
RETURNS TABLE (genre_id bigint, app_id bigint, icon_url text)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT ON (a.genre_id) a.genre_id, a.id, a.icon_url
  FROM apps a
  WHERE a.genre_id IS NOT NULL
    AND a.bundle_id <> 'com.foxnews.foxnews'
  ORDER BY a.genre_id, a.version_count DESC NULLS LAST, a.id;
$$;
GRANT EXECUTE ON FUNCTION public.get_genre_top_apps() TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- Audit follow-up (2026-07-11). The definitions below SUPERSEDE the earlier
-- get_apps_count / get_genres_with_counts / refresh_app_version_stats above when
-- this file is run top-to-bottom (CREATE OR REPLACE / DROP+CREATE, last wins).
-- ════════════════════════════════════════════════════════════════════════════

-- F3/F2: per-genre and total app counts re-aggregated the whole apps table on
-- every call, and under ingestion the index-only count scans degrade to heavy
-- heap fetches (idle ~12ms, under load ~200ms). Cache them like archive_stats,
-- refreshed hourly so pagination totals lag <=1h during ingestion. Idle live
-- counts are cheap, so search counts stay live+exact; only the unfiltered total
-- and per-genre counts are served from cache.
CREATE TABLE IF NOT EXISTS public.genre_counts_cache (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  counts jsonb NOT NULL,        -- { "<genres.id>": <app_count>, ... }
  total_apps bigint NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.genre_counts_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read" ON public.genre_counts_cache;
CREATE POLICY "Public read" ON public.genre_counts_cache FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.genre_counts_cache TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_genre_counts()
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.genre_counts_cache AS c (id, counts, total_apps, computed_at)
  VALUES (
    1,
    COALESCE((SELECT jsonb_object_agg(genre_id::text, cnt)
              FROM (SELECT genre_id, count(*) cnt FROM apps WHERE genre_id IS NOT NULL GROUP BY genre_id) s),
             '{}'::jsonb),
    (SELECT count(*) FROM apps),
    now()
  )
  ON CONFLICT (id) DO UPDATE
    SET counts = EXCLUDED.counts, total_apps = EXCLUDED.total_apps, computed_at = EXCLUDED.computed_at;
$$;
REVOKE EXECUTE ON FUNCTION public.refresh_genre_counts() FROM PUBLIC, anon, authenticated;
SELECT public.refresh_genre_counts();

CREATE OR REPLACE FUNCTION public.get_genres_with_counts()
RETURNS TABLE (
  id BIGINT, genre_id BIGINT, genre_name TEXT, created_at TIMESTAMPTZ,
  app_count BIGINT, total_apps BIGINT
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE c jsonb; t bigint; computed timestamptz;
BEGIN
  SELECT gc.counts, gc.total_apps, gc.computed_at INTO c, t, computed
  FROM public.genre_counts_cache gc WHERE gc.id = 1;
  IF c IS NULL OR computed < now() - interval '6 hours' THEN
    PERFORM public.refresh_genre_counts();
    SELECT gc.counts, gc.total_apps INTO c, t FROM public.genre_counts_cache gc WHERE gc.id = 1;
  END IF;
  RETURN QUERY
    SELECT g.id::bigint, g.genre_id::bigint, g.genre_name, g.created_at,
           COALESCE((c ->> g.id::text)::bigint, 0) AS app_count,
           t AS total_apps
    FROM genres g
    ORDER BY g.genre_name ASC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_genres_with_counts() TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_apps_count(
  p_genre_id BIGINT DEFAULT NULL, p_search_query TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $$
DECLARE n bigint;
BEGIN
  IF p_search_query IS NULL AND p_genre_id IS NULL THEN
    SELECT gc.total_apps INTO n FROM genre_counts_cache gc WHERE gc.id = 1;
    IF n IS NOT NULL THEN RETURN n; END IF;
  ELSIF p_search_query IS NULL AND p_genre_id IS NOT NULL THEN
    SELECT (gc.counts ->> p_genre_id::text)::bigint INTO n FROM genre_counts_cache gc WHERE gc.id = 1;
    IF n IS NOT NULL THEN RETURN n; END IF;
  END IF;
  RETURN (SELECT count(*) FROM apps a
          WHERE (p_genre_id IS NULL OR a.genre_id = p_genre_id)
            AND (p_search_query IS NULL OR a.search_vector @@ to_tsquery('english', p_search_query)));
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_apps_count(bigint, text) TO anon, authenticated;

SELECT cron.schedule('refresh-genre-counts', '0 * * * *', 'SELECT public.refresh_genre_counts()');

-- F8: the version-stats trigger was FOR EACH ROW, so a bulk version import was
-- O(rows) re-aggregations of the same apps. Statement-level with transition
-- tables recomputes each affected app once per statement. Transition tables
-- forbid multi-event triggers AND column lists, so this is four single-event
-- triggers sharing one function via the common transition-table alias `chg`
-- (NEW side for INSERT + UPDATE, OLD side for DELETE + UPDATE).
CREATE OR REPLACE FUNCTION public.refresh_app_version_stats()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.apps a
  SET version_count = COALESCE(s.cnt, 0), first_version_date = s.first_date
  FROM (
    SELECT ids.app_id, count(v.id) AS cnt, min(v.release_date) AS first_date
    FROM (SELECT DISTINCT app_id FROM chg WHERE app_id IS NOT NULL) ids
    LEFT JOIN public.app_versions v ON v.app_id = ids.app_id
    GROUP BY ids.app_id
  ) s
  WHERE a.id = s.app_id;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_app_version_stats ON public.app_versions;
DROP TRIGGER IF EXISTS trg_app_version_stats_ins ON public.app_versions;
DROP TRIGGER IF EXISTS trg_app_version_stats_upd_new ON public.app_versions;
DROP TRIGGER IF EXISTS trg_app_version_stats_upd_old ON public.app_versions;
DROP TRIGGER IF EXISTS trg_app_version_stats_del ON public.app_versions;
CREATE TRIGGER trg_app_version_stats_ins AFTER INSERT ON public.app_versions
  REFERENCING NEW TABLE AS chg FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_app_version_stats();
CREATE TRIGGER trg_app_version_stats_upd_new AFTER UPDATE ON public.app_versions
  REFERENCING NEW TABLE AS chg FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_app_version_stats();
CREATE TRIGGER trg_app_version_stats_upd_old AFTER UPDATE ON public.app_versions
  REFERENCING OLD TABLE AS chg FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_app_version_stats();
CREATE TRIGGER trg_app_version_stats_del AFTER DELETE ON public.app_versions
  REFERENCING OLD TABLE AS chg FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_app_version_stats();

-- F6: index the two live ORDER BY paths that were seq-scan + sort. Run OUTSIDE a
-- transaction (CONCURRENTLY) so an active ingestion is never blocked.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_apps_first_version_date
  ON public.apps (first_version_date DESC, display_name ASC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_apps_genre_version_count
  ON public.apps (genre_id, version_count DESC, display_name ASC);
