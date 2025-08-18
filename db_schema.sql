-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.app_versions (
  id bigint NOT NULL DEFAULT nextval('app_versions_id_seq'::regclass),
  app_id bigint,
  version_string text,
  build_number text,
  external_identifier integer,
  all_external_identifiers ARRAY,
  release_date timestamp with time zone,
  price integer,
  price_display text,
  minimum_os_version text,
  supported_device_ids ARRAY,
  device_family ARRAY,
  rating_label text,
  rating_rank integer,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT app_versions_pkey PRIMARY KEY (id),
  CONSTRAINT app_versions_app_id_fkey FOREIGN KEY (app_id) REFERENCES public.apps(id)
);
CREATE TABLE public.apps (
  id bigint NOT NULL DEFAULT nextval('apps_id_seq'::regclass),
  bundle_id text NOT NULL UNIQUE,
  app_store_id integer,
  app_store_name text,
  developer_id bigint,
  genre_id bigint,
  copyright text,
  icon_url text,
  display_name text,
  executable_name text,
  search_vector tsvector DEFAULT to_tsvector('english'::regconfig, ((((COALESCE(app_store_name, ''::text) || ' '::text) || COALESCE(display_name, ''::text)) || ' '::text) || COALESCE(bundle_id, ''::text))),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT apps_pkey PRIMARY KEY (id),
  CONSTRAINT apps_developer_id_fkey FOREIGN KEY (developer_id) REFERENCES public.developers(id),
  CONSTRAINT apps_genre_id_fkey FOREIGN KEY (genre_id) REFERENCES public.genres(id)
);
CREATE TABLE public.archive_items (
  id bigint NOT NULL DEFAULT nextval('archive_items_id_seq'::regclass),
  ia_item_id text NOT NULL UNIQUE,
  title text,
  description text,
  uploader text,
  date_uploaded date,
  last_processed timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT archive_items_pkey PRIMARY KEY (id)
);
CREATE TABLE public.developers (
  id bigint NOT NULL DEFAULT nextval('developers_id_seq'::regclass),
  artist_id integer UNIQUE,
  artist_name text,
  vendor_id integer,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT developers_pkey PRIMARY KEY (id)
);
CREATE TABLE public.genres (
  id bigint NOT NULL DEFAULT nextval('genres_id_seq'::regclass),
  genre_id integer UNIQUE,
  genre_name text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT genres_pkey PRIMARY KEY (id)
);
CREATE TABLE public.ipa_files (
  id bigint NOT NULL DEFAULT nextval('ipa_files_id_seq'::regclass),
  archive_item_id bigint,
  app_version_id bigint,
  filename text NOT NULL,
  file_size bigint,
  md5_hash text,
  sha1_hash text,
  processed_at timestamp with time zone,
  processing_error text,
  has_itunes_metadata boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  info_plist_path text,
  itunes_metadata_path text,
  has_itunes_artwork boolean,
  CONSTRAINT ipa_files_pkey PRIMARY KEY (id),
  CONSTRAINT ipa_files_archive_item_id_fkey FOREIGN KEY (archive_item_id) REFERENCES public.archive_items(id),
  CONSTRAINT ipa_files_app_version_id_fkey FOREIGN KEY (app_version_id) REFERENCES public.app_versions(id)
);