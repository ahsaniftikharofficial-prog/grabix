const http = require("http");
const axios = require("axios");
const cheerio = require("cheerio");
const { HiAnime } = require("aniwatch");

const port = Number(process.env.PORT || 3000);
const siteBase = process.env.HIANIME_SITE_BASE || "https://aniwatchtv.to";
const ajaxBase = `${siteBase}/ajax/v2`;
const scraper = new HiAnime.Scraper();

function parsePage(value, fallback = 1) {
  const page = Number.parseInt(String(value || fallback), 10);
  return Number.isFinite(page) && page > 0 ? page : fallback;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, error) {
  const detail = error instanceof Error ? error.message : "Unknown Hianime request failure.";
  sendJson(res, 502, { detail });
}

function normalizeSearchResult(item) {
  const sub = item?.episodes?.sub ?? 0;
  const dub = item?.episodes?.dub ?? 0;
  return {
    id: String(item?.id || ""),
    title: String(item?.name || ""),
    url: `${siteBase}/watch/${item?.id || ""}`,
    image: String(item?.poster || ""),
    releaseDate: "",
    subOrDub: dub > 0 ? "dub" : "sub",
    type: String(item?.type || ""),
    otherName: String(item?.jname || ""),
    totalEpisodes: Math.max(sub || 0, dub || 0) || undefined,
  };
}

function normalizeSuggestion(item) {
  return {
    id: String(item?.id || ""),
    title: String(item?.name || ""),
    image: String(item?.poster || ""),
    url: `${siteBase}/watch/${item?.id || ""}`,
    releaseDate: Array.isArray(item?.moreInfo) ? String(item.moreInfo[0] || "") : "",
    subOrDub: "sub",
  };
}

function normalizeInfo(infoPayload, animeId) {
  const anime = infoPayload?.anime || {};
  const details = anime?.info || {};
  const moreInfo = anime?.moreInfo || {};
  const episodesStats = details?.stats?.episodes || {};
  const totalEpisodes = Math.max(episodesStats.sub || 0, episodesStats.dub || 0);

  return {
    id: animeId,
    title: String(details?.name || ""),
    url: `${siteBase}/watch/${animeId}`,
    image: String(details?.poster || ""),
    description: String(details?.description || ""),
    genres: Array.isArray(moreInfo?.genres) ? moreInfo.genres : [],
    subOrDub: episodesStats.dub ? "dub" : "sub",
    type: String(details?.stats?.type || ""),
    status: String(moreInfo?.status || ""),
    otherName: String(details?.jname || moreInfo?.japanese || moreInfo?.synonyms || ""),
    totalEpisodes,
    episodes: [],
    recommendedAnimes: Array.isArray(infoPayload?.recommendedAnimes)
      ? infoPayload.recommendedAnimes.map(normalizeSearchResult)
      : [],
    relatedAnimes: Array.isArray(infoPayload?.relatedAnimes)
      ? infoPayload.relatedAnimes.map(normalizeSearchResult)
      : [],
    seasons: Array.isArray(infoPayload?.seasons)
      ? infoPayload.seasons.map((season) => ({
          id: String(season?.id || ""),
          title: String(season?.name || ""),
          image: String(season?.poster || ""),
          isCurrent: Boolean(season?.isCurrent),
        }))
      : [],
  };
}

function normalizeEpisodes(episodesPayload, animeId) {
  return (episodesPayload?.episodes || []).map((episode) => ({
    id: String(episode?.episodeId || ""),
    number: Number(episode?.number || 0),
    title: String(episode?.title || `Episode ${episode?.number || ""}`),
    url: `${siteBase}/watch/${animeId}?ep=${String(episode?.episodeId || "").split("?ep=")[1] || ""}`,
    isFiller: Boolean(episode?.isFiller),
  }));
}

function mapServer(value) {
  const raw = String(value || "").trim().toLowerCase();
  switch (raw) {
    case "vidstreaming":
    case "hd-1":
      return { request: HiAnime.Servers.VidStreaming, serverId: "4", label: "VidSrc" };
    case "vidcloud":
    case "hd-2":
      return { request: HiAnime.Servers.VidCloud, serverId: "1", label: "MegaCloud" };
    case "streamsb":
      return { request: HiAnime.Servers.StreamSB, serverId: "5", label: "StreamSB" };
    case "streamtape":
      return { request: HiAnime.Servers.StreamTape, serverId: "3", label: "StreamTape" };
    case "megacloud":
      return { request: "megacloud", serverId: "1", label: "MegaCloud" };
    case "vidsrc":
      return { request: "vidsrc", serverId: "4", label: "VidSrc" };
    case "t-cloud":
      return { request: "t-cloud", serverId: "6", label: "T-Cloud" };
    default:
      return { request: HiAnime.Servers.VidStreaming, serverId: "4", label: "VidSrc" };
  }
}

