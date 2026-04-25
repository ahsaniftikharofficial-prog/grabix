# CLAUDE.md — GRABIX Project Reference

> **How to use this file:**
> Paste this entire file at the start of any AI chat session before describing your problem.
> The AI will then know exactly what GRABIX is, how every piece connects, and which files to ask for.
> After fixing a bug or making a major change, update the relevant section so this file stays accurate.

---

## 1. What Is GRABIX?

GRABIX is a **Windows desktop application** for downloading, streaming, and managing all kinds of media — movies, TV shows, anime, manga — from one place.

- Users can paste any video URL and download it (via yt-dlp + aria2c)
- Users can browse and stream Movies, TV Shows, Anime, and read Manga — all with metadata from TMDB, IMDb, AniList, MangaDex
- Users can manage a local library of downloaded files
- The app has profiles, favorites, ratings, watch history, adult content lock, and a built-in video player
- It is a **Tauri v2** desktop app (Rust shell wrapping a React web UI), with a separate **Python FastAPI** backend that runs locally on the user's machine

---

## 2. Tech Stack

### Frontend (UI)
| Layer | Technology |
|---|---|
| Framework | React 19 + TypeScript 5.8 |
| Styling | Tailwind CSS v4 |
| Build tool | Vite 7 |
| Desktop shell | Tauri v2 (Rust) |
| Video playback | hls.js |
| Auth/DB (optional) | Supabase JS client |
| Package manager | npm |

### Backend (local server)
| Layer | Technology |
|---|---|
| Framework | Python + FastAPI + Uvicorn |
| Download engine | yt-dlp + aria2c + FFmpeg |
| HTTP client | httpx + curl_cffi |
| Database | SQLite (via db_helpers.py) |
| Content APIs | TMDB, IMDb (cinemagoer), Consumet, MovieBox, MangaDex, AniList, Jikan, ComicK |
| Package manager | pip |

### Desktop (Rust / Tauri)
- Entry: `grabix-ui/src-tauri/src/main.rs` + `lib.rs`
- Bundles the Python backend binary and frontend into an NSIS installer
- Backend port: `8000` by default (configurable via `GRABIX_BACKEND_PORT`)
- Frontend communicates with backend at `http://127.0.0.1:8000`

---

## 3. Project File Structure

