# GRABIX — AI Developer Handoff File

> **YOU ARE WORKING WITH A NON-PROGRAMMER.** Follow these rules on every response:
> 1. Read this file COMPLETELY before touching any code.
> 2. Make the **smallest possible fix** — do not over-engineer.
> 3. Before fixing anything, run: `cd backend && python -m pytest tests/test_canary.py -v`
> 4. Give the **complete corrected file(s)** with the **exact path** for each.
> 5. After fixing, tell the developer to run canary tests again and confirm they pass.
> 6. **Update the HANDOFF section** after every response. Never skip this.
> 7. If you notice a bug you were not asked about — mention it at the end. Do not ignore it.

---

## WHAT IS GRABIX

Desktop app for streaming, downloading, and managing anime, movies, TV, and manga.
Built with Tauri 2. Developer is non-technical — always give complete files, not "edit line X".

---

## STACK

| Layer | Tech | Port |
|---|---|---|
| Desktop shell | Tauri 2 (Rust) — `grabix-ui/src-tauri/` | — |
| Frontend | React 19 + TypeScript + Vite + Tailwind CSS v4 | 1420 (dev) |
| Backend | Python FastAPI via uvicorn | **8000** |
| Anime sidecar | Node.js — `consumet-local/server.cjs` | **3000** |
| Database | SQLite (WAL mode) — `~/Downloads/GRABIX/grabix.db` | — |
| Video download | yt-dlp (lazy-loaded on first use — saves startup time) | — |
| Video mux | FFmpeg (bundled or in PATH) | — |
| Accelerated DL | aria2c (optional, bundled) | — |
| Installer | NSIS only (`"zlib"` compression) | — |

**Start order:** `1__Backend.bat` → `3__Consumet_api.bat` → `2__Frontend.bat`
Or use `run.bat` for all at once.

---

## THE GOLDEN RULE — RUN THIS BEFORE AND AFTER EVERY SINGLE FIX

```
cd backend
python -m pytest tests/test_canary.py -v
```

These 10 tests cover: health ping, downloads list, settings read, ffmpeg status,
cache stats, providers status, diagnostics logs, check-link, and circuit breaker.

**If any test fails after your fix → undo the fix and try a smaller change.**
Do not ship code that fails canary tests. These are your smoke alarm.

---

## ACTUAL FILE SIZES — READ BEFORE EDITING

| File | Lines | Status |
|---|---|---|
| `grabix-ui/src/components/player/usePlayerState.ts` | **1,028** | RED — still needs splitting |
| `backend/app/services/megacloud.py` | **617** | YELLOW — large but acceptable |
| `backend/core/main.py` | **573** | GREEN — split done (was 1,784) |
| `backend/streaming_helpers.py` | **465** | YELLOW — fragile, see gotchas |
| `backend/db_helpers.py` | **490** | YELLOW — acceptable |
| `backend/app/routes/consumet_anime_stream.py` | **415** | YELLOW — acceptable |
| `grabix-ui/src/pages/AnimePageV2.tsx` | **742** | YELLOW — it is a page, ok |
| `grabix-ui/src/lib/streamProviders.ts` | **716** | YELLOW — large |
| `grabix-ui/src/lib/api.ts` | **322** | GREEN |
| `backend/core/download_helpers.py` | **241** | GREEN |
| `backend/app/routes/downloads.py` | **194** | GREEN |
| `backend/app/routes/consumet.py` | **229** | GREEN — split done (was 1,057) |
| `grabix-ui/src/components/VidSrcPlayer.tsx` | **268** | GREEN — split done (was 2,478) |

**Next file that must be split:** `usePlayerState.ts` (1,028 lines). See split plan below.

---

## FULL PROJECT STRUCTURE

