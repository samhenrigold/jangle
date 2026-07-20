# Legacy Store

**[legacystore.app](https://legacystore.app)** is a preservation archive of the early
iOS App Store — roughly its first fifteen years. It's a place to browse classic iPhone
and iPad apps as they were, and, where the archived binary allows, to install those
period versions straight back onto old iOS hardware.

This repository is the website: an [Astro](https://astro.build/) frontend backed by a
[Supabase](https://supabase.com/) (PostgreSQL) database. The scraping, analysis, and
ingestion pipeline that fills that database lives elsewhere and isn't part of this repo.

## What the site does

- **Browse** the catalog of archived apps, by featured picks, category, or charts.
- **Search** across app names, bundle IDs, and metadata.
- **App detail pages** with version history, screenshots, and period-correct icons.
- **Install on device** — over-the-air installs of archived versions onto old iOS
  hardware via `itms-services://` manifests. Desktop browsers get direct `.ipa` downloads.
- **Collections** — curated groupings of apps around a theme or moment.
- **Stats** — a look at the shape and size of the archive.

## A note on the code style

A core goal is that the site stays usable on genuinely old Safari — the same devices the
archived apps target. That constraint shows up throughout the code:

- **Server-rendered, near-zero client JavaScript.** Pages are built on the server so an
  ancient browser only has to render HTML and CSS. Astro runs in SSR mode via the
  Cloudflare adapter (`output: 'server'`).
- **Old-flexbox-friendly CSS**, occasional inline styles, and progressive enhancement
  rather than assuming a modern layout engine.

## Tech stack

- **Frontend:** [Astro](https://astro.build/) (SSR)
- **Database:** [Supabase](https://supabase.com/) / PostgreSQL, read from the site via
  the anon (publishable) key
- **Styling:** CSS with PostCSS, Autoprefixer, and cssnano
- **Hosting:** Cloudflare (via `@astrojs/cloudflare`)

## Local development

Create a `.env` in the repo root (it's gitignored — never commit it) with your Supabase
project's public credentials:

```
SUPABASE_PROJECT_URL=...
SUPABASE_PUBLISHABLE_KEY=...
```

Then:

```
npm install
npm run dev      # serves on http://localhost:4321
```

Other scripts: `npm run build` (production build) and `npm run preview`.

## Project structure

```
/
├── public/                 # Static assets (favicon, robots.txt, theme assets under wsf/)
├── src/
│   ├── components/         # Astro components
│   │   ├── Layout.astro        # HTML shell — title, meta, OG cards, nav
│   │   ├── AppList.astro       # iOS table-style app rows
│   │   ├── SearchForm.astro    # Genre/sort filter bar
│   │   ├── SectionHeader.astro
│   │   ├── Pagination.astro
│   │   └── DbError.astro       # Graceful degraded-database state
│   ├── lib/               # Server-side helpers
│   │   ├── supabase.ts         # Database client
│   │   ├── apps.ts / charts.ts / genres.ts   # Data access
│   │   ├── search.ts           # tsquery sanitizing, pagination clamps
│   │   ├── sorting.ts          # Version sorting, iOS user-agent parsing
│   │   ├── devices.ts          # Device/OS capability logic
│   │   ├── icons.ts / appicons.ts   # Icon selection & proxying
│   │   ├── manifest.ts         # itms-services install manifests
│   │   ├── urls.ts / files.ts / archiveNode.ts   # Archive & download URLs
│   │   ├── cache.ts / http.ts  # Caching + Cache-Control helpers
│   │   ├── timemachine.ts, format.ts, sitemap.ts
│   ├── pages/             # File-based routes
│   │   ├── index.astro         # Home / featured
│   │   ├── app/[id].astro      # App detail + version installs
│   │   ├── categories/         # Category index + per-category lists
│   │   ├── charts/             # Charts
│   │   ├── collections/        # Curated collections
│   │   ├── developer/[id].astro
│   │   ├── search/             # Full-text search
│   │   ├── most-archived/      # Most-mirrored apps
│   │   ├── stats.astro
│   │   ├── contribute.astro / colophon.astro
│   │   ├── manifest/[ipa_id].plist.ts   # OTA install manifest
│   │   ├── icon/[sha].ts, screen/[sha].ts, img.ts   # Content-addressed assets
│   │   ├── ipa/[id].ts         # Download / install redirector
│   │   ├── sitemap.xml.ts, sitemap-[n].xml.ts
│   │   └── 404.astro
│   └── styles/            # Global styles
├── db_schema.sql          # Database schema (reference)
├── supabase_functions.sql # Custom SQL functions (reference)
└── package.json
```

## Data model, briefly

The public data is organized around a handful of core tables:

- **apps** — one row per app (bundle ID, names, developer, icons, category…)
- **app_versions** — the version history behind each app
- **binaries** — content-addressed `.ipa` binaries (deduplicated by hash)
- **ipa_files** — individual archived copies (mirrors) of those binaries
- **archive_items** — the Internet Archive items the copies come from
- **genres**, **collections** — categories and curated groupings

Icons and screenshots are stored content-addressed and served by hash, so the site can
show the *period-authentic* asset for a given version rather than whatever a later
snapshot happened to carry.

## Why "Jangle"?

The internal codename for the original iTunes Store was "Jingle." Alliteration is fun, so
the frontend became Jangle. The public name is Legacy Store.