```
grabix-master/
│
├── CLAUDE.md                        ← YOU ARE HERE
├── README.md
├── run.bat                          ← Starts both backend + frontend (dev)
├── 1__Backend.bat                   ← Starts backend only
├── 2__Frontend.bat                  ← Starts frontend only
├── build-fast.bat                   ← Quick build script
├── grabix-backend.spec              ← PyInstaller spec (bundles Python backend)
│
├── backend/                         ← PYTHON BACKEND (FastAPI)
│   ├── main.py                      ← ★ MAIN ENTRY POINT — FastAPI app, all routers registered here
│   ├── db_helpers.py                ← SQLite DB connection, all download job CRUD, settings load/save
│   ├── library_helpers.py           ← Library index builder, DB migration
│   ├── streaming_helpers.py         ← HLS proxy, stream URL extraction, embed resolvers
│   ├── requirements.txt             ← Python dependencies
│   ├── runtime-config.json          ← Runtime overrides (port, TMDB token, paths)
│   │
│   ├── app/
│   │   ├── routes/                  ← FastAPI routers (each file = one feature area)
│   │   │   ├── downloads.py         ← /downloads — list, add, cancel, pause/resume downloads
│   │   │   ├── streaming.py         ← /stream — stream proxy, HLS variants, embed resolution
│   │   │   ├── metadata.py          ← /metadata — TMDB movie/TV details, search
│   │   │   ├── providers.py         ← /providers — anime/movie stream provider status + resolution
│   │   │   ├── settings.py          ← /settings — read/write user settings
│   │   │   ├── manga.py             ← /manga — manga search, chapters, pages
│   │   │   ├── subtitles.py         ← /subtitles — subtitle fetch and proxy
│   │   │   ├── adblock.py           ← /adblock — ad filter list management
│   │   │   └── consumet.py          ← /consumet — anime episode sources (Consumet API wrapper)
│   │   │
│   │   └── services/
│   │       ├── providers.py         ← Re-export shim (imports from split files below)
│   │       ├── provider_types.py    ← BaseProviderAdapter, ProviderPolicy, error types
│   │       ├── provider_registry.py ← ProviderRegistry class (circuit breaker pattern)
│   │       ├── provider_adapters.py ← Concrete adapters for each streaming provider
│   │       ├── provider_resolvers.py← resolve_movie_playback(), resolve_tv_playback()
│   │       ├── provider_helpers.py  ← Pure helper functions for stream resolution
│   │       ├── tmdb.py              ← TMDB API calls (server-side, cached)
│   │       ├── imdb.py              ← IMDb data via cinemagoer
│   │       ├── subtitles.py         ← Subtitle download/conversion logic
│   │       ├── settings_service.py  ← Settings read/write logic, adult content password
│   │       ├── runtime_config.py    ← Reads runtime-config.json + env vars (port, paths, tokens)
│   │       ├── runtime_state.py     ← RuntimeStateRegistry — shared in-memory state (downloads dict)
│   │       ├── security.py          ← URL validation, path safety, allowed hosts
│   │       ├── network_policy.py    ← Outbound URL policy enforcement
│   │       ├── desktop_auth.py      ← Desktop auth token validation (X-Grabix-Auth header)
│   │       ├── errors.py            ← json_error_response() helper
│   │       ├── logging_utils.py     ← Structured logging, log file paths
│   │       ├── adblock_service.py   ← Ad filter list download + matching
│   │       ├── archive_installer.py ← ZIP extraction for runtime tool installs
│   │       ├── history.py           ← Watch history helpers
│   │       ├── stream_extractors.py ← Low-level stream URL extraction
│   │       ├── manga_anilist.py     ← AniList manga API
│   │       ├── manga_comick.py      ← ComicK manga API
│   │       ├── manga_jikan.py       ← Jikan (MyAnimeList) manga API
│   │       ├── manga_mangadex.py    ← MangaDex API
│   │       └── manga_cache.py       ← Manga result caching
│   │
│   ├── core/                        ← Phase 2 split — infrastructure helpers
│   │   ├── main.py                  ← ⚠️ OLD/duplicate of backend/main.py — DO NOT USE as entry point
│   │   ├── cache.py                 ← SQLite-backed cache primitives
│   │   ├── cache_ops.py             ← Cache get/set/refresh ops + /cache router
│   │   ├── circuit_breaker.py       ← CircuitBreaker class for provider fault tolerance
│   │   ├── download_helpers.py      ← Download normalization, category inference, auto-retry
│   │   ├── health.py                ← /health /capabilities /diagnostics endpoints
│   │   ├── network_monitor.py       ← Background network monitoring
│   │   ├── state.py                 ← Shared state wiring
│   │   └── utils.py                 ← General utilities
│   │
│   ├── moviebox/                    ← MovieBox content provider
│   │   ├── moviebox_fetchers.py     ← Fetch movie/TV data from MovieBox API
│   │   ├── moviebox_helpers.py      ← URL builders, response normalizers
│   │   ├── moviebox_loader.py       ← Background loader + session restore
│   │   └── routes.py                ← /moviebox router
│   │
│   └── tests/                       ← pytest test suite
│       ├── test_features.py
│       ├── test_security.py
│       ├── test_runtime.py
│       └── ... (other test files)
│
└── grabix-ui/                       ← REACT FRONTEND (Tauri app)
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.js
    ├── index.html
    │
    ├── src/
    │   ├── main.tsx                 ← React entry point (mounts <App />)
    │   ├── App.tsx                  ← ★ Root component — routing, runtime health polling, page shell
    │   ├── App.css / index.css      ← Global styles and CSS variables
    │   │
    │   ├── pages/                   ← One file per page/view
    │   │   ├── DownloaderPage.tsx   ← Main downloader UI (paste URL → download)
    │   │   ├── ConverterPage.tsx    ← File converter UI
    │   │   ├── LibraryPage.tsx      ← Local file library browser
    │   │   ├── MangaPage.tsx        ← Manga reader
    │   │   ├── MediaPage.tsx        ← Movie/TV detail + playback
    │   │   ├── MoviesPage.tsx       ← Browse movies (TMDB)
    │   │   ├── TVSeriesPage.tsx     ← Browse TV shows (TMDB)
    │   │   ├── MovieBoxPage.tsx     ← MovieBox streaming source
    │   │   ├── GenrePage.tsx        ← Browse by genre
    │   │   ├── FavoritesPage.tsx    ← User's saved favorites
    │   │   ├── RatingsPage.tsx      ← User's rated content
    │   │   ├── SettingsPage.tsx     ← App settings UI
    │   │   ├── WatchHistoryPage.tsx ← Viewing history
    │   │   ├── ContinueWatchingPage.tsx ← Resume watching
    │   │   ├── TopImdbPage.tsx      ← IMDb Top 250 charts
    │   │   ├── NewAndHotPage.tsx    ← Trending/new content
    │   │   ├── RecentlyAddedPage.tsx← Recently added to library
    │   │   ├── BrowsePage.tsx       ← General browse
    │   │   ├── ExplorePage.tsx      ← Explore/discover
    │   │   ├── DownloaderPreview.tsx← Download preview modal
    │   │   ├── QueueCard.tsx        ← Individual download queue item
    │   │   ├── VidSrcPlayer.tsx     ← Embedded VidSrc player page
    │   │   ├── downloader.types.ts  ← TypeScript types for downloader
    │   │   └── useDownloaderQueue.ts← Hook for download queue state
    │   │
    │   ├── components/
    │   │   ├── Sidebar.tsx          ← Main nav sidebar (page switcher)
    │   │   ├── Topbar.tsx           ← Top bar component
    │   │   ├── AppToast.tsx         ← Toast notification system
    │   │   ├── CachedImage.tsx      ← Image with cache + fallback
    │   │   ├── DownloadOptionsModal.tsx ← Quality/format picker for downloads
    │   │   ├── ErrorBoundary.tsx    ← React error boundary wrapper
    │   │   ├── Icons.tsx            ← SVG icon components
    │   │   ├── Icons_addition.tsx   ← Extra SVG icons
    │   │   ├── OfflineBanner.tsx    ← "Backend offline" banner
    │   │   ├── WatchdogBanner.tsx   ← Download watchdog status banner
    │   │   ├── PageStates.tsx       ← Loading/empty/error states
    │   │   ├── SubtitlePanel.tsx    ← Subtitle selection UI
    │   │   ├── TrimSlider.tsx       ← Video trim range slider
    │   │   ├── VidSrcPlayer.tsx     ← VidSrc iframe player component
    │   │   │
    │   │   ├── player/              ← Custom HLS video player
    │   │   │   ├── useHlsEngine.ts  ← hls.js setup and management
    │   │   │   ├── usePlayerControls.ts ← Play/pause/seek/volume controls
    │   │   │   ├── usePlayerState.ts    ← Player state (current time, buffered, etc.)
    │   │   │   ├── useSourceManager.ts  ← Source switching and quality selection
    │   │   │   ├── useSubtitleEngine.ts ← Subtitle rendering engine
    │   │   │   ├── MiniPlayer.tsx       ← Picture-in-picture mini player
    │   │   │   ├── NextEpisodeCountdown.tsx ← Auto-play next episode countdown
    │   │   │   ├── SkipButton.tsx       ← Skip intro/outro button
    │   │   │   ├── SpeedSelector.tsx    ← Playback speed selector
    │   │   │   ├── helpers.ts           ← Player utility functions
    │   │   │   └── types.ts             ← Player TypeScript types
    │   │   │
    │   │   ├── movies/              ← Movie browsing components
    │   │   │   ├── MovieCard.tsx    ← Single movie card (poster + info)
    │   │   │   ├── MovieGrid.tsx    ← Grid layout for movies
    │   │   │   ├── MovieRow.tsx     ← Horizontal scroll row
    │   │   │   └── TopTenRow.tsx    ← Top 10 numbered row
    │   │   │
    │   │   ├── tv/                  ← TV show browsing components
    │   │   │   ├── TVCard.tsx
    │   │   │   ├── TVGrid.tsx
    │   │   │   ├── TVRow.tsx
    │   │   │   └── TopTenRow.tsx
    │   │   │
    │   │   ├── search/              ← Search UI components
    │   │   │   ├── LiveSearch.tsx   ← Real-time search input
    │   │   │   ├── MoodPills.tsx    ← Mood-based filter pills
    │   │   │   └── SearchFilters.tsx← Advanced filter dropdowns
    │   │   │
    │   │   ├── shared/              ← Generic reusable components
    │   │   │   ├── BadgeOverlay.tsx ← Badge (HD, NEW, etc.) overlay
    │   │   │   ├── HoverCard.tsx    ← Hover preview card
    │   │   │   ├── NotificationBell.tsx ← Notification icon
    │   │   │   ├── ProgressBar.tsx  ← Watch progress bar
    │   │   │   └── RatingButtons.tsx← Like/dislike rating buttons
    │   │   │
    │   │   ├── profile/             ← User profile components
    │   │   │   ├── KidsProfile.tsx  ← Kids mode profile UI
    │   │   │   └── ProfileSwitcher.tsx ← Profile selection UI
    │   │   │
    │   │   └── hero/
    │   │       └── TrailerBackground.tsx ← Hero section trailer background
    │   │
    │   ├── context/                 ← React Context providers
    │   │   ├── ThemeContext.tsx      ← Dark/light theme
    │   │   ├── FavoritesContext.tsx  ← Favorites list (localStorage)
    │   │   ├── ContentFilterContext.tsx ← Adult content filter
    │   │   ├── RuntimeHealthContext.tsx ← Backend health state
    │   │   └── ProfileContext.tsx   ← Multi-profile management (up to 5 profiles)
    │   │
    │   ├── hooks/                   ← Custom React hooks
    │   │   ├── useContinueWatching.ts ← Resume watch state
    │   │   ├── useMiniPlayer.ts     ← Mini player state + provider
    │   │   ├── useNotifications.ts  ← In-app notification queue
    │   │   ├── useRatings.ts        ← Like/dislike rating state
    │   │   ├── useRemindMe.ts       ← Remind-me feature
    │   │   └── useSeenIds.ts        ← Track seen content IDs
    │   │
    │   └── lib/                     ← Utility libraries
    │       ├── api.ts               ← ★ Backend API client (BACKEND_API, backendJson, health polling)
    │       ├── tmdb.ts              ← TMDB API calls (browser-side, uses VITE_TMDB_TOKEN)
    │       ├── appSettings.ts       ← App settings helpers
    │       ├── cache.ts             ← Frontend cache utilities
    │       ├── consumetProviders.ts ← Consumet anime provider list
    │       ├── contentFilter.ts     ← Content filtering logic
    │       ├── downloads.ts         ← Download trigger helpers
    │       ├── imdbCharts.ts        ← IMDb chart fetching
    │       ├── mangaOffline.ts      ← Offline manga reading
    │       ├── mangaProviders.ts    ← Manga provider calls
    │       ├── mangaZip.ts          ← Manga ZIP download
    │       ├── mediaCache.ts        ← Media metadata cache
    │       ├── moodKeywords.ts      ← Mood-based search keywords
    │       ├── performance.ts       ← Performance marks/measures
    │       ├── persistentState.ts   ← localStorage read/write helpers
    │       ├── streamProviders.ts   ← Stream source fetching (MovieBox etc.)
    │       ├── supabase.ts          ← Supabase client (optional auth)
    │       ├── topRatedMedia.ts     ← Top rated content helpers
    │       ├── trailerResolver.ts   ← Trailer URL resolution
    │       ├── useOfflineDetection.ts ← Backend offline detector hook
    │       ├── useRetryWithBackoff.ts ← Exponential backoff retry hook
    │       └── useWatchdog.ts       ← Download watchdog hook
    │
    └── src-tauri/                   ← Tauri/Rust desktop shell
        ├── tauri.conf.json          ← Tauri config (window, CSP, bundle targets)
        ├── Cargo.toml               ← Rust dependencies
        ├── src/
        │   ├── main.rs              ← Rust main entry
        │   └── lib.rs               ← Tauri commands / setup
        └── capabilities/default.json ← Tauri permission capabilities
```