```
grabix-master/
│
├── backend/
│   ├── main.py                           ← SHIM ONLY. Re-exports core/main.py. Never add logic here.
│   ├── db_helpers.py                     ← SQLite pool, settings, format utils (490 lines)
│   ├── library_helpers.py                ← Library index, reconcile, history, migrate_db
│   ├── streaming_helpers.py              ← HLS proxy + embed resolution (465 lines)
│   │                                        FRAGILE — see gotchas #1 and #2 below
│   │
│   ├── core/                             ← Real backend logic (Phase 6 split)
│   │   ├── main.py                       ← FastAPI app + lifespan + router registration (573 lines)
│   │   ├── health.py                     ← All /health/* and /diagnostics/* routes
│   │   ├── cache_ops.py                  ← /cache/* routes + SQLite cache read/write/evict
│   │   ├── download_helpers.py           ← URL normalization, category inference, auto-retry (241 lines)
│   │   ├── circuit_breaker.py            ← CircuitBreaker class — always use this, never inline
│   │   ├── network_monitor.py            ← Network monitor background worker
│   │   ├── state.py                      ← State helpers
│   │   ├── cache.py                      ← Cache helpers
│   │   └── utils.py                      ← Shared utils
│   │
│   ├── app/
│   │   ├── routes/
│   │   │   ├── aniwatch.py               ← /aniwatch/* routes
│   │   │   ├── consumet.py               ← /consumet/* thin router — includes sub-routers (229 lines)
│   │   │   ├── consumet_anime_stream.py  ← /consumet/anime/stream — server-side pipeline (415 lines)
│   │   │   ├── consumet_anime_debug.py   ← /consumet/anime/debug-stream — step-by-step trace
│   │   │   ├── consumet_helpers.py       ← _title_score(), _safe_error_body(), _build_sidecar_hint()
│   │   │   ├── downloads.py              ← /download + /downloads/* routes (194 lines)
│   │   │   │                                Has _safe() wrapper for CORS-safe error handling
│   │   │   │                                Has SSE endpoint: GET /downloads/stream (real-time progress)
│   │   │   ├── manga.py                  ← /manga/* routes
│   │   │   ├── metadata.py               ← /metadata/* TMDB lookups
│   │   │   ├── providers.py              ← /providers/* provider registry
│   │   │   ├── settings.py               ← /settings/* read/write
│   │   │   ├── streaming.py              ← /stream/* proxy, variants, extract-stream
│   │   │   └── subtitles.py              ← /subtitles/* fetch, convert
│   │   │
│   │   └── services/
│   │       ├── megacloud.py              ← KEY FILE: Python MegaCloud extractor (617 lines)
│   │       │                                Ported from JS. Has background key health worker.
│   │       │                                Key cached in _key_health dict (TTL 1200s / 20 min)
│   │       ├── consumet.py               ← HTTP client wrappers for Node sidecar
│   │       ├── aniwatch.py               ← Thin client to sidecar port 3000 + cache
│   │       ├── tmdb.py                   ← TMDB API client + in-memory cache + TTL
│   │       ├── imdb.py                   ← IMDB helpers via cinemagoer
│   │       ├── history.py                ← Watch history read/write
│   │       ├── runtime_config.py         ← ALL paths, ports, base URLs (single source of truth)
│   │       ├── runtime_state.py          ← RuntimeStateRegistry — in-memory: downloads, stream cache
│   │       ├── settings_service.py       ← Settings load/save/merge/payload helpers
│   │       ├── security.py               ← URL validation, path safety, approved host list
│   │       ├── network_policy.py         ← Outbound URL policy — allowlist BEFORE DNS lookup
│   │       ├── logging_utils.py          ← Structured JSON logger, log_event()
│   │       ├── errors.py                 ← json_error_response() — standard error shape
│   │       ├── desktop_auth.py           ← Desktop auth header validation
│   │       ├── archive_installer.py      ← Zip extract + checksum verify
│   │       ├── provider_adapters.py      ← Provider adapter layer
│   │       ├── provider_helpers.py       ← Provider helper utilities
│   │       ├── provider_registry.py      ← Provider registry
│   │       ├── provider_resolvers.py     ← Provider resolution logic
│   │       ├── provider_types.py         ← Provider type definitions
│   │       ├── providers.py              ← Provider registry snapshot
│   │       ├── route_registry.py         ← Route registration helpers
│   │       ├── stream_extractors.py      ← Stream extraction helper bridge
│   │       ├── manga_mangadex.py         ← MangaDex client
│   │       ├── manga_comick.py           ← Comick client
│   │       ├── manga_anilist.py          ← AniList client
│   │       ├── manga_jikan.py            ← Jikan client
│   │       ├── manga_cache.py            ← Manga-specific cache
│   │       └── subtitles.py              ← Subtitle fetch/format conversion
│   │
│   ├── anime/
│   │   ├── __init__.py
│   │   └── resolver.py                   ← /anime/* routes + anime_resolve_cache
│   │
│   ├── moviebox/
│   │   ├── __init__.py                   ← MOVIEBOX_AVAILABLE flag — False if import fails
│   │   ├── moviebox_fetchers.py
│   │   ├── moviebox_helpers.py
│   │   ├── moviebox_loader.py
│   │   └── routes.py                     ← /moviebox/* routes
│   │
│   ├── downloads/                        ← Standalone download engine module
│   │   └── engine.py                     ← yt-dlp + aria2, ensure_runtime_bootstrap,
│   │                                        recover_download_jobs, _start_download_thread
│   │
│   ├── tests/
│   │   ├── test_canary.py                ← THE SMOKE TESTS — run after every change
│   │   ├── test_features.py
│   │   ├── test_shape.py
│   │   └── [other test files]
│   │
│   └── requirements.txt                  ← fastapi, uvicorn, yt-dlp, moviebox-api==0.4.0.post1,
│                                            httpx, bcrypt, cinemagoer, curl_cffi
│
├── consumet-local/
│   ├── server.cjs                        ← Node.js HiAnime/AniWatch scraper
│   └── package.json                      ← aniwatch: "latest", @consumet/extensions: ^1.8.8
│
├── grabix-ui/
│   ├── src/
│   │   ├── App.tsx                       ← Page router, backend polling every 2500ms
│   │   ├── index.css                     ← ALL CSS variables — never hardcode colors
│   │   │
│   │   ├── pages/
│   │   │   ├── AnimePageV2.tsx           ← PRIMARY anime page (742 lines — active, use this)
│   │   │   ├── AnimePage.tsx             ← OLD anime page — reference only, do not touch
│   │   │   ├── DownloaderPage.tsx        ← URL → quality picker → download queue
│   │   │   ├── ConverterPage.tsx         ← FFmpeg converter UI
│   │   │   ├── LibraryPage.tsx           ← Downloaded files management
│   │   │   ├── MoviesPage.tsx            ← Movies browse via TMDB
│   │   │   ├── TVSeriesPage.tsx          ← TV series browse via TMDB
│   │   │   ├── MangaPage.tsx             ← Manga reader
│   │   │   ├── MovieBoxPage.tsx          ← MovieBox streaming UI
│   │   │   ├── ExplorePage.tsx           ← Cross-content explore/trending
│   │   │   ├── BrowsePage.tsx            ← Content browser
│   │   │   ├── FavoritesPage.tsx         ← Favorited items
│   │   │   ├── RatingsPage.tsx           ← Top-rated charts
│   │   │   ├── SettingsPage.tsx          ← Settings + diagnostics panel
│   │   │   └── HomePage.tsx              ← Home/dashboard
│   │   │
│   │   ├── components/
│   │   │   ├── VidSrcPlayer.tsx          ← SPLIT DONE — now 268 lines (JSX shell only)
│   │   │   │                                Imports everything from player/ subfolder
│   │   │   ├── player/
│   │   │   │   ├── usePlayerState.ts     ← RED: 1,028 lines — needs splitting (see plan below)
│   │   │   │   │                            All useState, useRef, useEffect, useCallback, handlers
│   │   │   │   ├── helpers.ts            ← Subtitle parsing, CSS injection, stream utilities
│   │   │   │   └── types.ts              ← Player TypeScript interfaces
│   │   │   ├── SubtitlePanel.tsx         ← Subtitle track selector (standalone component)
│   │   │   ├── DownloadOptionsModal.tsx  ← Quality/format picker modal
│   │   │   ├── Sidebar.tsx               ← Left nav + active download count badge
│   │   │   ├── Topbar.tsx                ← Top bar
│   │   │   ├── AppToast.tsx              ← Toast notifications
│   │   │   ├── CachedImage.tsx           ← Image with loading/fallback
│   │   │   ├── ErrorBoundary.tsx         ← React error boundary per section
│   │   │   ├── PageStates.tsx            ← PageEmptyState + PageErrorState shared UI
│   │   │   ├── TrimSlider.tsx            ← Video trim UI for converter
│   │   │   ├── WatchdogBanner.tsx        ← Orange banner when backend crashes
│   │   │   ├── OfflineBanner.tsx         ← Network offline banner
│   │   │   ├── Icons.tsx                 ← Main SVG icon set
│   │   │   └── Icons_addition.tsx        ← Additional icons
│   │   │
│   │   ├── context/
│   │   │   ├── ThemeContext.tsx          ← light/dark via data-theme attribute
│   │   │   ├── FavoritesContext.tsx      ← Favorites (localStorage-backed)
│   │   │   ├── ContentFilterContext.tsx  ← Adult content filter toggle
│   │   │   └── RuntimeHealthContext.tsx  ← Backend health state + refreshHealth()
│   │   │
│   │   └── lib/
│   │       ├── api.ts                    ← BACKEND_API, backendJson(), all TS interfaces (322 lines)
│   │       ├── streamProviders.ts        ← StreamSource type, resolveAnimePlaybackSources() (716 lines)
│   │       ├── downloads.ts              ← queueVideoDownload(), queueSubtitleDownload()
│   │       ├── consumetProviders.ts      ← fetchConsumetAnimeEpisodes(), searchConsumetAnime()
│   │       ├── aniwatchProviders.ts      ← fetchAniwatchDiscover(), searchAniwatch()
│   │       ├── mangaProviders.ts         ← manga search/chapter helpers
│   │       ├── tmdb.ts                   ← searchTmdbMedia(), fetchTmdbSeasonMap()
│   │       ├── appSettings.ts            ← Settings load/save helpers
│   │       ├── cache.ts                  ← Frontend in-memory JSON cache
│   │       ├── mediaCache.ts             ← Media metadata cache
│   │       ├── persistentState.ts        ← LocalStorage-backed persistent UI state
│   │       ├── contentFilter.ts          ← Adult content filter logic
│   │       ├── supabase.ts               ← Supabase client (optional auth/ratings)
│   │       ├── imdbCharts.ts             ← IMDB chart helpers (hardcoded IDs)
│   │       ├── topRatedMedia.ts          ← Top-rated fetch helpers
│   │       ├── performance.ts            ← markPerf() / measurePerf() timing
│   │       ├── mangaOffline.ts           ← Offline manga storage
│   │       ├── mangaZip.ts               ← Manga ZIP chapter bundler
│   │       ├── useOfflineDetection.ts    ← Network offline hook
│   │       ├── useRetryWithBackoff.ts    ← Retry with exponential backoff
│   │       └── useWatchdog.ts            ← Backend watchdog (detects crash)
│   │
│   └── src-tauri/
│       ├── tauri.conf.json               ← targets: ["nsis"], compression: "zlib"
│       ├── Cargo.toml
│       └── src/
│           ├── main.rs                   ← Tauri entry
│           └── lib.rs                    ← Backend + sidecar process management
│
├── build-fast.bat                        ← Full build (pip → stage → npm → cargo)
├── run.bat                               ← Starts all 3 processes
├── 1__Backend.bat                        ← Kills stale port 8000 process, starts backend
├── 2__Frontend.bat                       ← Start frontend
└── 3__Consumet_api.bat                   ← Start Node sidecar
```

