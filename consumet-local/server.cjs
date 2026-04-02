const http = require("http");
const axios = require("axios");
const cheerio = require("cheerio");
const { HiAnime } = require("aniwatch");

const port = Number(process.env.PORT || 3000);
const siteBase = process.env.HIANIME_SITE_BASE || "https://aniwatchtv.to";
const ajaxBase = `${siteBase}/ajax/v2`;
const scraper = new HiAnime.Scraper();

function decodeBase64(value) {
  return Buffer.from(String(value || ""), "base64").toString("utf8");
}

function columnarCipher(text, key) {
  const cols = key.length;
  const rows = Math.ceil(text.length / cols);
  const order = key
    .split("")
    .map((char, index) => ({ char, index }))
    .sort((a, b) => (a.char === b.char ? a.index - b.index : a.char.localeCompare(b.char)));

  const colLengths = new Array(cols).fill(Math.floor(text.length / cols));
  for (let index = 0; index < text.length % cols; index += 1) {
    colLengths[order[index].index] += 1;
  }

  const grid = new Array(rows).fill(null).map(() => new Array(cols).fill(""));
  let cursor = 0;
  for (const { index } of order) {
    const length = colLengths[index];
    for (let row = 0; row < length; row += 1) {
      grid[row][index] = text[cursor++] || "";
    }
  }

  let result = "";
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (grid[row][col]) result += grid[row][col];
    }
  }
  return result;
}

function seedShuffle(characterArray, inputKey) {
  let hashVal = 0n;
  for (let index = 0; index < inputKey.length; index += 1) {
    hashVal = (hashVal * 31n + BigInt(inputKey.charCodeAt(index))) & 0xffffffffn;
  }

  let shuffleNum = hashVal;
  const pseudoRand = (arg) => {
    shuffleNum = (shuffleNum * 1103515245n + 12345n) & 0x7fffffffn;
    return Number(shuffleNum % BigInt(arg));
  };

  const shuffled = [...characterArray];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const rand = pseudoRand(index + 1);
    [shuffled[index], shuffled[rand]] = [shuffled[rand], shuffled[index]];
  }
  return shuffled;
}

function keygen2(megacloudKey, clientKey) {
  const keygenHashMultVal = 31n;
  const keygenXorVal = 247;
  const keygenShiftVal = 5;
  let tempKey = `${megacloudKey}${clientKey}`;
  let hashVal = 0n;

  for (let index = 0; index < tempKey.length; index += 1) {
    hashVal = BigInt(tempKey.charCodeAt(index)) + hashVal * keygenHashMultVal + (hashVal << 7n) - hashVal;
  }

  hashVal = hashVal < 0n ? -hashVal : hashVal;
  const limitedHash = Number(hashVal % 0x7fffffffffffffffn);
  tempKey = tempKey
    .split("")
    .map((char) => String.fromCharCode(char.charCodeAt(0) ^ keygenXorVal))
    .join("");

  const pivot = (limitedHash % tempKey.length) + keygenShiftVal;
  tempKey = tempKey.slice(pivot) + tempKey.slice(0, pivot);
  const reversedClient = clientKey.split("").reverse().join("");

  let output = "";
  for (let index = 0; index < Math.max(tempKey.length, reversedClient.length); index += 1) {
    output += `${tempKey[index] || ""}${reversedClient[index] || ""}`;
  }

  output = output.substring(0, 96 + (limitedHash % 33));
  return [...output]
    .map((char) => String.fromCharCode((char.charCodeAt(0) % 95) + 32))
    .join("");
}

function decryptMegaCloudSources(src, clientKey, megacloudKey) {
  let decrypted = decodeBase64(src);
  const charArray = [...Array(95)].map((_, index) => String.fromCharCode(32 + index));
  const generatedKey = keygen2(megacloudKey, clientKey);

  const reverseLayer = (iteration) => {
    const layerKey = `${generatedKey}${iteration}`;
    let hashVal = 0n;

    for (let index = 0; index < layerKey.length; index += 1) {
      hashVal = (hashVal * 31n + BigInt(layerKey.charCodeAt(index))) & 0xffffffffn;
    }

    let seed = hashVal;
    const seedRand = (arg) => {
      seed = (seed * 1103515245n + 12345n) & 0x7fffffffn;
      return Number(seed % BigInt(arg));
    };

    decrypted = decrypted
      .split("")
      .map((char) => {
        const charIndex = charArray.indexOf(char);
        if (charIndex === -1) return char;
        const randNum = seedRand(95);
        return charArray[(charIndex - randNum + 95) % 95];
      })
      .join("");

    decrypted = columnarCipher(decrypted, layerKey);
    const shuffled = seedShuffle(charArray, layerKey);
    const charMap = {};
    shuffled.forEach((char, index) => {
      charMap[char] = charArray[index];
    });
    decrypted = decrypted
      .split("")
      .map((char) => charMap[char] || char)
      .join("");
  };

  for (let layer = 3; layer > 0; layer -= 1) {
    reverseLayer(layer);
  }

  const dataLength = Number.parseInt(decrypted.substring(0, 4), 10);
  return decrypted.substring(4, 4 + dataLength);
}

