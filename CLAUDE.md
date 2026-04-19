# GRABIX — AI Developer Handoff File

> **YOU ARE WORKING WITH A NON-PROGRAMMER.** Follow these rules on every response:
> 1. Read this file first. Then read the relevant source files. Then fix.
> 2. Make the **smallest possible fix** — do not over-engineer.
> 3. Give the **complete corrected file(s)** with the **exact path** for each.
> 4. Tell the developer exactly where to place each file (e.g. "Replace `backend/streaming_helpers.py` with this").
> 5. **Update the `## HANDOFF — CURRENT WORK` section** at the bottom of this file after every single response — what you found, what you changed, what the next step is. Never skip this.

---

## WHAT IS GRABIX

Desktop app for streaming, downloading, and managing anime, movies, TV, and manga.
Built with Tauri 2. Developer is non-technical — give files, not instructions to edit code manually.

---

## STACK

| Layer | Tech |
|---|---|
| Desktop shell | Tauri 2 (Rust) — `grabix-ui/src-tauri/` |
| Frontend | React 19 + TypeScript + Vite + Tailwind CSS v4 |
| Backend | Python FastAPI — runs embedded via PyO3/uvicorn on port **8000** |
| Anime sidecar | Node.js — `consumet-local/server.cjs` on port **3000** |
| Database | SQLite (WAL mode, pooled connections) — `~/Downloads/GRABIX/grabix.db` |
| Video download | yt-dlp (lazy-loaded on first use — saves ~1s startup) |
| Video mux | FFmpeg (bundled in `src-tauri/tools/` or user PATH) |
| Accelerated DL | aria2c (optional, bundled) |
| Installer | NSIS only (`"zlib"` compression — `"lzma"` causes file-lock issues) |

**Start order:** `1__Backend.bat` → `3__Consumet_api.bat` → `2__Frontend.bat`
(or `run.bat` for all at once, or use the built `.exe`)

---

## FULL PROJECT STRUCTURE