---

## 4. How the Pieces Connect

```
User clicks something
        ↓
React Page (e.g. MoviesPage.tsx)
        ↓
lib/api.ts → backendJson("/endpoint")   OR   lib/tmdb.ts → fetch TMDB directly
        ↓                                              ↓
FastAPI backend (127.0.0.1:8000)            TMDB API (external)
        ↓
app/routes/*.py  →  app/services/*.py
        ↓
SQLite DB (db_helpers.py)  |  yt-dlp/FFmpeg/aria2c  |  External APIs (TMDB, Consumet, etc.)
```

### Key data flows:
- **Download flow:** `DownloaderPage` → `backendJson("/downloads", POST)` → `app/routes/downloads.py` → `downloads/engine.py` → yt-dlp / aria2c
- **Stream/watch flow:** `MediaPage` → `app/routes/providers.py` → `provider_adapters.py` → external stream providers → HLS URL → player components
- **Anime flow:** `app/routes/consumet.py` → Consumet API (self-hosted or public)
- **Manga flow:** `MangaPage` → `app/routes/manga.py` → `manga_mangadex.py` / `manga_anilist.py` etc.
- **Health check:** `App.tsx` polls `/health` every 2500ms → `RuntimeHealthContext` → `OfflineBanner` / `WatchdogBanner`
- **Settings:** `SettingsPage` → `backendJson("/settings")` → `settings_service.py` → `runtime-config.json`