---

## CRITICAL ARCHITECTURE NOTES

### Note 1: backend/main.py IS A SHIM
`backend/main.py` only re-exports from `backend/core/main.py`.
When someone says "fix main.py" — the real file to edit is `backend/core/main.py`.
Never add logic to `backend/main.py`.

### Note 2: The `import main as _m` Circular Import Pattern
`streaming_helpers.py` uses `import main as _m` inside function bodies (deferred imports).
This is intentional — it breaks the circular import between `streaming_helpers` and `main`.
Do NOT refactor these into module-level imports. The functions that do this are:
- `_resolve_embed_target()` — accesses `_m._validate_outbound_url`
- `extract_stream()` — accesses `_m.stream_extract_cache`, `_m.STREAM_EXTRACT_CACHE_TTL_SECONDS`

### Note 3: stream_proxy() and stream_variants() MUST BE SYNC DEF
These are called from sync route handlers in `app/routes/streaming.py`.
Making them `async def` causes FastAPI to return a coroutine object instead of a response —
this breaks ALL HLS proxy requests and kills the player. This happened once. Never again.

### Note 4: VidSrcPlayer.tsx is now a JSX-only shell
Real player logic lives in `grabix-ui/src/components/player/usePlayerState.ts` (1,028 lines).
`VidSrcPlayer.tsx` itself is 268 lines — it imports `usePlayerState` and renders JSX.
The JSX imports: `usePlayerState`, `formatTime`, `SubtitlePanel`, and Icons.