```
grabix-master/
│
├── backend/                              ← Python FastAPI backend
│   ├── main.py                           ← App entry + middleware + health + cache + circuit breaker
│   ├── db_helpers.py                     ← SQLite pool, settings, format utils, all db_* helpers
│   ├── library_helpers.py                ← Library index, reconcile, history, migrate_db
│   ├── streaming_helpers.py              ← HLS proxy, embed resolution — MUST STAY SYNC (see gotchas)
│   │
│   ├── app/
│   │   ├── routes/
│   │   │   ├── aniwatch.py               ← /aniwatch/* — AniWatch discover/search/episodes
│   │   │   ├── consumet.py               ← /consumet/* — MAIN ANIME PIPELINE + MegaCloud fallback
│   │   │   ├── downloads.py              ← /downloads/* — download queue CRUD
│   │   │   ├── manga.py                  ← /manga/* — chapters/pages
│   │   │   ├── metadata.py               ← /metadata/* — TMDB lookups
│   │   │   ├── providers.py              ← /providers/* — provider registry
│   │   │   ├── settings.py               ← /settings/* — app settings read/write
│   │   │   ├── streaming.py              ← /stream/* — proxy, variants, extract-stream, ffmpeg-status
│   │   │   └── subtitles.py              ← /subtitles/* — fetch, convert
│   │   │
│   │   └── services/
│   │       ├── megacloud.py              ← ⭐ KEY FILE: pure-Python MegaCloud extractor + key worker
│   │       ├── consumet.py               ← HTTP client wrappers for Node sidecar health/fetch
│   │       ├── aniwatch.py               ← Thin client to local Node sidecar (port 3000) + cache
│   │       ├── tmdb.py                   ← TMDB API client + in-memory cache + TTL
│   │       ├── imdb.py                   ← IMDB helpers (cinemagoer)
│   │       ├── history.py                ← Watch history read/write to SQLite
│   │       ├── runtime_config.py         ← ALL paths, ports, base URLs (single source of truth)
│   │       ├── runtime_state.py          ← RuntimeStateRegistry — in-memory: downloads, stream cache
│   │       ├── settings_service.py       ← Settings load/save/merge/payload helpers
│   │       ├── security.py               ← URL validation, path safety, approved host list
│   │       ├── network_policy.py         ← Outbound URL policy — allowlist before DNS lookup
│   │       ├── logging_utils.py          ← Structured JSON logger, log_event(), read_recent_log_events()
│   │       ├── errors.py                 ← json_error_response() — standard error shape
│   │       ├── desktop_auth.py           ← Desktop auth header validation (packaged mode)
│   │       ├── archive_installer.py      ← Zip extract + checksum verify for tool downloads
│   │       ├── providers.py              ← Provider registry snapshot
│   │       ├── stream_extractors.py      ← Stream extraction helper bridge
│   │       ├── manga_mangadex.py         ← MangaDex client
│   │       ├── manga_comick.py           ← Comick client
│   │       ├── manga_anilist.py          ← AniList client
│   │       ├── manga_jikan.py            ← Jikan client
│   │       ├── manga_cache.py            ← Manga-specific cache
│   │       └── subtitles.py              ← Subtitle fetch/format conversion
│   │
│   ├── core/
│   │   ├── circuit_breaker.py            ← Unified CircuitBreaker class (use THIS, not the one in main.py)
│   │   ├── cache.py                      ← Cache helpers
│   │   ├── state.py                      ← State helpers
│   │   └── utils.py                      ← Shared utils
│   │
│   ├── anime/
│   │   ├── __init__.py                   ← anime router export
│   │   └── resolver.py                   ← /anime/* routes + AnimeResolveRequest + anime_resolve_cache
│   │
│   ├── moviebox/
│   │   ├── __init__.py                   ← moviebox router + MOVIEBOX_AVAILABLE flag
│   │   └── routes.py                     ← /moviebox/* routes
│   │
│   ├── downloads/
│   │   └── engine.py                     ← Download engine: yt-dlp + aria2, ensure_runtime_bootstrap,
│   │                                        recover_download_jobs, _start_download_thread, list_downloads
│   │
│   ├── requirements.txt                  ← fastapi, uvicorn, yt-dlp, moviebox-api==0.4.0.post1,
│   │                                        httpx, bcrypt, cinemagoer
│   └── grabix-backend.spec               ← PyInstaller spec (must include curl_cffi in hiddenimports)
│
├── consumet-local/
│   ├── server.cjs                        ← Node.js entry. Providers: HiAnime, AnimeKai, KickAssAnime, AnimePahe
│   └── package.json                      ← aniwatch: "latest", @consumet/extensions: ^1.8.8
│
├── grabix-ui/                            ← Frontend root
│   ├── src/
│   │   ├── App.tsx                       ← Page router, backend polling every 2500ms, health state
│   │   ├── main.tsx                      ← React entry point
│   │   ├── index.css                     ← ALL CSS variables defined here — never hardcode colors
│   │   │
│   │   ├── pages/
│   │   │   ├── AnimePageV2.tsx           ← ⭐ PRIMARY anime page (active — use this one)
│   │   │   ├── AnimePage.tsx             ← OLD anime page (kept for reference only — not primary)
│   │   │   ├── DownloaderPage.tsx        ← Paste URL → check link → pick quality → download queue
│   │   │   ├── ConverterPage.tsx         ← FFmpeg converter UI (trim, format conversion)
│   │   │   ├── LibraryPage.tsx           ← Downloaded files. Marks items "broken" if file deleted.
│   │   │   ├── MoviesPage.tsx            ← Movies browse via TMDB
│   │   │   ├── TVSeriesPage.tsx          ← TV series browse via TMDB
│   │   │   ├── MangaPage.tsx             ← Manga reader (MangaDex, Comick, offline)
│   │   │   ├── MovieBoxPage.tsx          ← MovieBox streaming provider UI
│   │   │   ├── ExplorePage.tsx           ← Cross-content explore/trending
│   │   │   ├── BrowsePage.tsx            ← Content browser
│   │   │   ├── FavoritesPage.tsx         ← Favorited items
│   │   │   ├── RatingsPage.tsx           ← Top-rated charts (Jikan /top/anime + IMDB IDs)
│   │   │   ├── SettingsPage.tsx          ← App settings + diagnostics + health checks panel
│   │   │   ├── HomePage.tsx              ← Home/dashboard
│   │   │   └── VidSrcPlayer.tsx          ← VidSrc iframe player page
│   │   │
│   │   ├── components/
│   │   │   ├── VidSrcPlayer.tsx          ← Embedded video player (HLS.js + subtitle support)
│   │   │   ├── DownloadOptionsModal.tsx  ← Quality/format picker modal
│   │   │   ├── Sidebar.tsx               ← Left nav, page switcher, active download count badge
│   │   │   ├── Topbar.tsx                ← Top bar
│   │   │   ├── AppToast.tsx              ← Toast notifications
│   │   │   ├── CachedImage.tsx           ← Image with loading/fallback
│   │   │   ├── ErrorBoundary.tsx         ← React error boundary per section
│   │   │   ├── PageStates.tsx            ← PageEmptyState + PageErrorState shared UI
│   │   │   ├── SubtitlePanel.tsx         ← Subtitle track selector
│   │   │   ├── TrimSlider.tsx            ← Video trim UI for converter
│   │   │   ├── WatchdogBanner.tsx        ← Orange banner when backend crashes
│   │   │   ├── OfflineBanner.tsx         ← Banner when network is offline
│   │   │   ├── Icons.tsx                 ← Main SVG icon set
│   │   │   └── Icons_addition.tsx        ← Additional icons
│   │   │
│   │   ├── context/
│   │   │   ├── ThemeContext.tsx          ← Theme provider (light/dark via data-theme attribute)
│   │   │   ├── FavoritesContext.tsx      ← Favorites list (localStorage-backed)
│   │   │   ├── ContentFilterContext.tsx  ← Adult content filter toggle
│   │   │   └── RuntimeHealthContext.tsx  ← Backend health state + refreshHealth()
│   │   │
│   │   └── lib/
│   │       ├── api.ts                    ← BACKEND_API = http://127.0.0.1:8000, backendJson(),
│   │       │                                fetchBackendPing(), waitForBackendCoreReady(), all TS interfaces
│   │       ├── streamProviders.ts        ← StreamSource type, MovieBox fetch, resolveAnimePlaybackSources()
│   │       ├── downloads.ts              ← queueVideoDownload(), queueSubtitleDownload(), resolveSourceDownloadOptions()
│   │       ├── consumetProviders.ts      ← fetchConsumetAnimeEpisodes(), searchConsumetAnime(), fetchConsumetHealth()
│   │       ├── aniwatchProviders.ts      ← fetchAniwatchDiscover(), searchAniwatch(), warmAniwatchSections()
│   │       ├── mangaProviders.ts         ← fetchTrendingManga(), manga search/chapter helpers
│   │       ├── tmdb.ts                   ← searchTmdbMedia(), fetchTmdbSeasonMap()
│   │       ├── appSettings.ts            ← Settings load/save helpers
│   │       ├── cache.ts                  ← Frontend in-memory JSON cache (getCachedJson)
│   │       ├── mediaCache.ts             ← Media metadata cache
│   │       ├── persistentState.ts        ← LocalStorage-backed persistent UI state
│   │       ├── contentFilter.ts          ← Adult content filter logic
│   │       ├── supabase.ts               ← Supabase client (optional auth/ratings)
│   │       ├── imdbCharts.ts             ← IMDB chart helpers (hardcoded IMDB IDs)
│   │       ├── topRatedMedia.ts          ← Top-rated fetch helpers
│   │       ├── performance.ts            ← markPerf() / measurePerf() timing
│   │       ├── mangaOffline.ts           ← Offline manga storage
│   │       ├── mangaZip.ts               ← Manga ZIP chapter bundler
│   │       ├── useOfflineDetection.ts    ← Network offline detection hook
│   │       ├── useRetryWithBackoff.ts    ← Retry with exponential backoff hook
│   │       └── useWatchdog.ts            ← Backend watchdog hook (detects backend crash)
│   │
│   └── src-tauri/
│       ├── tauri.conf.json               ← bundle target: ["nsis"] only, compression: zlib
│       ├── Cargo.toml
│       └── src/
│           ├── main.rs                   ← Tauri entry point
│           └── lib.rs                    ← PyO3 embed: calls run_server() in main.py on background thread
│
└── consumet-local/
    ├── server.cjs                        ← Node.js AniWatch/HiAnime scraper
    └── package.json
```