---

## 5. Environment Variables & Configuration

### Backend env vars (set in shell or runtime-config.json)
| Variable | Purpose | Default |
|---|---|---|
| `GRABIX_BACKEND_PORT` | Backend port | `8000` |
| `GRABIX_TMDB_BEARER_TOKEN` | TMDB API token | — |
| `GRABIX_APP_STATE_ROOT` | Where DB + settings are stored | `~/Downloads/GRABIX` |
| `GRABIX_PACKAGED_MODE` | `1` = running as installed app | `0` (dev) |
| `GRABIX_DESKTOP_AUTH_TOKEN` | Auth token for desktop requests | — |

### Frontend env vars (set in `grabix-ui/.env`)
| Variable | Purpose |
|---|---|
| `VITE_GRABIX_API_BASE` | Backend URL (default: `http://127.0.0.1:8000`) |
| `VITE_TMDB_TOKEN` | TMDB Bearer token for direct browser calls |
| `VITE_TMDB_KEY` | TMDB API v3 key (alternative to Bearer token) |

---

## 6. Key Backend API Endpoints

| Route | Method | What it does |
|---|---|---|
| `/` | GET | Health check — returns `{"status": "GRABIX Backend Running"}` |
| `/health` | GET | Full service health report |
| `/health/capabilities` | GET | What features are available |
| `/diagnostics` | GET | Startup diagnostics |
| `/downloads` | GET | List all download jobs |
| `/downloads` | POST | Start a new download |
| `/downloads/{id}/pause` | POST | Pause a download |
| `/downloads/{id}/resume` | POST | Resume a download |
| `/downloads/{id}/cancel` | DELETE | Cancel a download |
| `/check-link` | GET | Validate a URL and get available formats |
| `/stream/...` | GET/POST | Stream proxy and HLS variant fetching |
| `/providers/status` | GET | Status of all stream providers |
| `/providers/resolve/movie` | POST | Resolve a movie stream URL |
| `/providers/resolve/tv` | POST | Resolve a TV episode stream URL |
| `/metadata/movie/{id}` | GET | TMDB movie details |
| `/metadata/tv/{id}` | GET | TMDB TV show details |
| `/manga/search` | GET | Search manga |
| `/manga/chapters/{id}` | GET | Get manga chapters |
| `/subtitles/...` | GET | Subtitle fetch |
| `/settings` | GET/POST | Read/write settings |
| `/moviebox/...` | GET | MovieBox content |