async function getMegaCloudClientKey(sourceId) {
  const response = await axios.get(`https://megacloud.blog/embed-2/v3/e-1/${sourceId}`, {
    headers: {
      Referer: `${siteBase}/`,
      "User-Agent": "Mozilla/5.0",
    },
    timeout: 20000,
  });
  const text = String(response.data || "");
  const directMatch = text.match(/window\._xy_ws\s*=\s*["'`]([^"'`]+)["'`];/);
  if (directMatch?.[1]) {
    return directMatch[1];
  }
  const regexes = [
    /<meta name="_gg_fb" content="[a-zA-Z0-9]+">/,
    /<!--\s+_is_th:[0-9a-zA-Z]+\s+-->/,
    /<script>window._lk_db\s+=\s+\{[xyz]:\s+["'`][a-zA-Z0-9]+["'`],\s+[xyz]:\s+["'`][a-zA-Z0-9]+["'`],\s+[xyz]:\s+["'`][a-zA-Z0-9]+["'`]\};<\/script>/,
    /<div\s+data-dpi="[0-9a-zA-Z]+"\s+.*><\/div>/,
    /<script nonce="[0-9a-zA-Z]+">/,
    /<script>window._xy_ws = ['"`][0-9a-zA-Z]+['"`];<\/script>/,
  ];

  const keyMatch = /"[a-zA-Z0-9]+"/;
  for (let index = 0; index < regexes.length; index += 1) {
    const match = text.match(regexes[index]);
    if (!match) continue;

    if (index === 2) {
      const parts = [...match[0].matchAll(/[xyz]:\s+"([a-zA-Z0-9]+)"/g)].map((item) => item[1]);
      if (parts.length === 3) return parts.join("");
    }

    if (index === 4) {
      const nonceMatch = match[0].match(/:[a-zA-Z0-9]+ /);
      if (nonceMatch) return nonceMatch[0].replaceAll(":", "").replaceAll(" ", "");
    }

    const directMatch = match[0].match(keyMatch);
    if (directMatch) return directMatch[0].replaceAll('"', "");
  }

  throw new Error("Failed extracting MegaCloud client key");
}

async function extractMegaCloud(link) {
  const embedUrl = new URL(link);
  const sourceIdMatch = /\/([^/?]+)\?/.exec(embedUrl.href);
  const sourceId = sourceIdMatch?.[1];
  if (!sourceId) {
    throw new Error("Unable to extract MegaCloud source id");
  }

  const clientKey = await getMegaCloudClientKey(sourceId);
  const { data } = await axios.get(
    `https://megacloud.blog/embed-2/v3/e-1/getSources?id=${sourceId}&_k=${encodeURIComponent(clientKey)}`,
    {
      timeout: 20000,
      headers: {
        Referer: `${embedUrl.origin}/`,
        "User-Agent": "Mozilla/5.0",
        "X-Requested-With": "XMLHttpRequest",
      },
    }
  );

  let decryptedSources = data?.sources;
  if (data?.encrypted) {
    throw new Error("Encrypted MegaCloud source payload is not supported by the current v3 extractor");
  }

  const sources = Array.isArray(decryptedSources)
    ? decryptedSources.map((item) => ({
        url: item?.file,
        isM3U8: item?.type === "hls",
        type: item?.type || "auto",
      })).filter((item) => Boolean(item.url))
    : [];

  const subtitles = Array.isArray(data?.tracks)
    ? data.tracks
        .filter((track) => track?.kind === "captions")
        .map((track) => ({
          url: track.file,
          lang: track.label || track.kind,
          default: Boolean(track.default),
        }))
    : [];

  return {
    headers: { Referer: `${embedUrl.origin}/` },
    sources,
    subtitles,
    download: "",
  };
}

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
  const detail = error instanceof Error ? error.message : "Unknown Consumet gateway failure.";
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 502;
  sendJson(res, statusCode, { detail });
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
    rank: Number(item?.rank || 0) || undefined,
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
    dubEpisodeCount: Number(episodesStats.dub || 0),
    subEpisodeCount: Number(episodesStats.sub || 0),
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

  const fallback = await fetchServerPayload(episodeId, requestedServer, requestedCategory);
  const link = String(fallback?.link || "").trim();
  const tracks = Array.isArray(fallback?.tracks) ? fallback.tracks : [];

  if (!link) {
    throw new Error("Hianime did not return a playable link.");
  }

  try {
    if (link.includes("megacloud.blog")) {
      const extracted = await extractMegaCloud(link);
      if (Array.isArray(extracted.sources) && extracted.sources.length > 0) {
        if ((!extracted.subtitles || extracted.subtitles.length === 0) && tracks.length > 0) {
          extracted.subtitles = tracks;
        }
        return extracted;
      }
    }
  } catch {}

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
    return {
      status: 200,
      body: {
        status: "GRABIX Consumet Gateway Running",
        animeProvider: "hianime",
        siteBase,
      },
    };
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

  if (pathname === "/anime/hianime/top10") {
    const home = await scraper.getHomePage();
    const rawPeriod = String(searchParams.get("period") || "today").toLowerCase();
    const period = rawPeriod === "daily" ? "today" : rawPeriod === "weekly" ? "week" : rawPeriod === "monthly" ? "month" : rawPeriod;
    const top10 = home?.top10Animes || {};
    const items = Array.isArray(top10?.[period]) ? top10[period].map(normalizeSearchResult) : [];
    return { status: 200, body: { period, items } };
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
  console.log(`GRABIX Consumet gateway listening on http://127.0.0.1:${port}`);
  console.log(`Anime provider: HiAnime (${siteBase})`);
});