---

## DATA FLOWS

### Download a video
1. User pastes URL → `DownloaderPage.tsx` → `GET /check-link?url=...`
2. `main.py`: validates URL → yt-dlp extracts info → returns title + quality formats
3. User picks quality → `queueVideoDownload()` in `downloads.ts`
4. `POST /downloads/queue` → `downloads/engine.py` → `_start_download_thread()`
5. yt-dlp or aria2 downloads to `~/Downloads/GRABIX/`
6. Frontend polls `GET /downloads` every 4s for progress update

### Play anime (full chain)
1. User picks episode in `AnimePageV2.tsx` → `resolveAnimePlaybackSources()`
2. Backend `consumet.py` route `/consumet/watch/anime` is called
3. **Attempt 1:** AniWatch Node sidecar (port 3000) → often fails (npm package broken)
4. **Attempt 2:** Python MegaCloud extractor → `megacloud.extract_hianime_stream()`
   - Scrapes client key from HiAnime player JS
   - Calls MegaCloud getSources API
   - Decrypts encrypted HLS URL using columnar cipher + keygen2
5. **Attempt 3:** Gogoanime via Consumet sidecar
6. **Attempt 4:** Other Consumet providers (AnimeKai, KickAssAnime, AnimePahe)
7. Resolved HLS URL → `VidSrcPlayer.tsx` → HLS.js plays stream
8. HLS segments fetched via backend proxy: `GET /stream/proxy?url=<segment_url>`