### Note 5: Downloads has an SSE endpoint
`GET /downloads/stream` is a Server-Sent Events endpoint that pushes download state every 250ms.
This replaces the old 1-second polling loop. The event generator in `downloads.py` yields
`data: <json>\n\n` whenever the downloads dict changes.

### Note 6: The _safe() Pattern in downloads.py
All engine calls in `downloads.py` are wrapped in `_safe("function_name", fallback, *args)`.
This prevents CORS errors: unhandled exceptions that escape before Starlette attaches CORS headers
cause Chrome to report a CORS error instead of the real 500. Keep `_safe()` around all engine calls.

---

## ANIME STREAMING PIPELINE (full chain, read before debugging playback)

```
User clicks episode in AnimePageV2.tsx
  → resolveAnimePlaybackSources() in streamProviders.ts
    → GET /consumet/anime/stream?title=&episode=&audio=
      → consumet_anime_stream.py runs the full server-side pipeline:

        Step 1: Search HiAnime (sidecar port 3000) for anime ID
                If search fails → return 404 with sidecar hint
        Step 2: GET /anime/hianime/info → get episode list → find episode ID
        Step 3: Loop over servers ["vidstreaming", "vidcloud", "t-cloud"]
                For each server:
                  Attempt A: AniWatch Node sidecar /anime/hianime/watch
                             OFTEN FAILS — npm package broken since April 2026
                  Attempt B: Python megacloud.extract_hianime_stream()
                             PRIMARY WORKING FALLBACK
                             Scrapes client key from HiAnime player JS
                             Calls MegaCloud getSources API
                             Decrypts HLS URL (columnar cipher + keygen2)
                  Attempt C: Try opposite audio (dub↔sub) if both fail
        Step 4: Return {sources, subtitles} or detailed error with _attempt_errors

HLS playback path:
  VidSrcPlayer.tsx → HLS.js
  Every segment request → GET /stream/proxy?url=<segment_url>&headers_json=...
  stream_proxy() (MUST be sync!) → httpx.Client → CDN
  Playlists get rewritten by _rewrite_hls_playlist() to route all URLs through backend proxy
  Segments streamed in 64KB chunks (streaming path), playlists buffered fully then rewritten
```