---

## 7. Coding Rules & Conventions

### Python (backend)
- All routes live in `app/routes/` — one file per feature area
- Services (business logic) live in `app/services/`
- Infrastructure helpers live in `core/`
- `backend/main.py` is the **real** entry point — `backend/core/main.py` is an old Phase 2 artifact, ignore it
- Never add logic to `app/services/providers.py` — it is a re-export shim only
- Use `get_logger("name")` from `logging_utils.py` for all logging
- Use `log_event(logger, level, event=..., message=..., ...)` for structured logs
- All DB ops go through `db_helpers.py` — never raw SQLite in route files
- `runtime_config.py` is the single source of truth for paths and env vars

### TypeScript / React (frontend)
- All pages are lazy-loaded in `App.tsx` via `lazy(() => import(...))`
- Navigation is done by setting the `page` state — never use React Router
- Custom navigation events: `window.dispatchEvent(new CustomEvent("grabix:navigate", { detail: { page } }))`
- Backend calls go through `backendJson()` or `backendFetch()` from `lib/api.ts`
- TMDB calls from browser use `lib/tmdb.ts` (falls back to backend if no env key)
- State management: React Context only — no Redux, no Zustand
- localStorage helpers: use `readJsonStorage()` / `writeJsonStorage()` from `lib/persistentState.ts`
- All pages are wrapped in `<ErrorBoundary>` in App.tsx

---

## 8. Current Development Status

**Current Phase: Phase 4 — Streaming APIs**

Working on adding and stabilizing APIs for anime, manga, movies, and TV show streaming.

Completed:
- Phase 1 — Foundation (Tauri shell, FastAPI backend wiring)
- Phase 2 — Universal Downloader (yt-dlp, aria2c, download engine)
- Phase 3 — Anime, Manga, Movies & TV browsing
- Phase 4 — Provider system, stream resolvers, MovieBox integration

