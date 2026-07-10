# Jangle (Legacy Store)

A web application for browsing and exploring archived iOS applications from the early App Store era. Built with Astro and Supabase.

## Features

- **Browse Apps**: Explore a catalog of archived iOS applications
- **Search**: Full-text search across app names, bundle IDs, and metadata
- **Filter by Genre**: Browse apps by category
- **Sort Options**: Sort by version count or release date
- **App Details**: View detailed information about each app, including version history
- **Install on Device**: OTA install of archived versions straight onto old iOS hardware via `itms-services://` manifests (desktop browsers get direct IPA downloads)

A goal for this project is to be accessible on older versions of Safari, so a good number of these components use weird flexbox syntax and inline styles. That's also why a lot of this site uses SSR and minimal client scripting.

## Tech Stack

- **Frontend**: [Astro](https://astro.build/) - Static site generation with SSR support
- **Database**: [Supabase](https://supabase.com/) (PostgreSQL)
- **Styling**: CSS with PostCSS and Autoprefixer
- **Deployment**: Cloudflare Pages (project `jangle`, via the `@astrojs/cloudflare` adapter)

## Local development

Create a `.env` in the repo root (never commit it) with your Supabase project
credentials — variable names only:

```
SUPABASE_PROJECT_URL=...
SUPABASE_PUBLISHABLE_KEY=...
```

Then `npm install` and `npm run dev` (serves on `http://localhost:4321`).

## Project Structure

```
/
├── public/                  # Static assets (iOS UI slices, icons, robots.txt)
│   ├── UINavigationBar/     # Nav bar / button 3-slice images
│   ├── UISearchField/       # Search field slices
│   └── UISegmentBar/        # Segmented control slices
├── src/
│   ├── components/          # Astro components
│   │   ├── Layout.astro     # HTML shell (title, meta, nav)
│   │   ├── TopNavigation.astro  # Nav bar (tabs + search; mobile search rows)
│   │   ├── SegmentedControl.astro
│   │   ├── SearchField.astro / SearchButton.astro
│   │   ├── SearchForm.astro # Genre/sort filter bar on /search
│   │   └── AppList.astro    # iOS table-style app rows
│   ├── lib/                 # Utility functions
│   │   ├── supabase.ts      # Database client
│   │   ├── cache.ts         # In-memory caching
│   │   ├── http.ts          # Cache-Control helpers (incl. degraded 503s)
│   │   ├── search.ts        # tsquery sanitizing, pagination clamps
│   │   ├── sorting.ts       # Version sorting, iOS UA parsing
│   │   ├── genres.ts        # Genre ordering (Games subgenres)
│   │   ├── icons.ts         # Icon URL proxying (mixed-content fix)
│   │   ├── urls.ts          # IPA download URLs
│   │   ├── manifest.ts      # itms-services manifest XML
│   │   └── format.ts        # Date formatting
│   ├── pages/               # Routes (file-based routing)
│   │   ├── index.astro      # Home/featured page
│   │   ├── app/[id].astro   # App detail + version installs
│   │   ├── categories/      # Genre index + per-genre lists
│   │   ├── charts/          # Top 25
│   │   ├── search/          # Full-text search
│   │   ├── manifest/[ipa_id].plist.ts  # OTA install manifest
│   │   ├── img.ts           # Same-origin icon proxy
│   │   ├── sitemap.xml.ts
│   │   └── 404.astro
│   └── styles/              # Global styles
├── db_schema.sql            # Database schema
├── supabase_functions.sql   # Custom SQL functions
└── package.json
```

## UI Components

The project includes custom iOS-style UI components built from the original
UIKit image slices in `public/`:
- **TopNavigation**: iOS-style navigation bar (tabs + search field; on the
  search page phones get a search row with the tab bar beneath it)
- **SegmentedControl**: iOS-style segmented control for tab switching
- **SearchField** / **SearchButton**: iOS-style search input and nav button

## Database Schema Overview

The database consists of six main tables:

- **apps**: Core app information (bundle ID, name, icon, etc.)
- **app_versions**: Version history for each app
- **developers**: App developer/publisher information
- **genres**: App Store categories
- **archive_items**: References to Internet Archive items
- **ipa_files**: IPA file metadata and processing status

## Why "jangle"?

The codename for the iTunes Store was "Jingle" and alliteration is fun.