---

## DOWNLOAD PIPELINE

```
DownloaderPage.tsx
  → GET /check-link?url=...          ← core/main.py — yt-dlp info extract, returns formats
  → POST /download                   ← app/routes/downloads.py
      → downloads.engine.start_download()
          → _start_download_thread() → yt-dlp or aria2c subprocess
  → GET /downloads/stream (SSE)      ← pushes progress every 250ms (preferred)
  OR GET /downloads                  ← polling fallback (every 4s)
```

---

## BACKGROUND WORKERS (all started in core/main.py lifespan)

| Worker | Interval | Purpose |
|---|---|---|
| `run_key_health_worker` | 1200s (20 min) | Pre-scrape MegaCloud client key before expiry |
| `_network_monitor_worker` | 15s | Ping 8.8.8.8; auto-pause/resume downloads on network change |
| `_auto_retry_failed_worker` | 60s | Re-queue failed downloads (max 3 retries, 5min delay) |
| `_cache_access_flusher` | 60s | Flush LRU access timestamps to SQLite |

---

## DATABASE (SQLite — WAL mode, pooled connections)

Location: `~/Downloads/GRABIX/grabix.db`

| Table | Key Columns | Purpose |
|---|---|---|
| `history` | id, url, title, status, file_path, size, category, tags, created_at, broken | Download records |
| `content_cache` | key, value (JSON), content_type, expires_at, last_accessed | API response cache |
| `health_log` | service, status, latency_ms, error, recorded_at | Health events (pruned 24h) |

Cache TTLs: discover=6h, details=6h, manga_chapters=12h, search=30min, generic=15min
Eviction: LRU — removes 20 oldest entries when total exceeds 50MB

---

## ENVIRONMENT VARIABLES

| Variable | Default | Purpose |
|---|---|---|
| `GRABIX_BACKEND_PORT` | `8000` | Backend listen port |
| `GRABIX_TMDB_BEARER_TOKEN` | — | TMDB API auth (also: TMDB_BEARER_TOKEN, TMDB_TOKEN) |
| `GRABIX_APP_STATE_ROOT` | auto | Root dir for DB + settings |
| `GRABIX_PACKAGED_MODE` | — | Set to `1` in built .exe |
| `GRABIX_DESKTOP_AUTH_TOKEN` | — | Auth token for production mode |
| `GRABIX_PUBLIC_BASE_URL` | `http://127.0.0.1:8000` | Backend self-reference URL |
| `VITE_GRABIX_API_BASE` | `http://127.0.0.1:8000` | Frontend → backend URL |
| `CONSUMET_API_BASE` | `http://127.0.0.1:3000` | Node sidecar URL |

---

## DEPENDENCY MAP — what to test after each change

| File you changed | Files that might break | Run these tests |
|---|---|---|
| `core/main.py` | Everything | ALL 10 canary tests |
| `streaming_helpers.py` | `app/routes/streaming.py`, all HLS playback | Canary 5 + manual player test |
| `app/services/megacloud.py` | Anime stream pipeline | Manual: play an anime episode |
| `app/routes/consumet_anime_stream.py` | AnimePageV2, VidSrcPlayer | Canary 2 + manual stream test |
| `app/routes/downloads.py` | DownloaderPage.tsx | Canary 3 (downloads) |
| `downloads/engine.py` | downloads.py, core/main.py | Canary 3 (downloads) |
| `db_helpers.py` | core/main.py, all download routes | Canary 3 + 4 |
| `core/health.py` | SettingsPage diagnostics | Canary 2 + 7 |
| `core/cache_ops.py` | cache stats/clear routes | Canary 6 (cache stats) |
| `app/services/runtime_config.py` | Everything (it holds all paths) | ALL canary tests |
| `player/usePlayerState.ts` | VidSrcPlayer.tsx (only consumer) | Manual: open player, test controls |
| `lib/streamProviders.ts` | AnimePageV2.tsx, MovieBoxPage.tsx | Manual: try playing content |
| `app/routes/settings.py` | SettingsPage.tsx | Canary 4 (settings) |
| `core/circuit_breaker.py` | health, consumet, aniwatch, moviebox | Canary 10 (circuit breaker) |