### Backend health polling
1. `App.tsx` polls `GET /health/capabilities` every 2500ms
2. Response updates `runtimeState` → Sidebar shows status indicators
3. If backend unreachable → `WatchdogBanner` shown in orange
4. Circuit breaker: 3 consecutive failures → skip pinging for 10 min

---

## DATABASE (SQLite)

**Location:** `~/Downloads/GRABIX/grabix.db` (WAL mode, pooled `_PooledConnection`)

| Table | Key Columns | Purpose |
|---|---|---|
| `history` | `id, url, title, status, file_path, size, category, tags, created_at, broken` | All download records |
| `content_cache` | `key, value (JSON), content_type, expires_at, last_accessed` | API response cache (LRU, max 50MB) |
| `health_log` | `service, status, latency_ms, error, recorded_at` | Service health events (pruned after 24h) |

**Cache TTLs:** discover=6h · details=6h · manga_chapters=12h · search=30min · generic=15min
**Eviction:** LRU, removes 20 oldest entries when total exceeds 50MB

---

## ENVIRONMENT VARIABLES

| Variable | Default | Purpose |
|---|---|---|
| `GRABIX_BACKEND_PORT` | `8000` | Backend listen port |
| `GRABIX_TMDB_BEARER_TOKEN` | — | TMDB API auth (also: `TMDB_BEARER_TOKEN`, `TMDB_TOKEN`) |
| `GRABIX_APP_STATE_ROOT` | auto | Root dir for DB + settings files |
| `GRABIX_PACKAGED_MODE` | — | Set to `1` in built `.exe` |
| `GRABIX_DESKTOP_AUTH_TOKEN` | — | Auth token for packaged/production mode |
| `GRABIX_PUBLIC_BASE_URL` | `http://127.0.0.1:8000` | Backend self-reference URL |
| `VITE_GRABIX_API_BASE` | `http://127.0.0.1:8000` | Frontend → backend base URL |
| `CONSUMET_API_BASE` | `http://127.0.0.1:3000` | Consumet Node sidecar URL |