Currently debugging: provider stream resolution, HLS playback stability, and various API integration issues.

---

## 9. Known Gotchas & Past Decisions

- **`backend/core/main.py` is NOT the entry point.** `backend/main.py` is. The `core/` folder was a Phase 2 refactor that split out infrastructure, but `core/main.py` is a leftover duplicate — it should be ignored.
- **Two `main.py` files exist** — this is confusing but intentional (historical). When debugging backend startup, always look at `backend/main.py`.
- **Port conflict:** If backend fails to start with "port already in use", another GRABIX process is running. Kill it first.
- **`providers.py`** in `app/services/` is ONLY a re-export shim — all actual provider logic is split across `provider_types.py`, `provider_registry.py`, `provider_adapters.py`, `provider_resolvers.py`, `provider_helpers.py`.
- **TMDB can be called from both browser AND backend** — browser calls use `VITE_TMDB_TOKEN`; backend calls use `GRABIX_TMDB_BEARER_TOKEN`. If the frontend token is not set, it proxies through the backend automatically.
- **Circuit breaker pattern** is used for stream providers — if a provider fails too many times, it is temporarily disabled. See `core/circuit_breaker.py` and `provider_registry.py`.
- **Supabase is optional** — only used if configured. The app works fully offline without it.
- **aria2c processes** are tracked in `download_controls` and automatically terminated on exit via `atexit`.
- **Adult content** is protected by bcrypt-hashed password stored in settings — requires bcrypt to be installed.

---

## 10. How to Debug With AI Help

When you report an error, include:

1. **The exact error message** (full traceback if Python, full console error if JS)
2. **What you were doing** when it happened (which page, what action)
3. **Which files are most likely involved** (use the structure above to identify them)

### Quick file lookup by symptom:

| Symptom | Files to upload |
|---|---|
| Backend won't start | `backend/main.py`, `backend/app/services/runtime_config.py` |
| Download not starting | `backend/app/routes/downloads.py`, `backend/db_helpers.py` |
| Stream won't play / no sources | `backend/app/services/provider_adapters.py`, `provider_resolvers.py`, `grabix-ui/src/components/player/useSourceManager.ts` |
| HLS player broken | `grabix-ui/src/components/player/useHlsEngine.ts`, `usePlayerState.ts` |
| Manga not loading | `backend/app/routes/manga.py`, `backend/app/services/manga_mangadex.py` |
| TMDB data missing | `backend/app/services/tmdb.py`, `grabix-ui/src/lib/tmdb.ts` |
| Settings not saving | `backend/app/services/settings_service.py`, `grabix-ui/src/pages/SettingsPage.tsx` |
| Health check failing | `backend/core/health.py`, `grabix-ui/src/lib/api.ts` |
| Library not showing files | `backend/library_helpers.py`, `grabix-ui/src/pages/LibraryPage.tsx` |
| Auth/CORS errors | `backend/app/services/desktop_auth.py`, `backend/app/services/security.py` |
| Subtitles broken | `backend/app/routes/subtitles.py`, `backend/app/services/subtitles.py`, `grabix-ui/src/components/player/useSubtitleEngine.ts` |
| MovieBox not working | `backend/moviebox/moviebox_fetchers.py`, `backend/moviebox/routes.py` |

---

## 11. How to Update This File

After every significant debugging session or architectural change:

1. Update the **Current Development Status** section (Section 8)
2. Add any new gotchas to **Known Gotchas** (Section 9)
3. If new files were created, add them to the **File Structure** (Section 3)
4. If new env vars were added, update **Environment Variables** (Section 5)
5. If new API endpoints were added, update **Key Backend API Endpoints** (Section 6)


---
name: karpathy-guidelines
description: Behavioral guidelines to reduce common LLM coding mistakes. Use when writing, reviewing, or refactoring code to avoid overcomplication, make surgical changes, surface assumptions, and define verifiable success criteria.
license: MIT
---

# Karpathy Guidelines

Behavioral guidelines to reduce common LLM coding mistakes, derived from [Andrej Karpathy's observations](https://x.com/karpathy/status/2015883857489522876) on LLM coding pitfalls.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

Fix the code and give me the fixed files and tell me where to paste them 
also if you make any change in code create or remove or edit or any thing you do with code alway update this files for next claude account also update it if you only make changes in the code ok 