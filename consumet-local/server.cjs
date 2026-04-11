const http = require("http");
const axios = require("axios");
const cheerio = require("cheerio");
const { HiAnime } = require("aniwatch");
const { ANIME } = require("@consumet/extensions");

// Fallback anime provider scrapers (used when HiAnime fails)
const animeKai = new ANIME.AnimeKai();
const kickAss = new ANIME.KickAssAnime();
const animePahe = new ANIME.AnimePahe();

function readOption(flag) {
  const directPrefix = `${flag}=`;
  for (let index = 0; index < process.argv.length; index += 1) {
    const entry = process.argv[index];
    if (entry === flag) {
      return process.argv[index + 1];
    }
    if (entry.startsWith(directPrefix)) {
      return entry.slice(directPrefix.length);
    }
  }
  return "";
}

const cliPort = readOption("--port");
const cliSiteBase = readOption("--site-base");
const port = Number(cliPort || process.env.PORT || 3000);
const siteBase = cliSiteBase || process.env.HIANIME_SITE_BASE || "https://aniwatchtv.to";
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
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
    },
    timeout: 20000,
  });
  const text = String(response.data || "");

  // Pattern 1: direct window._xy_ws = 'key' (most common recent pattern, with or without semicolon)
  const directMatch = text.match(/window\._xy_ws\s*=\s*["'`]([^"'`\s]{8,})["'`]/);
  if (directMatch?.[1]) return directMatch[1];

  // Pattern 2: broad catch-all — any window._xxx = 'alphanumeric' assignment
  const broadWindowMatches = [...text.matchAll(/window\._[a-zA-Z_$]{1,20}\s*=\s*["'`]([a-zA-Z0-9]{8,})["'`]/g)];
  if (broadWindowMatches.length > 0) {
    const combined = broadWindowMatches.map((m) => m[1]).join("");
    if (combined.length >= 8) return combined;
  }

  // Pattern 3: meta tag with key content
  const metaMatch = text.match(/<meta\s+name=["']_gg_fb["']\s+content=["']([a-zA-Z0-9]+)["']/);
  if (metaMatch?.[1]) return metaMatch[1];

  // Pattern 4: HTML comment key
  const commentMatch = text.match(/<!--\s+_is_th:([0-9a-zA-Z]+)\s+-->/);
  if (commentMatch?.[1]) return commentMatch[1];

  // Pattern 5: window._lk_db = {x: 'a', y: 'b', z: 'c'} — concatenate all string values
  const lkDbMatch = text.match(/window\._lk_db\s*=\s*\{([^}]+)\}/);
  if (lkDbMatch) {
    const parts = [...lkDbMatch[1].matchAll(/["'`]([a-zA-Z0-9]+)["'`]/g)].map((m) => m[1]);
    if (parts.length > 0) return parts.join("");
  }

  // Pattern 6: data-dpi attribute
  const dpiMatch = text.match(/data-dpi=["']([a-zA-Z0-9]{8,})["']/);
  if (dpiMatch?.[1]) return dpiMatch[1];

  // Pattern 7: script nonce attribute used as key
  const nonceMatch = text.match(/<script\s+nonce=["']([a-zA-Z0-9]{12,})["']/);
  if (nonceMatch?.[1]) return nonceMatch[1];

  // Pattern 8: double/triple underscore window variable variants
  const deepWindowMatch = text.match(/window\.__+[a-zA-Z_$]*\s*=\s*["'`]([a-zA-Z0-9]{8,})["'`]/);
  if (deepWindowMatch?.[1]) return deepWindowMatch[1];

  // Pattern 9: scan inline script tags for any variable = 'longkey' assignment
  const scriptTagMatches = [...text.matchAll(/<script(?:\s[^>]*)?>([^<]{10,})<\/script>/gs)];
  for (const scriptMatch of scriptTagMatches) {
    const content = scriptMatch[1];
    const assignMatch = content.match(/(?:var|let|const)\s+[a-zA-Z_$][a-zA-Z0-9_$]*\s*=\s*["'`]([a-zA-Z0-9]{16,})["'`]/);
    if (assignMatch?.[1]) return assignMatch[1];
  }

  // Pattern 10: last resort — any = 'longalphanumeric' anywhere on the page
  const lastResortMatches = [...text.matchAll(/=\s*["'`]([a-zA-Z0-9]{16,64})["'`]/g)];
  for (const m of lastResortMatches) {
    const candidate = m[1];
    // Skip obvious non-keys: pure numbers, known base64 padding patterns
    if (/^\d+$/.test(candidate)) continue;
    return candidate;
  }

  throw new Error(
    "getMegaCloudClientKey: all extraction patterns exhausted — MegaCloud likely changed their key embedding. " +
    "Please open megacloud.blog/embed-2/v3/e-1/<any-sourceId> in a browser, " +
    "find the window._ key assignment, and add a new pattern."
  );
}

// Shared result builder for extractMegaCloud
function buildMegaCloudResult(data, embedUrl) {
  const rawSources = Array.isArray(data.sources) ? data.sources : [];
  const sources = rawSources
    .map((item) => ({
      url: item?.file || item?.url,
      isM3U8: item?.type === "hls" || String(item?.file || item?.url || "").includes(".m3u8"),
      type: item?.type || "auto",
      quality: item?.label || item?.quality || "Auto",
    }))
    .filter((s) => Boolean(s.url));
  const subtitles = Array.isArray(data?.tracks)
    ? data.tracks
        .filter((t) => t?.kind === "captions" || t?.kind === "subtitles")
        .map((t) => ({ url: t.file, lang: t.label || t.kind, default: Boolean(t.default) }))
    : [];
  return { headers: { Referer: `${embedUrl.origin}/` }, sources, subtitles, download: data?.download || "" };
}

async function extractMegaCloud(link) {
  const embedUrl = new URL(link);
  // Extract the source ID — last path segment before '?'
  const pathParts = embedUrl.pathname.split("/").filter(Boolean);
  const sourceId = pathParts[pathParts.length - 1];
  if (!sourceId) throw new Error("Unable to extract MegaCloud source id from: " + link);

  // Honour both megacloud.blog and megacloud.tv domains
  const embedDomain = embedUrl.hostname.includes("megacloud.tv") ? "megacloud.tv" : "megacloud.blog";

  const commonHeaders = {
    Referer: `${siteBase}/`,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json, text/plain, */*",
  };

  // ── STAGE 1: Ajax endpoint — requires NO client key ───────────────────────
  // This is the simplest path. When sources are not encrypted it works instantly.
  let data = null;
  try {
    const r = await axios.get(
      `https://${embedDomain}/embed-2/ajax/e-1/getSources?id=${sourceId}`,
      { headers: commonHeaders, timeout: 20000 }
    );
    data = r.data;
  } catch (e) {
    throw new Error(`MegaCloud ajax request failed: ${e.message}`);
  }

  // ── Not encrypted → sources are ready immediately ─────────────────────────
  if (data && !data.encrypted && Array.isArray(data.sources) && data.sources.length > 0) {
    return buildMegaCloudResult(data, embedUrl);
  }

  // ── Encrypted → attempt decryption ───────────────────────────────────────
  if (data && data.encrypted && typeof data.sources === "string") {
    // The ajax response sometimes includes the megacloudKey directly in `data.key`
    const megacloudKey = String(data?.key || "").trim();
    // We still need the clientKey from the embed HTML page
    let clientKey = "";
    try { clientKey = await getMegaCloudClientKey(sourceId); } catch {}

    if (clientKey && megacloudKey) {
      try {
        const raw = decryptMegaCloudSources(data.sources, clientKey, megacloudKey);
        const decrypted = JSON.parse(raw);
        if (Array.isArray(decrypted) && decrypted.length > 0) {
          data.sources = decrypted;
          return buildMegaCloudResult(data, embedUrl);
        }
      } catch {}
    }

    throw new Error(
      `MegaCloud sources are encrypted and could not be decrypted. ` +
      `clientKey=${clientKey ? "found" : "MISSING"}, ` +
      `megacloudKey=${megacloudKey ? "found" : "MISSING — ajax response contained no key field"}. ` +
      `Run the debug endpoint: GET /anime/hianime/debug-watch/<episode-id> for a full diagnostic.`
    );
  }

  throw new Error(
    `MegaCloud returned no usable data. ` +
    `encrypted=${data?.encrypted}, sources type=${typeof data?.sources}. ` +
    `Run: GET /anime/hianime/debug-watch/<episode-id> for a full diagnostic.`
  );
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

  // Build the ordered list of servers to try: requested first, then the other one as fallback.
  const fallbackServer =
    requestedServer.request === HiAnime.Servers.VidStreaming
      ? mapServer("vidcloud")
      : mapServer("vidstreaming");
  const serversToTry = [requestedServer, fallbackServer];

  // PRIMARY: aniwatch library scraper — try each server until we get real HLS sources.
  for (const tryServer of serversToTry) {
    try {
      const direct = await scraper.getEpisodeSources(episodeId, tryServer.request, requestedCategory);
      const directSources = Array.isArray(direct?.sources) ? direct.sources : [];
      const directTracks = Array.isArray(direct?.subtitles)
        ? direct.subtitles
        : Array.isArray(direct?.tracks)
        ? direct.tracks
        : [];
      // Only accept real HLS/direct sources — reject embed or sourceless results.
      const playable = directSources.filter(
        (s) => s.isM3U8 || String(s.url || "").includes(".m3u8") || String(s.type || "").toLowerCase() === "hls"
      );
      if (playable.length > 0) {
        return {
          headers: direct?.headers || {},
          sources: playable,
          subtitles: directTracks,
          download: direct?.download || "",
        };
      }
    } catch {}
  }

  // SECONDARY: manual AJAX + MegaCloud extraction — try each server.
  for (const tryServer of serversToTry) {
    let link = "";
    let tracks = [];
    try {
      const fallback = await fetchServerPayload(episodeId, tryServer, requestedCategory);
      link = String(fallback?.link || "").trim();
      tracks = Array.isArray(fallback?.tracks) ? fallback.tracks : [];
    } catch {}

    if (!link) continue;

    if (link.includes("megacloud.blog") || link.includes("megacloud.tv")) {
      try {
        const extracted = await extractMegaCloud(link);
        const playable = (extracted.sources || []).filter(
          (s) => s.isM3U8 || String(s.url || "").includes(".m3u8")
        );
        if (playable.length > 0) {
          if ((!extracted.subtitles || extracted.subtitles.length === 0) && tracks.length > 0) {
            extracted.subtitles = tracks;
          }
          extracted.sources = playable;
          return extracted;
        }
      } catch {}
    }

    // Non-MegaCloud link that looks like a direct HLS stream — trust it.
    if (link.includes(".m3u8")) {
      return {
        headers: {},
        sources: [{ url: link, isM3U8: true, type: "hls", quality: tryServer.label }],
        subtitles: tracks,
        download: "",
      };
    }
  }

  // TERTIARY: try the other category (dub↔sub) as a last attempt.
  const otherCategory = requestedCategory === "sub" ? "dub" : "sub";
  for (const tryServer of serversToTry) {
    try {
      const direct = await scraper.getEpisodeSources(episodeId, tryServer.request, otherCategory);
      const directSources = Array.isArray(direct?.sources) ? direct.sources : [];
      const playable = directSources.filter(
        (s) => s.isM3U8 || String(s.url || "").includes(".m3u8")
      );
      if (playable.length > 0) {
        return {
          headers: direct?.headers || {},
          sources: playable,
          subtitles: Array.isArray(direct?.subtitles) ? direct.subtitles : [],
          download: direct?.download || "",
        };
      }
    } catch {}
  }

  // All extraction paths failed — throw a clear error instead of returning an unplayable embed URL.
  throw new Error(
    `fetchWatch: could not extract a playable HLS stream for episode "${episodeId}" ` +
    `(tried: vidstreaming + vidcloud, sub + dub). ` +
    `This usually means the aniwatch npm package is outdated or MegaCloud changed their API. ` +
    `Run: cd consumet-local && npm update aniwatch && node server.cjs`
  );
}

async function route(pathname, searchParams) {
  if (pathname === "/anime/hianime/home") {
    const home = await scraper.getHomePage();
    const normalizeList = (arr) => Array.isArray(arr) ? arr.map(normalizeSearchResult) : [];
    return {
      status: 200,
      body: {
        spotlightAnimes: normalizeList(home?.spotlightAnimes),
        trendingAnimes: normalizeList(home?.trendingAnimes),
        latestEpisodeAnimes: normalizeList(home?.latestEpisodeAnimes),
        topUpcomingAnimes: normalizeList(home?.topUpcomingAnimes),
        topAiringAnimes: normalizeList(home?.topAiringAnimes),
        top10Animes: {
          today: normalizeList(home?.top10Animes?.today),
          week: normalizeList(home?.top10Animes?.week),
          month: normalizeList(home?.top10Animes?.month),
        },
        genres: Array.isArray(home?.genres) ? home.genres : [],
      },
    };
  }

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

  // ── AnimeKai routes ────────────────────────────────────────────────────────

  if (pathname === "/anime/animekai/info") {
    const id = String(searchParams.get("id") || "").trim();
    if (!id) return { status: 400, body: { detail: "id is required" } };
    const data = await animeKai.fetchAnimeInfo(id);
    return { status: 200, body: data };
  }

  if (pathname.startsWith("/anime/animekai/watch/")) {
    const episodeId = decodeURIComponent(pathname.slice("/anime/animekai/watch/".length));
    const server = searchParams.get("server") || undefined;
    const data = await animeKai.fetchEpisodeSources(episodeId, server);
    return { status: 200, body: data };
  }

  if (pathname.startsWith("/anime/animekai/")) {
    const query = decodeURIComponent(pathname.slice("/anime/animekai/".length));
    const data = await animeKai.search(query, parsePage(searchParams.get("page")));
    return {
      status: 200,
      body: {
        currentPage: data?.currentPage || 1,
        hasNextPage: Boolean(data?.hasNextPage),
        results: Array.isArray(data?.results) ? data.results : [],
      },
    };
  }

  // ── KickAssAnime routes ────────────────────────────────────────────────────

  if (pathname === "/anime/kickassanime/info") {
    const id = String(searchParams.get("id") || "").trim();
    if (!id) return { status: 400, body: { detail: "id is required" } };
    const data = await kickAss.fetchAnimeInfo(id);
    return { status: 200, body: data };
  }

  if (pathname === "/anime/kickassanime/watch") {
    const episodeId = String(searchParams.get("episodeId") || "").trim();
    if (!episodeId) return { status: 400, body: { detail: "episodeId is required" } };
    const server = searchParams.get("server") || undefined;
    const data = await kickAss.fetchEpisodeSources(episodeId, server);
    return { status: 200, body: data };
  }

  if (pathname.startsWith("/anime/kickassanime/")) {
    const query = decodeURIComponent(pathname.slice("/anime/kickassanime/".length));
    const data = await kickAss.search(query, parsePage(searchParams.get("page")));
    return {
      status: 200,
      body: {
        currentPage: data?.currentPage || 1,
        hasNextPage: Boolean(data?.hasNextPage),
        results: Array.isArray(data?.results) ? data.results : [],
      },
    };
  }

  // ── AnimePahe routes ───────────────────────────────────────────────────────

  if (pathname.startsWith("/anime/animepahe/info/")) {
    const id = decodeURIComponent(pathname.slice("/anime/animepahe/info/".length));
    if (!id) return { status: 400, body: { detail: "id is required" } };
    const data = await animePahe.fetchAnimeInfo(id);
    return { status: 200, body: data };
  }

  if (pathname === "/anime/animepahe/watch") {
    const episodeId = String(searchParams.get("episodeId") || "").trim();
    if (!episodeId) return { status: 400, body: { detail: "episodeId is required" } };
    const data = await animePahe.fetchEpisodeSources(episodeId);
    return { status: 200, body: data };
  }

  if (pathname.startsWith("/anime/animepahe/")) {
    const query = decodeURIComponent(pathname.slice("/anime/animepahe/".length));
    const data = await animePahe.search(query);
    return {
      status: 200,
      body: {
        results: Array.isArray(data?.results) ? data.results : [],
      },
    };
  }

  // ── Debug: full watch pipeline diagnostic ────────────────────────────────
  if (pathname.startsWith("/anime/hianime/debug-watch/")) {
    const episodeId = decodeURIComponent(pathname.slice("/anime/hianime/debug-watch/".length));
    const epNumber = String(episodeId || "").split("?ep=")[1];
    const debug = { episodeId, epNumber, steps: {} };
    const debugHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Referer: `${siteBase}/watch/${episodeId}`,
      "X-Requested-With": "XMLHttpRequest",
    };

    try {
      // Step 1: server list
      const sr = await axios.get(
        `${ajaxBase}/episode/servers?episodeId=${encodeURIComponent(epNumber)}`,
        { headers: debugHeaders, timeout: 15000 }
      );
      const payload = typeof sr.data === "string" ? JSON.parse(sr.data) : sr.data;
      const $ = cheerio.load(payload?.html || "");
      const servers = [];
      $(".server-item").each((_, el) => {
        servers.push({
          type: $(el).attr("data-type"),
          serverId: $(el).attr("data-server-id"),
          id: $(el).attr("data-id"),
          label: $(el).text().trim(),
        });
      });
      debug.steps.step1_server_list = { ok: true, count: servers.length, servers };

      if (servers.length === 0) {
        debug.steps.step1_server_list.note = "No servers found in HTML — aniwatchtv.to may be blocking the request";
        return { status: 200, body: debug };
      }

      // Step 2: get embed link for first available server
      const first = servers[0];
      const linkResp = await axios.get(
        `${ajaxBase}/episode/sources?id=${encodeURIComponent(first.id)}`,
        { headers: debugHeaders, timeout: 15000 }
      );
      const linkData = typeof linkResp.data === "string" ? JSON.parse(linkResp.data) : linkResp.data;
      debug.steps.step2_embed_link = { ok: true, server: first, data: linkData };

      // Step 3: MegaCloud ajax sources (if applicable)
      const link = String(linkData?.link || "");
      if (link.includes("megacloud")) {
        const embedUrl = new URL(link);
        const pathParts = embedUrl.pathname.split("/").filter(Boolean);
        const sourceId = pathParts[pathParts.length - 1];
        const embedDomain = link.includes("megacloud.tv") ? "megacloud.tv" : "megacloud.blog";

        const mcResp = await axios.get(
          `https://${embedDomain}/embed-2/ajax/e-1/getSources?id=${sourceId}`,
          {
            headers: {
              Referer: `${siteBase}/`,
              "User-Agent": "Mozilla/5.0",
              "X-Requested-With": "XMLHttpRequest",
              Accept: "application/json, text/plain, */*",
            },
            timeout: 15000,
          }
        );
        const mcData = mcResp.data;
        debug.steps.step3_megacloud_ajax = {
          ok: true,
          sourceId,
          embedDomain,
          encrypted: mcData?.encrypted,
          sources_type: typeof mcData?.sources,
          sources_is_array: Array.isArray(mcData?.sources),
          sources_count: Array.isArray(mcData?.sources) ? mcData.sources.length : "N/A",
          has_key_field: Boolean(mcData?.key),
          tracks_count: Array.isArray(mcData?.tracks) ? mcData.tracks.length : 0,
          first_source: Array.isArray(mcData?.sources) ? mcData.sources[0] : "(string — encrypted)",
          verdict: !mcData?.encrypted && Array.isArray(mcData?.sources) && mcData.sources.length > 0
            ? "✅ UNENCRYPTED — extractMegaCloud fix will work"
            : mcData?.encrypted && mcData?.key
            ? "⚠️ ENCRYPTED but key is present — decryption may work"
            : mcData?.encrypted
            ? "❌ ENCRYPTED and no key — decryption will fail"
            : "❌ Unknown state",
        };
      } else {
        debug.steps.step3_megacloud_ajax = { skipped: true, reason: "Link is not a MegaCloud URL", link };
      }
    } catch (e) {
      debug.steps.error = { message: e.message, stack: e.stack?.split("\n").slice(0, 4) };
    }

    return { status: 200, body: debug };
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