---

## EXTERNAL INTEGRATIONS

| Service | Auth | Used For |
|---|---|---|
| TMDB | Bearer token (env var) | Movie/TV metadata, posters, season lists |
| Jikan (jikan.moe) | None | Anime metadata, top charts |
| AniList (GraphQL) | None | Anime/manga metadata fallback |
| MangaDex | None | Manga chapters + pages (primary) |
| Comick | None | Manga fallback |
| HiAnime (aniwatchtv.to) | None (scraped) | Anime episode stream source |
| MegaCloud | None (key scraped from player JS) | HLS decryption for HiAnime streams |
| IMDB | None (cinemagoer lib) | Ratings charts |
| MovieBox API | None (PyPI package) | Movie streaming — needs `curl_cffi` |
| Supabase | Optional | Auth/ratings — not required |

---

## CSS VARIABLES — NEVER HARDCODE COLORS

All defined in `grabix-ui/src/index.css`. Always use `var(--name)`.

```
Layout:       --sidebar-w (220px)   --topbar-h (56px)
Backgrounds:  --bg-app  --bg-sidebar  --bg-surface  --bg-surface2
              --bg-hover  --bg-active  --bg-input  --bg-overlay
Borders:      --border  --border-focus
Text:         --text-primary  --text-secondary  --text-muted
              --text-accent  --text-on-accent
              --text-danger  --text-success  --text-warning
Accent:       --accent  --accent-hover  --accent-light  --accent-subtle
Semantic:     --danger  --success  --warning
Shadows:      --shadow-sm  --shadow-md  --shadow-lg
Fonts:        --font: 'Outfit', 'Google Sans', sans-serif
              --font-mono: 'JetBrains Mono', monospace
```

---

## KNOWN GOTCHAS — DO NOT RE-DEBUG THESE

1. **`stream_proxy()` and `stream_variants()` MUST BE sync `def`.**
   Changing to `async def` breaks HLS proxying completely — FastAPI returns a coroutine object,
   not a response. This happened once and killed the player. Never change this.

2. **`import main as _m` inside function bodies is intentional.**
   `streaming_helpers.py::_resolve_embed_target()` and `extract_stream()` use deferred imports
   to break a circular import chain. Do NOT move these to module-level imports.

3. **`curl_cffi` must be in PyInstaller hiddenimports** — MovieBox silently fails in built .exe.
   Also now listed directly in `requirements.txt`.

4. **`recover_download_jobs()` MUST be called on startup.**
   Called in both `run_server()` and `ensure_runtime_bootstrap()` in `core/main.py`.
   Removing either call causes all in-progress downloads to be lost on restart.

5. **NSIS only, `"zlib"` compression.**
   `"all"` build target or `"lzma"` causes file-lock errors on Windows during build.

6. **`aniwatch` npm package broken since April 2026.**
   MegaCloud API changed. Python `megacloud.py` is the primary fallback now.
   Node sidecar still needed for Gogoanime/AnimePahe fallbacks.

7. **HLS cache TTL must stay at or below 900 seconds.**
   HiAnime signed URLs expire ~30min. `STREAM_EXTRACT_CACHE_TTL_SECONDS = 900` in `core/main.py`.
   Never raise this above 900 or playback will fail with expired URL errors.

8. **`network_policy.py` allowlist check must run BEFORE DNS lookup.**
   Reversed order once → caused "Failed to fetch" on valid internal URLs.

9. **MovieBox download uses `externalUrl` directly.**
   Do not route through the embed resolution chain — this was done correctly, do not undo it.

10. **`get_db_connection()` must not have per-call health checks.**
    Lazy epoch-based check only. Per-call `SELECT 1` ran in tight loops and caused slowdowns.

11. **`AnimePageV2.tsx` is the active primary page.**
    `AnimePage.tsx` is kept for reference only. Fix bugs in V2 only. Never touch AnimePage.tsx.

12. **`backend/main.py` is a shim.**
    The real file is `backend/core/main.py`. This is the most common AI mistake.