---

## BACKGROUND WORKERS

All started automatically in `main.py` lifespan on startup.

| Worker | Interval | Purpose |
|---|---|---|
| `_network_monitor_worker` | 15s | Ping 8.8.8.8; auto-pause downloads on WiFi drop, auto-resume on restore |
| `_auto_retry_failed_worker` | 60s | Re-queue failed downloads (max 3 retries, 5min delay between each) |
| `_cache_access_flusher` | 60s | Flush LRU access timestamps to SQLite |
| `run_key_health_worker` | 1200s (20min) | Pre-scrape and verify MegaCloud client key before it expires |

---

## EXTERNAL INTEGRATIONS

| Service | Auth | Used For |
|---|---|---|
| TMDB | Bearer token (env var) | Movie/TV metadata, posters, season lists |
| Jikan (jikan.moe) | None | Anime metadata, top charts, `/top/anime` |
| AniList (GraphQL) | None | Anime/manga metadata fallback |
| MangaDex | None | Manga chapters + pages (primary) |
| Comick | None | Manga fallback provider |
| HiAnime (aniwatchtv.to) | None (scraped) | Anime episode stream source |
| MegaCloud | None (key scraped from player JS) | HLS decryption for HiAnime streams |
| IMDB | None (cinemagoer lib) | Ratings charts (hardcoded IDs in `imdbCharts.ts`) |
| MovieBox API | None (PyPI package) | Movie streaming (requires `curl_cffi`) |
| Supabase | Optional | Auth/ratings — not required for core features |

---

## CIRCUIT BREAKER

Defined in `core/circuit_breaker.py` (use this) and also inline in `main.py`.

- **Threshold:** 3 consecutive failures → circuit opens
- **Cooldown:** 10 min → skips pinging, serves last known status
- **Applies to:** consumet, aniwatch, moviebox (NOT: database, ffmpeg, downloads — those are local)
- **Reset:** `POST /health/circuit-breaker/reset?service=consumet`
- **View state:** `GET /health/circuit-breaker/status`

---

## MOVIEBOX

- Package: `moviebox-api==0.4.0.post1` (pip)
- Uses `curl_cffi` internally — **must be in `hiddenimports` in `grabix-backend.spec`**
- `MOVIEBOX_AVAILABLE` flag in `moviebox/__init__.py` — False if import fails
- Auto-retry every 5min if import failed at startup
- Fallback chain: embed → vidsrc
- Download: uses `externalUrl` directly — do not resolve through embed chain

---

## INSTALLER / BUILD

- **Format:** NSIS only (`["nsis"]`) — `"all"` causes file-lock errors
- **Compression:** `"zlib"` — do not use `"lzma"`
- **Installer hooks:** `grabix-ui/src-tauri/installer-hooks.nsh`
- **Bundled resources** (`tauri.conf.json`): `python-runtime/**/*`, `backend-staging/backend/**/*`, `consumet-staging/**/*`, `generated/**/*`, `tools/**/*`
- **PyInstaller entry:** `backend/main.py`
- **PyO3 entry:** `run_server()` in `main.py` — called from Rust `lib.rs` on a background thread
- **Windows event loop:** Must use `SelectorEventLoop` when embedded via PyO3. `ProactorEventLoop` (Windows 3.8+ default) fails on non-main thread.
- **Signal handlers:** Disabled in uvicorn (`server.install_signal_handlers = lambda: None`) — Python only allows signal handlers on the main thread

---

