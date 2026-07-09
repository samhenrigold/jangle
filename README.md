# Jangle (Legacy Store)

A web application for browsing and exploring archived iOS applications from the early App Store era. Built with Astro and Supabase.

## Features

- **Browse Apps**: Explore a catalog of archived iOS applications
- **Search**: Full-text search across app names, bundle IDs, and metadata
- **Filter by Genre**: Browse apps by category
- **Sort Options**: Sort by version count or release date
- **App Details**: View detailed information about each app, including version history

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
├── public/               # Static assets (images, icons)
│   └── UINavigationBar/  # iOS-style UI elements
├── src/
│   ├── components/       # Astro components
│   │   ├── AppList.astro
│   │   ├── Layout.astro
│   │   ├── SearchField.astro
│   │   └── ...
│   ├── lib/             # Utility functions
│   │   ├── supabase.ts  # Database client
│   │   ├── cache.ts     # In-memory caching
│   │   └── sorting.ts   # Sorting utilities
│   ├── pages/           # Routes (file-based routing)
│   │   ├── index.astro  # Home/featured page
│   │   ├── app/[id].astro
│   │   ├── categories/
│   │   ├── charts/
│   │   └── search/
│   └── styles/          # Global styles
├── db_schema.sql        # Database schema
├── supabase_functions.sql  # Custom SQL functions
└── package.json
```

## UI Components

The project includes custom iOS-style UI components:
- **TopNavigation**: iOS-style navigation bar with back buttons
- **SearchNavigation**: Search bar with iOS styling
- **SegmentedControl**: iOS-style segmented control for tab switching
- **SearchField**: iOS-style search input field

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