13. **Port 8000 auto-kill on restart.**
    `1__Backend.bat` auto-kills any process holding port 8000 before starting.
    `core/main.py::run_server()` does a pre-flight socket probe — if port busy, exits cleanly
    before lifespan runs (this prevents the "Task destroyed" warning).

14. **Windows event loop: SelectorEventLoop only.**
    ProactorEventLoop (Windows default since Python 3.8) fails on non-main thread.
    `run_server()` explicitly creates `SelectorEventLoop` on Windows (`os.name == "nt"`).

15. **Signal handlers disabled in uvicorn.**
    `server.install_signal_handlers = lambda: None`
    Python only allows signal handlers on the main thread.

16. **MegaCloud client key TTL is 1200s (20 min).**
    Stored in `_key_health` dict in `megacloud.py`. Background worker refreshes it before expiry.
    On startup, key is populated on first play naturally. Worker keeps it fresh afterward.

17. **`_safe()` wrapper in `downloads.py` is load-bearing.**
    All `downloads.engine` calls go through `_safe("function_name", fallback, *args)`.
    This prevents Chrome from reporting CORS errors instead of the real 500 on crashes.
    Keep `_safe()` around every engine call. Do not call engine functions directly.

18. **Consumet sidecar silently drops error bodies.**
    Fixed in `consumet_helpers.py` with `_safe_error_body()` helper.
    Always use this function when logging a failed sidecar response.

---

## PHASE 2 FILE SPLIT STATUS

### DONE
| Original file | Was | Now | Split into |
|---|---|---|---|
| `backend/main.py` | 1,784 lines | 573 lines (`core/main.py`) | `core/health.py`, `core/cache_ops.py`, `core/network_monitor.py`, `core/download_helpers.py` |
| `VidSrcPlayer.tsx` | 2,478 lines | 268 lines | `player/usePlayerState.ts`, `player/helpers.ts`, `player/types.ts` |
| `app/routes/consumet.py` | 1,057 lines | 229 lines | `consumet_anime_stream.py`, `consumet_anime_debug.py`, `consumet_helpers.py` |

### STILL NEEDS SPLITTING
`player/usePlayerState.ts` — 1,028 lines. This is the only remaining large file.

Suggested split:
```
player/
├── useHlsEngine.ts       (~200 lines) — HLS.js setup, level management, quality switching
├── useSubtitleEngine.ts  (~200 lines) — subtitle load, parse, render, cue tracking, appearance
├── usePlayerControls.ts  (~150 lines) — play/pause/seek/volume/fullscreen/keyboard shortcuts
├── useSourceManager.ts   (~200 lines) — source switching, episode switching, sourceOption switching
└── usePlayerState.ts     (~280 lines) — thin orchestrator that composes the 4 hooks above
```

Prompt to give Claude:
```
Split grabix-ui/src/components/player/usePlayerState.ts (1,028 lines).
Create these new files in the same player/ folder:
- useHlsEngine.ts — all HLS.js logic: Hls instance, level management, adaptive quality
- useSubtitleEngine.ts — all subtitle loading, VTT parsing, cue tracking, appearance settings
- usePlayerControls.ts — play/pause/seek/volume/fullscreen/keyboard shortcuts
- useSourceManager.ts — source switching, episode switching, sourceOption switching
Keep usePlayerState.ts as a thin orchestrator that imports and composes the above.
Give me each complete file with full content.
After saving, run npm run dev and manually test the player.
```

---

## HOW TO GIVE CLAUDE A BUG TO FIX (use this workflow every time)

### WRONG (what broke things before):
```
"Hey Claude, downloads are broken, fix it"
```
This forces Claude to guess across thousands of lines.

### RIGHT:
```
"Downloads are broken. Error appears when I click Download.
Relevant file: app/routes/downloads.py (194 lines) — here it is: [paste file].
Fix only this file. I will run canary tests after."
```

### 3-step formula:
1. **Identify** — which file is the problem in? Use the dependency map above.
2. **Paste** — give Claude that specific file (under 400 lines is ideal).
3. **Verify** — run `python -m pytest tests/test_canary.py -v` after saving.

---

## DEBUG ENDPOINTS