## CSS VARIABLES (NEVER HARDCODE COLORS — ALWAYS USE THESE)

Defined in `grabix-ui/src/index.css`. Apply via `var(--name)`.

```
Layout:        --sidebar-w (220px)  --topbar-h (56px)

Backgrounds:   --bg-app  --bg-sidebar  --bg-surface  --bg-surface2
               --bg-hover  --bg-active  --bg-input  --bg-overlay

Borders:       --border  --border-focus

Text:          --text-primary  --text-secondary  --text-muted
               --text-accent  --text-on-accent
               --text-danger  --text-success  --text-warning

Accent:        --accent  --accent-hover  --accent-light  --accent-subtle

Semantic:      --danger  --success  --warning

Shadows:       --shadow-sm  --shadow-md  --shadow-lg

Fonts:         --font: 'Outfit', 'Google Sans', sans-serif
               --font-mono: 'JetBrains Mono', 'Google Sans Mono', monospace
```

---

## KNOWN GOTCHAS — DO NOT RE-DEBUG THESE

1. **`curl_cffi` missing from PyInstaller spec** → MovieBox silently fails in production builds. Fix: add to `hiddenimports` in `grabix-backend.spec`.

2. **`stream_proxy()` and `stream_variants()` must be sync `def`** — changed to `async def` once, broke all HLS proxying (FastAPI got a coroutine object instead of a response). Never make these async.

3. **`recover_download_jobs()` not called on startup** → downloads lost on restart. Must be called in both `run_server()` and `ensure_runtime_bootstrap()`.

4. **PowerShell `-c` quote escaping in `setup-python-runtime.ps1`** → `SyntaxError` on Windows. Use proper escaping and test carefully before shipping.

5. **NSIS build target `"all"` causes file-lock errors** → only use `["nsis"]`. Add `Remove-Item` cleanup before rebuild.

6. **`aniwatch` npm package (v2.27.9) broken since MegaCloud API changed April 2026** → fixed by `megacloud.py` Python fallback. Node sidecar still needed for Gogoanime/AnimePahe fallbacks.

7. **Consumet sidecar silently discards error bodies** → fixed in `consumet.py` route with `_safe_error_body()` helper and `_attempt_errors` capture list.

8. **HLS cache TTL vs HiAnime signed URL expiry** → HiAnime signed URLs expire ~30min. Never cache HLS sources longer than 20min. `STREAM_EXTRACT_CACHE_TTL_SECONDS = 900` (15min) in `main.py` — do not raise this above 900.

9. **`network_policy.py` allowlist check order** → allowlist check must happen BEFORE DNS lookup. Reversing this caused "Failed to fetch" on valid internal URLs.

10. **MovieBox download uses `externalUrl` directly** — do not route it through the embed resolution chain.

11. **Duplicate keys in `_create_download_record`** → already removed. If you add new keys, check for duplicates first.

12. **`get_db_connection()` had eager `SELECT 1` health check** → ran on every call in tight loops. Replaced with lazy epoch-based check in `db_helpers.py`. Do not add per-call health checks back.

13. **`AnimePageV2.tsx` is the active primary page** — `AnimePage.tsx` is old and kept for reference only. Do not fix bugs in `AnimePage.tsx`.

---

## DEBUG ENDPOINTS

| Endpoint | Purpose |
|---|---|
| `GET /health/ping` | Ultra-fast liveness check (no DB, no filesystem) |
| `GET /health/capabilities` | Full health + capability flags (polled every 2500ms by frontend) |
| `GET /health/services` | Per-service status breakdown |
| `GET /health/log?service=NAME` | Recent health events for a service |
| `GET /health/circuit-breaker/status` | Circuit breaker state for all services |
| `POST /health/circuit-breaker/reset?service=NAME` | Force reset a circuit breaker |
| `GET /diagnostics/self-test` | Full self-test: DB, library, storage, queue, logs |
| `GET /diagnostics/logs?limit=N` | Last N backend log events |
| `POST /cache/clear` | Wipe content cache (add `?content_type=TYPE` to target one type) |
| `GET /cache/stats` | Cache size, entry count, per-type breakdown |
| `GET /consumet/anime/debug-stream?title=&episode=` | Full anime pipeline trace |
| `GET /consumet/anime/debug-watch/{ep_id}` | Raw sidecar watch result |
| `GET /providers/status` | All provider registry statuses |

