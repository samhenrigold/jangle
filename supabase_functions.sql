-- SQL functions for Legacy Store. This file is a DESIGN REFERENCE / journal,
-- NOT the source of truth — the live DB is (functions land via MCP migrations).
-- Do not blind-replay it: it is a partial mirror (extension functions and some
-- app functions live only in the DB). To dump the authoritative bodies:
--   select string_agg(pg_get_functiondef(p.oid), E'\n\n' order by p.proname)
--   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--   where n.nspname='public' and p.prokind='f';
-- The get_apps_sorted_*/get_apps_count/get_genre_top_apps bodies here were
-- re-synced to live 2026-08-27 (they had drifted to a dropped a.icon_url column
-- and omitted the `excluded IS NOT TRUE` filter — replaying the stale copies
-- would have leaked excluded apps into every list page).
--
-- NOTE: this file is a chronological journal. Superseded early definitions of
-- get_apps_sorted_by_version_count / get_apps_sorted_by_first_version_date /
-- get_apps_count / get_genres_with_counts / refresh_app_version_stats were
-- deleted 2026-08-27 (they were dead text — the later, live-verified
-- definitions below always won on re-apply). See git history for the originals.

-- ── Precomputed per-app version stats (perf) — applied 2026-07 in production ──
-- Backing columns for the sort functions above; kept correct by a trigger.
ALTER TABLE public.apps
  ADD COLUMN IF NOT EXISTS version_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_version_date timestamptz;

-- One-time backfill (safe to re-run):
-- UPDATE public.apps a SET version_count = s.cnt, first_version_date = s.first_date
-- FROM (SELECT app_id, COUNT(*) cnt, MIN(release_date) first_date FROM public.app_versions GROUP BY app_id) s
-- WHERE a.id = s.app_id;

-- (refresh_app_version_stats + its row-level trigger lived here; superseded by
-- the statement-level F8 version below.)

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