function mapCategory(value) {
  return String(value || "").trim().toLowerCase() === "dub" ? "dub" : "sub";
}

async function fetchServerPayload(episodeId, requestedServer, category) {
  const epNumber = String(episodeId || "").split("?ep=")[1];
  if (!epNumber) {
    throw new Error("Invalid episode id");
  }

  const watchUrl = `${siteBase}/watch/${episodeId}`;
  const response = await axios.get(`${ajaxBase}/episode/servers?episodeId=${encodeURIComponent(epNumber)}`, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: watchUrl,
      "X-Requested-With": "XMLHttpRequest",
    },
    timeout: 20000,
  });
  const payload = typeof response.data === "string" ? JSON.parse(response.data) : response.data;
  const $ = cheerio.load(payload?.html || "");
  const match = $(`.server-item[data-type="${category}"][data-server-id="${requestedServer.serverId}"]`).first();
  const sourceId = match.attr("data-id");
  if (!sourceId) {
    throw new Error(`Couldn't find ${requestedServer.label} for ${category}.`);
  }

  const sourceResponse = await axios.get(`${ajaxBase}/episode/sources?id=${encodeURIComponent(sourceId)}`, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: watchUrl,
      "X-Requested-With": "XMLHttpRequest",
    },
    timeout: 20000,
  });
  return typeof sourceResponse.data === "string" ? JSON.parse(sourceResponse.data) : sourceResponse.data;
}

async function fetchWatch(episodeId, server, category) {
  const requestedServer = mapServer(server);
  const requestedCategory = mapCategory(category);

  try {
    const direct = await scraper.getEpisodeSources(episodeId, requestedServer.request, requestedCategory);
    const directSources = Array.isArray(direct?.sources) ? direct.sources : [];
    const directTracks = Array.isArray(direct?.subtitles) ? direct.subtitles : Array.isArray(direct?.tracks) ? direct.tracks : [];
    if (directSources.length > 0) {
      return {
        headers: direct?.headers || {},
        sources: directSources,
        subtitles: directTracks,
        download: direct?.download || "",
      };
    }
  } catch {}

  const fallback = await fetchServerPayload(episodeId, requestedServer, requestedCategory);
  const link = String(fallback?.link || "").trim();
  const tracks = Array.isArray(fallback?.tracks) ? fallback.tracks : [];

  if (!link) {
    throw new Error("Hianime did not return a playable link.");
  }

  return {
    headers: {},
    sources: [
      {
        url: link,
        quality: requestedServer.label,
        isM3U8: false,
        isEmbed: true,
        type: "embed",
      },
    ],
    subtitles: tracks,
    download: "",
  };
}