---

## HANDOFF — CURRENT WORK

### 🔴 ACTIVE BUG — HLS Segment Fetching Fails

**Symptom:** Anime player shows episode duration (HLS source resolved ✓) but video never plays. Browser console shows `"AniWatch · Failed"` on segment requests.

**Root cause candidates (check in this order):**

1. **Missing `User-Agent` in segment proxy** — `streaming_helpers.py` → `stream_proxy()` fetches HLS segments but may not forward `User-Agent`. HiAnime's CDN requires it. Check `_normalize_request_headers()` — it sets a default UA, but confirm it's being passed to the `httpx.Client.get()` call inside `stream_proxy()`.

2. **Python MegaCloud key expired** — the scraped client key may have rotated. Check `GET /health/log?service=megacloud`. If the Python extractor is failing, restart the backend (forces a re-scrape) or wait for the background worker (20min cycle).

3. **Sidecar returning empty sources silently** — aniwatch npm broken since April 2026. If the Python `megacloud.py` fallback isn't being triggered, the sidecar may be returning empty results without an error. Check `GET /consumet/anime/debug-stream?title=<anime>&episode=1` → look at `step3_watch` array.

**Files most likely involved:**
- `backend/streaming_helpers.py` — segment proxy headers
- `backend/app/routes/consumet.py` — anime stream pipeline (lines ~460–490)
- `backend/app/services/megacloud.py` — Python fallback extractor + `_scrape_client_key()`
- `consumet-local/server.cjs` — Node sidecar (may need `npm update aniwatch`)

**Debug steps:**
1. `GET /consumet/anime/debug-stream?title=<anime>&episode=1` — check `step3_watch` results
2. `GET /health/log?service=aniwatch` — recent aniwatch health events
3. Check `AnimePageV2.tsx` → "Run Full Diagnostics" button — calls the debug endpoint and shows results inline
4. If all sidecar attempts fail: `cd consumet-local && npm update aniwatch && node server.cjs`

---

### ✅ PREVIOUSLY FIXED — Do Not Re-investigate

| Issue | Fix location |
|---|---|
| `stream_proxy()` async crash | `streaming_helpers.py` — reverted to sync `def`, uses `httpx.Client` |
| MegaCloud API broken (April 2026) | `app/services/megacloud.py` — Python reimplementation |
| DB `SELECT 1` on every connection | `db_helpers.py` — lazy epoch-based check |
| Consumet error bodies silently lost | `app/routes/consumet.py` — `_safe_error_body()` + `_attempt_errors` |

## Working Instructions

When I send you a full source project in a ZIP file, first read the `claude.md` file carefully to understand the project structure, purpose, and current status.

Then do the following:

1. Understand the problem I am working on.
2. Find the relevant files related to that issue.
3. Inspect the code to identify the real root cause.
4. Fix the problem permanently with the smallest possible code change.
5. Do not break any other existing code.
6. Return only the files that were changed.
7. For each changed file, clearly tell me:
   - the file path
   - where to replace it
   - the full updated content, ready to copy and paste
   - and explain in simple short what is happpening what was the problem how did you fix it explain in simple short as possbile 
   - On every reponse you give me you need to also give me the updated claude.md like if you fix some bug change anything needded to add in claude.md the add it otherwise it is not important for this file then don't do that 

When you make any code change, also update this `claude.md` file so it always reflects the latest:
- project structure
- progress
- fixes already made
- important notes for future work

The goal is to keep this file current so the next AI session can continue from the latest state without confusion.