-- Optimized 2026-07-11 (~9.8s -> ~1.6s): single-pass CTEs collapse the repeated
-- app_versions (~10x) and ipa_files (~4x) scans into one FILTER-ed scan each
-- (exact, identical numbers); the two multi-million-row internal "scale" counts
-- (chart_positions was ~3.6s of heap-fetches, wayback_captures ~0.7s) use O(1)
-- reltuples estimates (autovacuum keeps them within tolerance; every other count
-- stays exact). If you need those two exact, swap the reltuples lines back to
-- count(*) and accept the multi-second scans.
CREATE OR REPLACE FUNCTION public.compute_archive_stats()
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
WITH av AS (
  SELECT
    count(*) FILTER (WHERE coalesce(release_date, estimated_release_date::timestamptz) IS NOT NULL) AS versions_dated,
    min(coalesce(release_date, estimated_release_date::timestamptz))
      FILTER (WHERE coalesce(release_date, estimated_release_date::timestamptz) >= timestamptz '2008-01-01') AS oldest_version,
    count(*) FILTER (WHERE device_family::text[] @> ARRAY['1','2']) AS df_universal,
    count(*) FILTER (WHERE device_family::text[] @> ARRAY['1'] AND NOT device_family::text[] @> ARRAY['2']) AS df_iphone,
    count(*) FILTER (WHERE device_family::text[] @> ARRAY['2'] AND NOT device_family::text[] @> ARRAY['1']) AS df_ipad,
    count(*) FILTER (WHERE price IS NOT NULL) AS p_known,
    count(*) FILTER (WHERE price = 0) AS p_free,
    count(*) FILTER (WHERE price > 0) AS p_paid
  FROM app_versions
),
-- Quarantined binaries (binaries.hidden — a generated column over
-- tamper_status, the single definition of the quarantine set; see the
-- Colophon's "What belongs in the archive") are editorially suppressed:
-- stats must not count them or their file copies. Unclassified binaries
-- (hidden=false) count as clean; `IS NOT TRUE` also passes copies whose
-- binary row is missing (LEFT JOIN).
bins AS (
  SELECT sha1, install_status, architectures, itunes_artwork_sha256, bundle_icon_sha256, has_watch_app
  FROM binaries
  WHERE hidden IS NOT TRUE
),
ipf AS (
  SELECT count(*) AS copies,
         count(*) FILTER (WHERE f.available) AS copies_available,
         sum(f.file_size) AS total_bytes
  FROM ipa_files f
  LEFT JOIN binaries b ON b.sha1 = f.binary_sha1
  WHERE b.hidden IS NOT TRUE
)
SELECT jsonb_build_object(
  'apps',              (SELECT count(*) FROM apps),
  'developers',        (SELECT count(*) FROM developers),
  'versions',          (SELECT count(*) FROM app_versions),
  'binaries',          (SELECT count(*) FROM bins),
  'quarantined',       (SELECT count(*) FROM binaries WHERE hidden),
  'copies',            ipf.copies,
  'copies_available',  ipf.copies_available,
  'archive_items',     (SELECT count(*) FROM archive_items),
  'total_bytes',       ipf.total_bytes,
  'distinct_icons',    (SELECT count(DISTINCT coalesce(bundle_icon_sha256, itunes_artwork_sha256)) FROM bins),
  'wayback_captures',  (SELECT reltuples::bigint FROM pg_class WHERE oid = 'public.wayback_captures'::regclass),
  'listing_snapshots', (SELECT count(*) FROM app_listing_snapshots),
  'reviews',           (SELECT count(*) FROM app_reviews),
  'review_stars',      (SELECT jsonb_object_agg(stars, n) FROM (SELECT stars, count(*) n FROM app_reviews WHERE stars BETWEEN 1 AND 5 GROUP BY 1) s),
  'chart_positions',   (SELECT reltuples::bigint FROM pg_class WHERE oid = 'public.chart_positions'::regclass),
  'chart_snapshots',   (SELECT count(*) FROM chart_snapshots),
  'chart_years',       (SELECT jsonb_build_object('min', min(substr(captured_ts, 1, 4)), 'max', max(substr(captured_ts, 1, 4))) FROM chart_snapshots),
  'install',           (SELECT jsonb_object_agg(coalesce(install_status, 'unknown'), n) FROM (SELECT install_status, count(*) n FROM bins GROUP BY 1) s),
  'archs',             (SELECT jsonb_object_agg(a, n) FROM (SELECT unnest(architectures) a, count(*) n FROM bins GROUP BY 1) s),
  'armv6_only_installable', (SELECT count(*) FROM bins WHERE architectures = ARRAY['armv6'] AND install_status = 'installable'),
  'watch_apps',        (SELECT count(*) FROM bins WHERE has_watch_app),
  'apps_checked',      (SELECT count(*) FROM apps WHERE is_available IS NOT NULL),
  'apps_delisted',     (SELECT count(*) FROM apps WHERE is_available = false),
  -- Known dates only; pre-2008 values are ingest junk (the store opened 2008-07-10)
  'by_year',           (SELECT jsonb_object_agg(yr, n) FROM (
                          SELECT extract(year FROM coalesce(release_date, estimated_release_date::timestamptz))::int yr, count(*) n
                          FROM app_versions
                          WHERE coalesce(release_date, estimated_release_date::timestamptz)
                                BETWEEN timestamptz '2008-01-01' AND now()
                          GROUP BY 1) s),
  'versions_dated',    av.versions_dated,
  'oldest_version',    av.oldest_version,
  'min_os',            (SELECT jsonb_object_agg(v, n) FROM (
                          SELECT split_part(minimum_os_version, '.', 1) v, count(*) n
                          FROM app_versions WHERE minimum_os_version ~ '^[0-9]+' GROUP BY 1) s),
  'device_family',     jsonb_build_object('universal', av.df_universal, 'iphone_only', av.df_iphone, 'ipad_only', av.df_ipad),
  'prices',            jsonb_build_object('known', av.p_known, 'free', av.p_free, 'paid', av.p_paid),
  -- price integers mix currencies; ranking only makes sense within one, so USD
  'priciest',          (SELECT jsonb_agg(x) FROM (
                          SELECT jsonb_build_object('name', a.app_store_name, 'id', a.app_store_id, 'icon', a.live_icon_url,
                            'icon_sha', (SELECT coalesce(b.bundle_icon_sha256, b.itunes_artwork_sha256) FROM app_versions v2 JOIN ipa_files f ON f.app_version_id=v2.id JOIN bins b ON b.sha1=f.binary_sha1 WHERE v2.app_id=a.id AND coalesce(b.bundle_icon_sha256,b.itunes_artwork_sha256) IS NOT NULL ORDER BY v2.release_date ASC NULLS LAST LIMIT 1),
                            'price', v.price_display) x
                          FROM app_versions v JOIN apps a ON a.id = v.app_id
                          WHERE v.price > 0 AND v.price_display LIKE '$%'
                          ORDER BY v.price DESC LIMIT 3) s),
  'most_versions',     (SELECT jsonb_agg(x) FROM (
                          SELECT jsonb_build_object('name', coalesce(display_name, app_store_name), 'id', app_store_id, 'icon', live_icon_url,
                            'icon_sha', (SELECT coalesce(b.bundle_icon_sha256, b.itunes_artwork_sha256) FROM app_versions v2 JOIN ipa_files f ON f.app_version_id=v2.id JOIN bins b ON b.sha1=f.binary_sha1 WHERE v2.app_id=apps.id AND coalesce(b.bundle_icon_sha256,b.itunes_artwork_sha256) IS NOT NULL ORDER BY v2.release_date ASC NULLS LAST LIMIT 1),
                            'n', version_count) x
                          FROM apps WHERE app_store_name IS NOT NULL AND app_store_id IS NOT NULL
                          ORDER BY version_count DESC LIMIT 5) s),
  'biggest',           (SELECT jsonb_agg(x) FROM (
                          SELECT jsonb_build_object('name', a.app_store_name, 'id', a.app_store_id, 'icon', a.live_icon_url,
                            'icon_sha', (SELECT coalesce(b2.bundle_icon_sha256, b2.itunes_artwork_sha256) FROM app_versions v2 JOIN ipa_files f2 ON f2.app_version_id=v2.id JOIN bins b2 ON b2.sha1=f2.binary_sha1 WHERE v2.app_id=a.id AND coalesce(b2.bundle_icon_sha256,b2.itunes_artwork_sha256) IS NOT NULL ORDER BY v2.release_date ASC NULLS LAST LIMIT 1),
                            'bytes', f.file_size) x
                          FROM ipa_files f
                          JOIN bins b ON b.sha1 = f.binary_sha1
                          JOIN app_versions v ON v.id = f.app_version_id
                          JOIN apps a ON a.id = v.app_id
                          WHERE a.app_store_name IS NOT NULL
                          ORDER BY f.file_size DESC NULLS LAST LIMIT 3) s),
  'top_genres',        (SELECT jsonb_agg(x) FROM (
                          SELECT jsonb_build_object('g', g.genre_name, 'gid', g.id, 'n', count(*)) x
                          FROM apps a JOIN genres g ON g.id = a.genre_id
                          GROUP BY g.genre_name, g.id ORDER BY count(*) DESC LIMIT 10) s),
  'apps_with_genre',   (SELECT count(*) FROM apps WHERE genre_id IS NOT NULL),
  -- Real ingest activity: ipa_files.created_at is when the pipeline last archived
  -- a copy (the frequent event). We report that timestamp plus what landed that
  -- day — copies, newly-seen versions, and newly-seen apps — so the stats line
  -- reflects the continuously-running pipeline, not just rare net-new-app days.
  'last_ingest_at',           (SELECT max(created_at) FROM ipa_files),
  'copies_added_last_ingest', (SELECT count(*) FROM ipa_files WHERE created_at::date = (SELECT max(created_at::date) FROM ipa_files)),
  'versions_added_last_ingest',(SELECT count(*) FROM app_versions WHERE created_at::date = (SELECT max(created_at::date) FROM ipa_files)),
  'apps_added_last_ingest',   (SELECT count(*) FROM apps WHERE created_at::date = (SELECT max(created_at::date) FROM ipa_files))
)
FROM av, ipf;
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
-- dead for 2+ days (rare).
--
-- p_fresh forces a live recompute so localhost dev sees uncached numbers. The
-- recompute (compute_archive_stats) takes ~8s, so:
--   * SET statement_timeout gives the recompute branches room (over the anon
--     default), while normal cached reads still return in milliseconds;
--   * a 10s throttle bounds how often p_fresh can recompute;
--   * a single-holder advisory lock means concurrent p_fresh callers serve the
--     cache instead of piling on parallel 8s scans.
-- Together these keep p_fresh from being a DoS lever if anon ever calls it in
-- prod — production code always uses the default (cached) path.
DROP FUNCTION IF EXISTS public.get_archive_stats();
DROP FUNCTION IF EXISTS public.get_archive_stats(boolean);
CREATE OR REPLACE FUNCTION public.get_archive_stats(p_fresh boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '30s'
AS $$
DECLARE
  row_stats jsonb;
  row_at timestamptz;
BEGIN
  SELECT stats, computed_at INTO row_stats, row_at FROM public.archive_stats_cache WHERE id = 1;
  IF row_stats IS NULL
     OR row_at < now() - interval '48 hours'
     OR (p_fresh AND row_at < now() - interval '10 seconds') THEN
    IF pg_try_advisory_xact_lock(hashtext('refresh_archive_stats')) THEN
      -- Re-check under the lock; another session may have just refreshed.
      SELECT stats, computed_at INTO row_stats, row_at FROM public.archive_stats_cache WHERE id = 1;
      IF row_stats IS NULL
         OR row_at < now() - interval '48 hours'
         OR (p_fresh AND row_at < now() - interval '10 seconds') THEN
        PERFORM public.refresh_archive_stats();
        SELECT stats, computed_at INTO row_stats, row_at FROM public.archive_stats_cache WHERE id = 1;
      END IF;
    END IF;
  END IF;
  RETURN jsonb_set(row_stats, '{computed_at}', to_jsonb(row_at));
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_archive_stats(boolean) TO anon, authenticated;

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
  SELECT DISTINCT ON (a.genre_id) a.genre_id, a.id, a.live_icon_url
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
            AND (p_search_query IS NULL OR a.search_vector @@ to_tsquery('english', p_search_query))
            AND a.excluded IS NOT TRUE);
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

-- lib-F4: best all-genre chart placement per app in one indexed query. Replaces a
-- getPeaks() query that used a blanket .limit(1000) across all ids (could truncate
-- an app's true peak as the corpus grows). Uses idx_chart_pos_appstore.
CREATE OR REPLACE FUNCTION public.get_app_peaks(p_app_store_ids bigint[])
RETURNS TABLE (app_store_id bigint, peak_position int, chart_type_id int, snapshot_date text, source_url text)
LANGUAGE sql STABLE
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT ON (cp.app_store_id)
         cp.app_store_id, cp.position, cs.chart_type_id, cs.snapshot_date::text, cs.source_url
  FROM chart_positions cp
  JOIN chart_snapshots cs ON cs.id = cp.chart_snapshot_id
  WHERE cp.app_store_id = ANY(p_app_store_ids)
    AND cs.genre_id IS NULL
  ORDER BY cp.app_store_id, cp.position ASC, cs.snapshot_date ASC;
$$;
GRANT EXECUTE ON FUNCTION public.get_app_peaks(bigint[]) TO anon, authenticated;

-- Maintained actual-position count per snapshot (2026-07-11). Lets the frontend
-- hide sparse captures (<=3 apps) and empty chart_type/device/genre combos via an
-- indexed column instead of aggregating chart_positions (1.1M rows) per request.
-- Backfilled + kept live by a statement-level trigger (chart data is archival).
ALTER TABLE public.chart_snapshots
  ADD COLUMN IF NOT EXISTS position_count integer NOT NULL DEFAULT 0;

-- One-time backfill (safe to re-run):
-- UPDATE public.chart_snapshots cs SET position_count = COALESCE(c.n, 0)
-- FROM (SELECT chart_snapshot_id, count(*) n FROM public.chart_positions GROUP BY 1) c
-- WHERE c.chart_snapshot_id = cs.id;

CREATE OR REPLACE FUNCTION public.refresh_chart_snapshot_count()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public.chart_snapshots cs
  SET position_count = sub.n
  FROM (
    SELECT ids.sid,
           (SELECT count(*) FROM public.chart_positions cp WHERE cp.chart_snapshot_id = ids.sid) AS n
    FROM (SELECT DISTINCT chart_snapshot_id AS sid FROM chg WHERE chart_snapshot_id IS NOT NULL) ids
  ) sub
  WHERE cs.id = sub.sid;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_chart_snapshot_count_ins ON public.chart_positions;
DROP TRIGGER IF EXISTS trg_chart_snapshot_count_del ON public.chart_positions;
CREATE TRIGGER trg_chart_snapshot_count_ins AFTER INSERT ON public.chart_positions
  REFERENCING NEW TABLE AS chg FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_chart_snapshot_count();
CREATE TRIGGER trg_chart_snapshot_count_del AFTER DELETE ON public.chart_positions
  REFERENCING OLD TABLE AS chg FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_chart_snapshot_count();

-- ── Precomputed period-authentic app icon (applied 2026-07-12) ───────────────
-- List surfaces used to derive each app's "oldest icon" per request via a
-- versions→files→binaries fan-out that had to page past PostgREST's 1000-row
-- cap (apps with few files silently lost their icon on a shared page — the
-- Boomerang/Flickr bug). That pick is now precomputed into apps.oldest_icon_sha256
-- and read as one indexed column; getOldestIcons() in the app just selects it.
-- A pg_cron job keeps it fresh against ongoing ingest / quarantine changes.

-- Natural version sort: pad each numeric segment so lexical order = version order.
CREATE OR REPLACE FUNCTION public.version_sort_key(v text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(string_agg(lpad(seg, 6, '0'), '.'), '')
  FROM unnest(string_to_array(regexp_replace(coalesce(v, ''), '[^0-9.]', '', 'g'), '.')) AS seg
  WHERE seg ~ '^[0-9]+$'
$$;

ALTER TABLE public.apps ADD COLUMN IF NOT EXISTS oldest_icon_sha256 text;

-- SQL port of the frontend pickOldestIcon: among an app's CLEAN, icon-bearing
-- binaries take the earliest version; within it prefer the least anachronistic
-- (arm64-only / has-extensions on a claimed iOS<7 row loses) and most
-- store-shaped (installable/encrypted over unknown) copy; prefer the build-time
-- bundle icon over the download-stamped legacy one. p_app_ids NULL = all apps.
-- Non-anomalous oldest icon (plans/012 #3): pick the OLDEST icon in the app's
-- established vocabulary, not a one-off early fluke (Instagram 1.8.7's polaroid
-- appears once; the camera recurs 17+ versions). Cluster each version's icon by
-- its icon_aliases canonical, then take the earliest cluster recurring in >=2
-- versions; fall back to strict oldest when every early icon is a singleton.
CREATE OR REPLACE FUNCTION public.refresh_oldest_icons(p_app_ids bigint[] DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  WITH ver_icon AS (
    SELECT DISTINCT ON (av.id) av.app_id, av.id AS vid,
      public.version_sort_key(av.version_string) AS vk,
      COALESCE(b.bundle_icon_sha256, b.icon_sha256) AS sha
    FROM app_versions av
    JOIN ipa_files f ON f.app_version_id = av.id
    JOIN binaries b ON b.sha1 = f.binary_sha1
    WHERE (b.bundle_icon_sha256 IS NOT NULL OR b.icon_sha256 IS NOT NULL)
      AND b.hidden IS NOT TRUE
      AND (p_app_ids IS NULL OR av.app_id = ANY(p_app_ids))
    ORDER BY av.id,
      CASE WHEN NULLIF(split_part(coalesce(av.minimum_os_version,''), '.', 1), '')::int BETWEEN 1 AND 6
            AND (b.architectures = ARRAY['arm64']::text[] OR b.has_extensions) THEN 1 ELSE 0 END ASC,
      CASE WHEN coalesce(b.install_status,'unknown') IN ('installable','encrypted') THEN 0 ELSE 1 END ASC
  ),
  clustered AS (
    SELECT vi.app_id, vi.vk, COALESCE(al.canonical_sha256, vi.sha) AS cluster
    FROM ver_icon vi LEFT JOIN icon_aliases al ON al.sha256 = vi.sha
  ),
  support AS (
    SELECT app_id, cluster, count(*) AS n_versions, min(vk) AS first_vk
    FROM clustered GROUP BY app_id, cluster
  ),
  pick AS (
    SELECT DISTINCT ON (app_id) app_id, cluster AS sha
    FROM support ORDER BY app_id, (n_versions >= 2) DESC, first_vk ASC
  )
  UPDATE apps a SET oldest_icon_sha256 = pick.sha
  FROM pick WHERE a.id = pick.app_id AND a.oldest_icon_sha256 IS DISTINCT FROM pick.sha;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE apps a SET oldest_icon_sha256 = NULL
  WHERE a.oldest_icon_sha256 IS NOT NULL
    AND (p_app_ids IS NULL OR a.id = ANY(p_app_ids))
    AND NOT EXISTS (
      SELECT 1 FROM app_versions av JOIN ipa_files f ON f.app_version_id = av.id
      JOIN binaries b ON b.sha1 = f.binary_sha1
      WHERE av.app_id = a.id
        AND (b.bundle_icon_sha256 IS NOT NULL OR b.icon_sha256 IS NOT NULL)
        AND b.hidden IS NOT TRUE);
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.refresh_oldest_icons(bigint[]) FROM PUBLIC, anon, authenticated;

-- Keep it fresh (full recompute ~4s). Hourly (30-min was overkill for a 4s job).
SELECT cron.schedule('refresh-oldest-icons', '7 * * * *', 'SELECT public.refresh_oldest_icons()')
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-oldest-icons');

-- get_apps_sorted_* re-created to add oldest_icon_sha256 to the row type, so
-- list pages read the precomputed icon straight from the RPC result (last-wins
-- over the earlier definitions above).
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
  version_count BIGINT, first_version_date TIMESTAMPTZ, oldest_icon_sha256 TEXT
)
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF p_ascending THEN
    RETURN QUERY
      SELECT a.id, a.bundle_id, a.app_store_id, a.app_store_name, a.developer_id, a.genre_id,
             a.copyright, a.live_icon_url, a.display_name, a.executable_name, a.created_at,
             d.artist_name, g.genre_name, a.version_count::bigint, a.first_version_date, a.oldest_icon_sha256
      FROM apps a LEFT JOIN developers d ON a.developer_id = d.id LEFT JOIN genres g ON a.genre_id = g.id
      WHERE (p_genre_id IS NULL OR a.genre_id = p_genre_id)
        AND (p_search_query IS NULL OR a.search_vector @@ to_tsquery('english', p_search_query))
        AND a.excluded IS NOT TRUE
      ORDER BY a.version_count ASC, a.display_name ASC LIMIT p_limit OFFSET p_offset;
  ELSE
    RETURN QUERY
      SELECT a.id, a.bundle_id, a.app_store_id, a.app_store_name, a.developer_id, a.genre_id,
             a.copyright, a.live_icon_url, a.display_name, a.executable_name, a.created_at,
             d.artist_name, g.genre_name, a.version_count::bigint, a.first_version_date, a.oldest_icon_sha256
      FROM apps a LEFT JOIN developers d ON a.developer_id = d.id LEFT JOIN genres g ON a.genre_id = g.id
      WHERE (p_genre_id IS NULL OR a.genre_id = p_genre_id)
        AND (p_search_query IS NULL OR a.search_vector @@ to_tsquery('english', p_search_query))
        AND a.excluded IS NOT TRUE
      ORDER BY a.version_count DESC, a.display_name ASC LIMIT p_limit OFFSET p_offset;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION get_apps_sorted_by_version_count(integer,integer,bigint,boolean,text) TO anon, authenticated;

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
  version_count BIGINT, first_version_date TIMESTAMPTZ, oldest_icon_sha256 TEXT
)
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF p_ascending THEN
    RETURN QUERY
      SELECT a.id, a.bundle_id, a.app_store_id, a.app_store_name, a.developer_id, a.genre_id,
             a.copyright, a.live_icon_url, a.display_name, a.executable_name, a.created_at,
             d.artist_name, g.genre_name, a.version_count::bigint, a.first_version_date, a.oldest_icon_sha256
      FROM apps a LEFT JOIN developers d ON a.developer_id = d.id LEFT JOIN genres g ON a.genre_id = g.id
      WHERE (p_genre_id IS NULL OR a.genre_id = p_genre_id)
        AND (p_search_query IS NULL OR a.search_vector @@ to_tsquery('english', p_search_query))
        AND a.excluded IS NOT TRUE
      ORDER BY a.first_version_date ASC, a.display_name ASC LIMIT p_limit OFFSET p_offset;
  ELSE
    RETURN QUERY
      SELECT a.id, a.bundle_id, a.app_store_id, a.app_store_name, a.developer_id, a.genre_id,
             a.copyright, a.live_icon_url, a.display_name, a.executable_name, a.created_at,
             d.artist_name, g.genre_name, a.version_count::bigint, a.first_version_date, a.oldest_icon_sha256
      FROM apps a LEFT JOIN developers d ON a.developer_id = d.id LEFT JOIN genres g ON a.genre_id = g.id
      WHERE (p_genre_id IS NULL OR a.genre_id = p_genre_id)
        AND (p_search_query IS NULL OR a.search_vector @@ to_tsquery('english', p_search_query))
        AND a.excluded IS NOT TRUE
      ORDER BY a.first_version_date DESC, a.display_name ASC LIMIT p_limit OFFSET p_offset;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION get_apps_sorted_by_first_version_date(integer,integer,bigint,boolean,text) TO anon, authenticated;

-- ============================================================================
-- Definitions below were recovered from the live DB (pg_get_functiondef,
-- 2026-08-27) — they were created via MCP migrations and never checked in,
-- leaving this file stale. Source of truth is still the live DB; keep this
-- file in sync when changing them.
-- ============================================================================

-- Sitemap: every public app slug (app_store_id preferred, internal id fallback).
CREATE OR REPLACE FUNCTION public.get_sitemap_slugs()
 RETURNS json
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(json_agg(slug order by slug), '[]'::json)
  from (
    select distinct coalesce(nullif(app_store_id, 0), id)::text as slug
    from apps where excluded is not true
  ) s;
$function$;

-- Chart/hero icons nearest a snapshot date (precomputed app_icon_timeline).
CREATE OR REPLACE FUNCTION public.get_icons_near_date(p_app_ids bigint[], p_target date)
 RETURNS TABLE(app_id bigint, icon_sha256 text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT DISTINCT ON (t.app_id) t.app_id, t.icon_sha256
  FROM app_icon_timeline t
  WHERE t.app_id = ANY (p_app_ids[1:500])
    AND EXISTS (
      SELECT 1 FROM app_icon_timeline t2
      WHERE t2.app_id = t.app_id AND t2.icon_date <= p_target
    )
  ORDER BY t.app_id,
    abs(t.icon_date - p_target) ASC,
    (t.icon_date > p_target) ASC,
    t.icon_sha256 ASC;
$function$;

-- Public /api/report endpoint (the only anon write path; sanitizes + caps).
CREATE OR REPLACE FUNCTION public.submit_issue_report(p_message text, p_app_id bigint DEFAULT NULL::bigint, p_app_store_id bigint DEFAULT NULL::bigint, p_path text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_msg text;
begin
  -- Strip control characters (keep tab 0x09 and newline 0x0A), trim, cap.
  v_msg := btrim(regexp_replace(coalesce(p_message, ''), '[\x00-\x08\x0B-\x1F\x7F]', '', 'g'));
  if v_msg = '' then
    raise exception 'empty message';
  end if;
  insert into public.issue_reports (message, app_id, app_store_id, path, user_agent)
  values (
    left(v_msg, 4000),
    p_app_id,
    p_app_store_id,
    left(regexp_replace(coalesce(p_path, ''), '[\x00-\x1F\x7F]', '', 'g'), 300),
    left(regexp_replace(coalesce(p_user_agent, ''), '[\x00-\x1F\x7F]', '', 'g'), 500)
  );
end;
$function$;

-- Batch coverage probe for /api/coverage — one RPC resolves ≤500 (bundle_id,
-- version | external_id) probes to per-version install_status counts.
CREATE OR REPLACE FUNCTION public.coverage_lookup(probes jsonb)
 RETURNS TABLE(bundle_id text, version text, external_id bigint, app_store_id bigint, copies jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    coalesce(c.r_bundle_id,    p.bundle_id)    as bundle_id,
    coalesce(c.r_version,      p.version)      as version,
    coalesce(c.r_external_id,  p.external_id)  as external_id,
    coalesce(c.r_app_store_id, p.app_store_id) as app_store_id,
    c.copies
  from rows from (
         jsonb_to_recordset(probes)
           as (bundle_id text, version text, external_id bigint, app_store_id bigint)
       ) with ordinality as p(bundle_id, version, external_id, app_store_id, ord)
  left join lateral (
    with matched as (
      -- external version id route (constrained to the app when an app key is given)
      select av.id
      from app_versions av
      where p.external_id is not null
        and av.external_identifier = p.external_id
        and (
          (p.bundle_id is null and p.app_store_id is null)
          or exists (
            select 1 from apps a
            where a.id = av.app_id
              and (a.bundle_id = p.bundle_id or a.app_store_id = p.app_store_id)
          )
        )
      union
      -- app key (bundle id or store id) + marketing version route
      select av.id
      from app_versions av
      join apps a on a.id = av.app_id
      where p.version is not null
        and av.version_string = p.version
        and (a.bundle_id = p.bundle_id or a.app_store_id = p.app_store_id)
    )
    select
      case when count(distinct a.bundle_id)        = 1 then max(a.bundle_id)          end as r_bundle_id,
      case when count(distinct av.version_string)  = 1 then max(av.version_string)     end as r_version,
      case when count(distinct av.external_identifier) = 1 then max(av.external_identifier) end as r_external_id,
      case when count(distinct a.app_store_id)     = 1 then max(a.app_store_id)        end as r_app_store_id,
      coalesce(
        (select jsonb_object_agg(s.install_status, s.cnt) filter (where s.install_status is not null)
         from (
           select b.install_status, count(*)::int as cnt
           from matched m
           join ipa_files f on f.app_version_id = m.id
           join binaries b  on b.sha1 = f.binary_sha1
           where b.hidden is not true
           group by b.install_status
         ) s),
        '{}'::jsonb
      ) as copies
    from matched m
    join app_versions av on av.id = m.id
    join apps a          on a.id = av.app_id
  ) c on true
  order by p.ord;
$function$;

-- App-page screenshot sets (the snapshot_screenshots view is too slow filtered
-- per app): dedups listing-snapshot sets by content, resolves R2 masters,
-- prefers iphone shots, prefix-collapses subsets, dates each set to a version.
CREATE OR REPLACE FUNCTION public.get_app_screenshots(p_app_store_id bigint, p_max_sets integer DEFAULT 40)
 RETURNS TABLE(captured_at timestamp with time zone, version_string text, shots jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with app as (select id from apps where app_store_id = p_app_store_id),
  dated as (
    select estimated_release_date as vd, version_string,
      lead(estimated_release_date) over (order by estimated_release_date) as next_vd
    from app_versions
    where app_id = (select id from app) and estimated_release_date is not null
  ),
  distinct_json as (
    select distinct on (md5(s.screenshot_urls::text))
      md5(s.screenshot_urls::text) as set_key, s.captured_at, s.screenshot_urls
    from app_listing_snapshots s
    where s.app_store_id = p_app_store_id and s.screenshot_urls is not null
    order by md5(s.screenshot_urls::text), s.captured_at asc
  ),
  exploded as (
    select dj.set_key, dj.captured_at, e.ordinality,
      case when jsonb_typeof(e.value)='object' then coalesce(e.value->>'device','unknown') else 'unknown' end as device,
      case when jsonb_typeof(e.value)='object' then e.value->>'url' else e.value #>> '{}' end as url
    from distinct_json dj
    cross join lateral jsonb_array_elements(dj.screenshot_urls) with ordinality e(value, ordinality)
  ),
  resolved as (
    select ex.set_key, ex.captured_at, ex.ordinality, ex.device, ex.url,
           m.sha256, m.width, m.height
    from exploded ex
    left join screenshot_masters m on m.url = ex.url and m.status = 'ok'
  ),
  pref as (
    select r.*, bool_or(device = 'iphone') over (partition by set_key) as has_iphone
    from resolved r
  ),
  picked as (
    select set_key, captured_at, ordinality, sha256, width, height
    from pref
    where (has_iphone and device = 'iphone') or (not has_iphone)
  ),
  per_set as (
    select set_key, min(captured_at) as captured_at,
      count(*) as n_total, count(sha256) as n_resolved,
      string_agg(sha256, '|' order by ordinality) as content_sig,
      jsonb_agg(jsonb_build_object('sha', sha256, 'w', width, 'h', height) order by ordinality) as shots
    from picked
    group by set_key
  ),
  content_distinct as (
    select distinct on (content_sig) content_sig, captured_at, shots
    from per_set
    where n_resolved = n_total and n_total > 0
    order by content_sig, captured_at asc
  ),
  kept as (
    select c.content_sig, c.shots,
      least(c.captured_at,
        coalesce((select min(c2.captured_at) from content_distinct c2
                  where c2.content_sig <> c.content_sig
                    and (c.content_sig || '|') like (c2.content_sig || '|') || '%'),
                 c.captured_at)) as captured_at
    from content_distinct c
    where not exists (
      select 1 from content_distinct c3
      where c3.content_sig <> c.content_sig
        and (c3.content_sig || '|') like (c.content_sig || '|') || '%'
    )
  ),
  limited as (
    select * from kept order by captured_at asc limit p_max_sets
  )
  select l.captured_at,
    (select d.version_string from dated d
      where d.vd <= l.captured_at
        and (l.captured_at < d.next_vd
             or (d.next_vd is null and l.captured_at < d.vd + interval '120 days'))
      order by d.vd desc limit 1) as version_string,
    l.shots
  from limited l
  order by l.captured_at asc;
$function$;

-- ============================================================================
-- Screenshot-set precompute (2026-08-27). get_app_screenshots recomputed a
-- ~500ms pipeline per call (591k calls/yr) over frozen data. Now:
--   compute_app_screenshots  = the old pipeline (renamed; + lowest-id tiebreak
--                              fix for duplicate app_store_id rows, which made
--                              the old bare subquery THROW for those apps)
--   app_screenshot_sets(_state) = cache tables, per-app watermark = max
--                              app_listing_snapshots.id
--   refresh_app_screenshots  = incremental refresher, pg_cron '47 4 * * *'
--   get_app_screenshots      = reads cache, falls back to live compute for
--                              apps the refresher hasn't reached
-- 517ms -> 2ms measured. Definitions live in migrations
-- app_screenshot_sets_cache + compute_app_screenshots_dup_appid_fix; run
-- select pg_get_functiondef against the live DB for current bodies.
-- ============================================================================

-- ============================================================================
-- Search overhaul (2026-08-27). One ranked search path for every surface:
--   apps.search_vector2      = weighted, trigger-maintained tsvector
--                              (A: display/app_store name, B: developer
--                              artist_name, C: bundle-id words + app_store_id;
--                              all f_unaccent-folded). A generated column
--                              can't reference developers, hence the trigger
--                              (trg_apps_search_vector2 on apps; developer
--                              renames re-fill via trg_developers_search_vector2).
--   search_apps()            = the one search RPC used by /search, /api/v1/apps,
--                              /api/emulator/apps, and /api/suggest. FTS arm
--                              over search_vector2 + trigram/prefix fallback
--                              (fires when FTS <5 hits, or 1-2 char query);
--                              relevance = exact-name*2 + name-prefix*3 +
--                              word-match*1 (+ fuzzy similarity) +
--                              ln(1+version_count) — popularity is continuous
--                              so giants beat 1-version name-squatters, while
--                              the exact nudge keeps the original above its
--                              sequels. LIKE metachars in p_raw escaped;
--                              fuzzy cap ordered by sim + version_count.
--                              Returns rank + total (count(*) OVER ()) so no
--                              separate count call; filters excluded (which
--                              get_apps_count/get_apps_sorted_* never did).
--   Indexes: idx_apps_search_vector2 (gin), idx_apps_name_trgm
--            (gin_trgm_ops over f_unaccent(coalesce(display_name,
--            app_store_name, ''))).
-- Old search_vector column + get_apps_sorted_* stay for non-search list pages.
-- Definitions live in migration search_overhaul_vector2_and_search_apps; run
-- select pg_get_functiondef against the live DB for current bodies.
-- ============================================================================

-- ============================================================================
-- Chart genre-fallback flag (2026-08-27). Sam spotted two impossible charts;
-- content-hashing every snapshot (md5 of position-ordered app ids) found
-- 2,152 genre-labeled snapshots byte-identical to a differently-labeled
-- same-day chart — the upstream feed silently ignored the genre param:
--   2,099 dump-era "new*" feeds 2021-06-20..2021-09-04 (Apple's new-apps RSS
--         dead by then: same alphabetical list for every genre),
--   45 rss new-noteworthy genre fallbacks 2010-2013,
--   1 rss top-paid 2013-05-27 genre=6026, 7 scattered dump t1/t2.
-- chart_snapshots.genre_fallback = DERIVED boolean, recomputed by
-- refresh_chart_genre_fallback() (run after chart ingests). Raw positions
-- untouched. Consumers: getSnapshotIndex + getAppChartHistory filter it.
-- get_app_peaks was already safe (genre_id IS NULL only). Definition in
-- migration chart_snapshots_genre_fallback_flag.
-- ============================================================================

-- ============================================================================
-- Representative icons (2026-08-27). apps.rep_icon_sha256 = DERIVED: the icon
-- identity an app WORE LONGEST (per-version bundle icons folded through
-- icon_aliases to canonical = largest same-design copy; clusters scored by
-- calendar span of versions wearing them, tiebreak version count, then later
-- era). The recognizable icon (Uber = dark-U badge, Instagram = classic
-- camera, Twitter = bird) vs oldest_icon_sha256's period-authentic earliest
-- (UC / Polaroid / Tweetie bubble). refresh_rep_icons(p_app_ids) recomputes
-- (~seconds, full corpus); pg_cron 'refresh-rep-icons' hourly at :11.
-- Consumers: getOldestIcons prefers rep→oldest; search_apps now returns
-- coalesce(rep_icon_sha256, oldest_icon_sha256) in its oldest_icon_sha256
-- column (updated live 2026-08-27, after migration search_apps_blended_
-- popularity_score). Per-version icons, charts date-near icons, and the app
-- header (large_icon_sha256) unchanged. Migration: rep_icon_sha256.
-- ============================================================================