async function route(pathname, searchParams) {
  if (pathname === "/") {
    return { status: 200, body: { status: "GRABIX Consumet Local Running", provider: "hianime", siteBase } };
  }

  if (pathname.startsWith("/anime/hianime/watch/")) {
    const episodeId = decodeURIComponent(pathname.slice("/anime/hianime/watch/".length));
    return {
      status: 200,
      body: await fetchWatch(episodeId, searchParams.get("server"), searchParams.get("category")),
    };
  }

  if (pathname === "/anime/hianime/info") {
    const id = String(searchParams.get("id") || "").trim();
    if (!id) return { status: 400, body: { detail: "id is required" } };
    const infoPayload = await scraper.getInfo(id);
    const episodesPayload = await scraper.getEpisodes(id);
    const info = normalizeInfo(infoPayload, id);
    info.episodes = normalizeEpisodes(episodesPayload, id);
    info.totalEpisodes = Number(episodesPayload?.totalEpisodes || info.totalEpisodes || info.episodes.length || 0);
    return { status: 200, body: info };
  }

  if (pathname === "/anime/hianime/advanced-search") {
    const filters = {};
    for (const [key, value] of searchParams.entries()) {
      if (!value || key === "page") continue;
      filters[key] = value;
    }
    const data = await scraper.search(searchParams.get("keyword") || searchParams.get("query") || "", parsePage(searchParams.get("page")), filters);
    return {
      status: 200,
      body: {
        currentPage: data?.currentPage || 1,
        hasNextPage: Boolean(data?.hasNextPage),
        totalPages: data?.totalPages || 1,
        results: Array.isArray(data?.animes) ? data.animes.map(normalizeSearchResult) : [],
      },
    };
  }

  if (pathname.startsWith("/anime/hianime/search-suggestions/")) {
    const query = decodeURIComponent(pathname.slice("/anime/hianime/search-suggestions/".length));
    const data = await scraper.searchSuggestions(query);
    return { status: 200, body: { suggestions: Array.isArray(data?.suggestions) ? data.suggestions.map(normalizeSuggestion) : [] } };
  }

  if (pathname === "/anime/hianime/spotlight") {
    const home = await scraper.getHomePage();
    return { status: 200, body: { spotlightAnimes: Array.isArray(home?.spotlightAnimes) ? home.spotlightAnimes.map(normalizeSearchResult) : [] } };
  }

  if (pathname === "/anime/hianime/schedule") {
    const date = searchParams.get("date");
    const data = await scraper.getEstimatedSchedule(date || new Date().toISOString().slice(0, 10), -420);
    return {
      status: 200,
      body: {
        scheduledAnimes: Array.isArray(data?.scheduledAnimes)
          ? data.scheduledAnimes.map((item) => ({
              id: String(item?.id || ""),
              title: String(item?.name || ""),
              image: "",
              url: `${siteBase}/watch/${item?.id || ""}`,
              releaseDate: "",
              time: String(item?.time || ""),
            }))
          : [],
      },
    };
  }

  if (pathname === "/anime/hianime/genres") {
    const home = await scraper.getHomePage();
    const genres = Array.isArray(home?.genres) ? home.genres : [];
    return { status: 200, body: genres.map((genre) => ({ id: String(genre).toLowerCase(), name: String(genre) })) };
  }

  if (pathname.startsWith("/anime/hianime/genre/")) {
    const genre = decodeURIComponent(pathname.slice("/anime/hianime/genre/".length));
    const data = await scraper.getGenreAnime(genre, parsePage(searchParams.get("page")));
    return {
      status: 200,
      body: {
        currentPage: data?.currentPage || 1,
        hasNextPage: Boolean(data?.hasNextPage),
        totalPages: data?.totalPages || 1,
        results: Array.isArray(data?.animes) ? data.animes.map(normalizeSearchResult) : [],
      },
    };
  }

  if (pathname.startsWith("/anime/hianime/studio/")) {
    const studio = decodeURIComponent(pathname.slice("/anime/hianime/studio/".length));
    const data = await scraper.getProducerAnimes(studio, parsePage(searchParams.get("page")));
    return {
      status: 200,
      body: {
        currentPage: data?.currentPage || 1,
        hasNextPage: Boolean(data?.hasNextPage),
        totalPages: data?.totalPages || 1,
        results: Array.isArray(data?.animes) ? data.animes.map(normalizeSearchResult) : [],
      },
    };
  }

  const categoryMap = {
    "/anime/hianime/top-airing": "top-airing",
    "/anime/hianime/most-popular": "most-popular",
    "/anime/hianime/most-favorite": "most-favorite",
    "/anime/hianime/latest-completed": "completed",
    "/anime/hianime/recently-updated": "recently-updated",
    "/anime/hianime/recently-added": "recently-added",
    "/anime/hianime/top-upcoming": "top-upcoming",
    "/anime/hianime/subbed-anime": "subbed-anime",
    "/anime/hianime/dubbed-anime": "dubbed-anime",
    "/anime/hianime/movie": "movie",
    "/anime/hianime/tv": "tv",
    "/anime/hianime/ova": "ova",
    "/anime/hianime/ona": "ona",
    "/anime/hianime/special": "special",
  };

  if (categoryMap[pathname]) {
    const data = await scraper.getCategoryAnime(categoryMap[pathname], parsePage(searchParams.get("page")));
    return {
      status: 200,
      body: {
        currentPage: data?.currentPage || 1,
        hasNextPage: Boolean(data?.hasNextPage),
        totalPages: data?.totalPages || 1,
        results: Array.isArray(data?.animes) ? data.animes.map(normalizeSearchResult) : [],
      },
    };
  }

  if (pathname.startsWith("/anime/hianime/")) {
    const query = decodeURIComponent(pathname.slice("/anime/hianime/".length));
    const data = await scraper.search(query, parsePage(searchParams.get("page")));
    return {
      status: 200,
      body: {
        currentPage: data?.currentPage || 1,
        hasNextPage: Boolean(data?.hasNextPage),
        totalPages: data?.totalPages || 1,
        results: Array.isArray(data?.animes) ? data.animes.map(normalizeSearchResult) : [],
      },
    };
  }

  return { status: 404, body: { detail: "Route not found." } };
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    sendJson(res, 400, { detail: "Invalid request URL." });
    return;
  }

  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { detail: "Method not allowed." });
    return;
  }

  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const result = await route(url.pathname, url.searchParams);
    sendJson(res, result.status, result.body);
  } catch (error) {
    sendError(res, error);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`GRABIX Hianime local server listening on http://127.0.0.1:${port}`);
});