| Endpoint | Purpose |
|---|---|
| `GET /health/ping` | Ultra-fast liveness check (no DB, no filesystem) |
| `GET /health/capabilities` | Full health + capability flags (polled every 2500ms by App.tsx) |
| `GET /health/services` | Per-service status breakdown |
| `GET /health/log?service=NAME` | Recent health events for a service |
| `GET /health/circuit-breaker/status` | Circuit breaker state for all services |
| `POST /health/circuit-breaker/reset?service=NAME` | Force reset a circuit breaker |
| `GET /diagnostics/self-test` | Full self-test: DB, library, storage, queue, logs |
| `GET /diagnostics/logs?limit=N` | Last N backend log events |
| `POST /cache/clear` | Wipe content cache (add `?content_type=TYPE` to target one type) |
| `GET /cache/stats` | Cache size, entry count, per-type breakdown |
| `GET /consumet/anime/debug-stream?title=&episode=` | Full anime pipeline trace with every step |
| `GET /consumet/anime/debug-watch/{ep_id}` | Raw sidecar watch result |
| `GET /providers/status` | All provider registry statuses |
| `GET /downloads/stream` | SSE endpoint — real-time download progress (250ms updates) |

---

## INSTALLER / BUILD

- **Format:** NSIS only (`["nsis"]`) — never `"all"` (causes file-lock errors)
- **Compression:** `"zlib"` — never `"lzma"`
- **Build script:** `build-fast.bat` at project root:
  Step 1: Check prerequisites (python, npm, cargo)
  Step 2: pip install requirements against bundled python-runtime
  Step 3: Stage backend + consumet files
  Step 4: npm run build
  Step 5: cargo tauri build
- **Bundled resources:** `python-runtime/**/*`, `backend-staging/backend/**/*`,
  `consumet-staging/**/*`, `generated/**/*`, `tools/**/*`
- **PyInstaller:** `curl_cffi` must be in `hiddenimports` in `grabix-backend.spec`
- **Windows:** `SelectorEventLoop`, uvicorn signal handlers disabled

---

## HANDOFF — CURRENT WORK

### COMPLETED FIXES

| Issue | Fix location |
|---|---|
| Port 10048 crash + Task destroyed warning | `core/main.py::run_server()` — pre-flight socket probe |
| Compiled app shows backend offline | `build-fast.bat` — pip refresh step added before staging |
| `1__Backend.bat` fails on stale port | `1__Backend.bat` — netstat+taskkill block added |
| `stream_proxy()` async crash | `streaming_helpers.py` — reverted to sync `def` |
| MegaCloud API broken (April 2026) | `app/services/megacloud.py` — Python reimplementation |
| DB `SELECT 1` on every connection | `db_helpers.py` — lazy epoch-based check |
| Consumet error bodies silently lost | `consumet_helpers.py::_safe_error_body()` |
| `main.py` was 1,784 lines | Phase 6 split — now `core/main.py` at 573 lines |
| `VidSrcPlayer.tsx` was 2,478 lines | Split — now 268 lines + `usePlayerState.ts` |
| `consumet.py` was 1,057 lines | Split into stream + debug + helpers files |

### STILL OPEN

**Issue 1: HLS Segment Fetching Fails (anime video won't play)**

Symptom: Anime player shows episode duration (HLS source resolved) but video never plays.
Browser console shows "AniWatch Failed" on segment requests.

Root cause candidates in order of likelihood:
1. Missing or wrong User-Agent in segment proxy
   Check: `streaming_helpers.py::stream_proxy()` → `_normalize_request_headers()`
   Confirm the User-Agent actually reaches the CDN request headers.
2. MegaCloud client key expired
   Check: `GET /health/log?service=megacloud`
   Fix: Restart backend (forces re-scrape). Background worker refreshes every 20min.
3. Sidecar returning empty sources silently
   Check: `GET /consumet/anime/debug-stream?title=<anime>&episode=1`
   Look at step3_watch in the response to see what each server attempt returned.

Files to check:
- `backend/streaming_helpers.py` (segment proxy headers section)
- `backend/app/routes/consumet_anime_stream.py` (stream pipeline)
- `backend/app/services/megacloud.py` (Python fallback)
- `consumet-local/server.cjs` (try: cd consumet-local && npm update aniwatch && node server.cjs)

**Issue 2: usePlayerState.ts is still 1,028 lines**
Needs to be split into 4 focused hooks. See split plan in Phase 2 section above.

---

## Working Instructions

When I send you a full source project in a ZIP file, read the CLAUDE.md completely first.

Then:
1. Understand the exact problem.
2. Identify the relevant files using the dependency map.
3. Read those actual files carefully before writing any code.
4. Fix the problem with the smallest possible change.
5. Do not touch files you were not asked about.
6. Return only the changed files with: full content, exact file path, and a simple plain-English explanation of what was wrong and what you changed.
7. If you noticed any other bug while reading the code, mention it briefly at the end under "Also noticed."
8. Update this CLAUDE.md if anything significant changed: new fix completed, new gotcha discovered, split status changed, new open issue found. Skip the update if nothing project-knowledge changed.
