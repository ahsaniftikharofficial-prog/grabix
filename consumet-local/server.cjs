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

// Known working keys as of April 2026 — used as fallback if fetch fails
const FALLBACK_MEGACLOUD_KEYS = {
  rabbit: "3AlttPAF1Zwn2l63meMeGMIvlWOXgm9ZXNk3glEzLTGOr1F113",
  mega:   "nTAygRRNLS3wo82OtMyfPrWgD9K2UIvcwlj",
  vidstr: "nTAygRRNLS3wo82OtMyfPrWgD9K2UIvcwlj",
};

async function getMegaCloudKeys() {
  // Try multiple key repos in order — whichever responds first with valid keys wins.
  const KEY_URLS = [
    "https://raw.githubusercontent.com/yogesh-hacker/MegacloudKeys/refs/heads/main/keys.json",
    "https://raw.githubusercontent.com/consumet/rapidcloudKeys/refs/heads/main/keys.json",
    "https://raw.githubusercontent.com/aniwatch-team/megacloud-keys/refs/heads/main/keys.json",
  ];
  for (const url of KEY_URLS) {
    try {
      const r = await axios.get(url, { timeout: 6000 });
      const k = r.data || {};
      if (k.rabbit || k.mega || k.vidstr) {
        return {
          rabbit: k.rabbit || FALLBACK_MEGACLOUD_KEYS.rabbit,
          mega:   k.mega   || FALLBACK_MEGACLOUD_KEYS.mega,
          vidstr: k.vidstr || FALLBACK_MEGACLOUD_KEYS.vidstr,
        };
      }
    } catch {}
  }
  return FALLBACK_MEGACLOUD_KEYS;
}

// ── Live key extraction from MegaCloud embed page ────────────────────────────
// The _k value MegaCloud validates is embedded in their own player JavaScript.
// We scrape it at call-time so we're never blocked by stale third-party key repos.
async function scrapeKeyFromEmbedPage(embedPageUrl, embedDomain, fullUA, refererBase) {
  // Regex patterns covering all known ways the key appears in minified player JS
  const KEY_REGEXES = [
    /_k\s*[:=]\s*["'`]([A-Za-z0-9]{20,})["'`]/g,
    /[?&]_k=["'`]?([A-Za-z0-9]{20,})["'`]?/g,
    /clientKey\s*[:=]\s*["'`]([A-Za-z0-9]{20,})["'`]/g,
    /"_k"\s*:\s*"([A-Za-z0-9]{20,})"/g,
    /\bkey\s*[:=]\s*["'`]([A-Za-z0-9]{30,})["'`]/g,
  ];
  function findKeysIn(content) {
    const found = new Set();
    for (const re of KEY_REGEXES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(content)) !== null) found.add(m[1]);
    }
    return [...found];
  }

  const result = { pageStatus: null, cookie: "", scriptsFetched: [], keysFound: [], error: null };

  try {
    const pageResp = await axios.get(embedPageUrl, {
      headers: {
        "User-Agent": fullUA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": refererBase,
        "sec-fetch-dest": "iframe",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "cross-site",
      },
      timeout: 15000,
    });
    result.pageStatus = pageResp.status;

    const setCookieArr = pageResp.headers["set-cookie"];
    if (setCookieArr) {
      result.cookie = (Array.isArray(setCookieArr) ? setCookieArr : [setCookieArr])
        .map((c) => c.split(";")[0]).join("; ");
    }

    const html = typeof pageResp.data === "string" ? pageResp.data : "";

    // 1. Search inline HTML (data-attributes, inline <script> blocks)
    result.keysFound.push(...findKeysIn(html));

    // 2. Cheerio: check data-key / data-_k attributes on any element
    const $ = cheerio.load(html);
    $("[data-key],[data-_k],[data-client-key]").each((_, el) => {
      const k = $(el).attr("data-key") || $(el).attr("data-_k") || $(el).attr("data-client-key") || "";
      if (/^[A-Za-z0-9]{20,}$/.test(k)) result.keysFound.push(k);
    });

    // 3. Fetch external player scripts and search them
    // Skip well-known third-party CDN scripts that won't contain MegaCloud's key
    const SKIP_HOSTS = ["jquery", "bootstrap", "fontawesome", "googleapis", "cloudflare",
                        "gtag", "analytics", "recaptcha", "sentry", "pusher"];
    const scriptSrcs = [];
    $("script[src]").each((_, el) => {
      const src = String($(el).attr("src") || "");
      if (!src || SKIP_HOSTS.some((s) => src.includes(s))) return;
      const full = src.startsWith("http")
        ? src
        : `https://${embedDomain}${src.startsWith("/") ? src : "/" + src}`;
      scriptSrcs.push(full);
    });

    const jsHeaders = {
      "User-Agent": fullUA,
      "Accept": "*/*",
      "Referer": embedPageUrl,
      "sec-fetch-dest": "script",
      "sec-fetch-mode": "no-cors",
      "sec-fetch-site": "same-origin",
    };
    for (const src of scriptSrcs) {
      try {
        const jsResp = await axios.get(src, { headers: jsHeaders, timeout: 12000 });
        const js = typeof jsResp.data === "string" ? jsResp.data : "";
        const jsKeys = findKeysIn(js);
        result.scriptsFetched.push({ url: src.substring(0, 100), size: js.length, keys: jsKeys.length });
        result.keysFound.push(...jsKeys);
      } catch (e) {
        result.scriptsFetched.push({ url: src.substring(0, 100), error: e.message });
      }
    }

    result.keysFound = [...new Set(result.keysFound)];
  } catch (e) {
    result.error = e.message;
    result.pageStatus = e.response?.status ?? "network_error";
  }

  return result;
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
  const pathParts = embedUrl.pathname.split("/").filter(Boolean);
  const sourceId = pathParts[pathParts.length - 1];
  if (!sourceId) throw new Error("Unable to extract MegaCloud source id from: " + link);

  const embedDomain = "megacloud.tv";
  const kParam = embedUrl.searchParams.get("k") || "1";
  const embedPageUrl = `https://${embedDomain}/embed-2/v3/e-1/${sourceId}?k=${kParam}`;
  const fullUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  // Scrape the live _k from MegaCloud's own embed page JS — primary strategy.
  // Hard cap at 4 s so slow JS fetches never block the watch pipeline.
  const scraped = await Promise.race([
    scrapeKeyFromEmbedPage(embedPageUrl, embedDomain, fullUA, `${siteBase}/`),
    new Promise((resolve) =>
      setTimeout(
        () => resolve({ keysFound: [], pageStatus: "timeout", cookie: "", scriptsFetched: [], error: "scrape timed out after 4 s" }),
        4000
      )
    ),
  ]);

  // Build candidate list: live scraped keys first, static fallbacks at the end
  const staticKeys = await getMegaCloudKeys();
  const staticCandidates = [staticKeys.rabbit, staticKeys.mega, staticKeys.vidstr].filter(Boolean);
  const keyCandidates = [...new Set([...scraped.keysFound, ...staticCandidates])];

  if (keyCandidates.length === 0) throw new Error("MegaCloud: no key candidates available (scrape + static both empty)");

  const commonHeaders = {
    "User-Agent": fullUA,
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    ...(scraped.cookie ? { Cookie: scraped.cookie } : {}),
  };

  const referers = [embedPageUrl, `${siteBase}/`, `https://${embedDomain}/`];

  let data = null;
  let lastError = "";

  outer:
  for (const referer of referers) {
    for (const key of keyCandidates) {
      try {
        const r = await axios.get(
          `https://${embedDomain}/embed-2/v3/e-1/getSources?id=${sourceId}&_k=${encodeURIComponent(key)}`,
          {
            headers: { ...commonHeaders, Referer: referer, Origin: `https://${embedDomain}` },
            timeout: 20000,
          }
        );
        const d = r.data;
        if (d && ((Array.isArray(d.sources) && d.sources.length > 0) || (d?.encrypted && typeof d?.sources === "string"))) {
          data = d;
          break outer;
        }
      } catch (e) {
        lastError = e.message;
      }
    }
  }

  if (!data) throw new Error(`MegaCloud getSources failed on all key/referer combos. Last error: ${lastError}`);

  if (!data.encrypted && Array.isArray(data.sources) && data.sources.length > 0) {
    return buildMegaCloudResult(data, embedUrl);
  }

  if (data.encrypted && typeof data.sources === "string") {
    const megacloudKey = String(data?.key || "").trim();
    for (const clientKey of keyCandidates) {
      try {
        const raw = decryptMegaCloudSources(data.sources, clientKey, megacloudKey);
        const decrypted = JSON.parse(raw);
        if (Array.isArray(decrypted) && decrypted.length > 0) {
          data.sources = decrypted;
          return buildMegaCloudResult(data, embedUrl);
        }
      } catch {}
    }
    throw new Error(`MegaCloud sources encrypted and all decryption attempts failed. megacloudKey=${megacloudKey ? "found" : "MISSING"}.`);
  }

  throw new Error(`MegaCloud returned no usable data. encrypted=${data?.encrypted}, sources type=${typeof data?.sources}.`);
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

  const fallbackServer =
    requestedServer.request === HiAnime.Servers.VidStreaming
      ? mapServer("vidcloud")
      : mapServer("vidstreaming");
  // T-Cloud (serverId 6) uses a different CDN — not MegaCloud.
  const tCloudServer = mapServer("t-cloud");
  const serversToTry = [requestedServer, fallbackServer];

  // PRIMARY: aniwatch library scraper. T-Cloud skipped (not a valid HiAnime.Servers value).
  for (const tryServer of serversToTry) {
    try {
      const direct = await scraper.getEpisodeSources(episodeId, tryServer.request, requestedCategory);
      const directSources = Array.isArray(direct?.sources) ? direct.sources : [];
      const directTracks = Array.isArray(direct?.subtitles)
        ? direct.subtitles
        : Array.isArray(direct?.tracks)
        ? direct.tracks
        : [];
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

  // SECONDARY: manual AJAX — includes T-Cloud + StreamTape as extra options.
  // T-Cloud (serverId 6) and StreamTape (serverId 3) do NOT use MegaCloud encryption.
  const streamTapeServer = mapServer("streamtape");
  const secondaryServers = [requestedServer, fallbackServer, tCloudServer, streamTapeServer];
  for (const tryServer of secondaryServers) {
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
      continue; // MegaCloud failed — skip embed fallback for this link
    }

    // Raw HLS stream from non-MegaCloud CDN.
    if (link.includes(".m3u8")) {
      return {
        headers: {},
        sources: [{ url: link, isM3U8: true, type: "hls", quality: tryServer.label }],
        subtitles: tracks,
        download: "",
      };
    }

    // Any other embed link (T-Cloud, StreamTape, etc.) — return as embed source.
    // GRABIX player renders embed sources in an iframe.
    if (link.startsWith("https://") || link.startsWith("http://") || link.startsWith("//")) {
      const fullLink = link.startsWith("//") ? "https:" + link : link;
      return {
        headers: { Referer: siteBase + "/" },
        sources: [{
          url: fullLink,
          isM3U8: false,
          type: "embed",
          isEmbed: true,
          quality: tryServer.label,
        }],
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


      // Steps 2.5 + 3: Scrape the live _k from MegaCloud's embed page JS, then call getSources.
      const link = String(linkData?.link || "");
      if (link.includes("megacloud")) {
        const embedUrl2 = new URL(link);
        const pathParts2 = embedUrl2.pathname.split("/").filter(Boolean);
        const sourceId = pathParts2[pathParts2.length - 1];
        const embedDomain = "megacloud.tv";
        const kParam2 = embedUrl2.searchParams.get("k") || "1";
        const embedPageUrl = `https://${embedDomain}/embed-2/v3/e-1/${sourceId}?k=${kParam2}`;
        const fullUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

        // Step 2.5: Scrape live key from embed page + its JS files (capped at 8 s for debug)
        const scraped = await Promise.race([
          scrapeKeyFromEmbedPage(embedPageUrl, embedDomain, fullUA, `${siteBase}/`),
          new Promise((resolve) =>
            setTimeout(
              () => resolve({ keysFound: [], pageStatus: "timeout", cookie: "", scriptsFetched: [], error: "debug scrape timed out after 8 s" }),
              8000
            )
          ),
        ]);
        debug.steps.step2_5_embed_preload = {
          url: embedPageUrl,
          page_status: scraped.pageStatus,
          cookies_captured: scraped.cookie ? scraped.cookie.substring(0, 200) : "NONE",
          scripts_fetched: scraped.scriptsFetched,
          keys_scraped: scraped.keysFound.map((k) => k.substring(0, 12) + "..."),
          keys_scraped_count: scraped.keysFound.length,
          error: scraped.error,
          verdict: scraped.keysFound.length > 0
            ? `✅ Found ${scraped.keysFound.length} key candidate(s) from embed page`
            : "⚠️ No keys found in embed page — will fall back to static keys",
        };

        // Step 3: try scraped keys first, then static fallbacks
        const staticKeys = await getMegaCloudKeys();
        const staticCandidates = [staticKeys.rabbit, staticKeys.mega, staticKeys.vidstr].filter(Boolean);
        const keyCandidates = [...new Set([...scraped.keysFound, ...staticCandidates])];
        const referers = [embedPageUrl, `${siteBase}/`, `https://${embedDomain}/`];

        const attempts = [];
        let mcData = null;
        let winningCombo = "";

        outerDebug:
        for (const referer of referers) {
          for (const key of keyCandidates) {
            const url = `https://${embedDomain}/embed-2/v3/e-1/getSources?id=${sourceId}&_k=${encodeURIComponent(key)}`;
            try {
              const r = await axios.get(url, {
                headers: {
                  "User-Agent": fullUA,
                  "X-Requested-With": "XMLHttpRequest",
                  "Accept": "application/json, text/plain, */*",
                  "Accept-Language": "en-US,en;q=0.9",
                  "Referer": referer,
                  "Origin": `https://${embedDomain}`,
                  "sec-fetch-dest": "empty",
                  "sec-fetch-mode": "cors",
                  "sec-fetch-site": "same-origin",
                  ...(scraped.cookie ? { Cookie: scraped.cookie } : {}),
                },
                timeout: 10000,
              });
              const d = r.data;
              if (d && ((Array.isArray(d.sources) && d.sources.length > 0) || (d?.encrypted && typeof d?.sources === "string"))) {
                mcData = d;
                winningCombo = `referer=${referer} key=${key.substring(0, 8)}... (${scraped.keysFound.includes(key) ? "SCRAPED" : "static"})`;
                break outerDebug;
              }
              attempts.push({ referer: referer.substring(0, 60), key: key.substring(0, 8) + "...", status: "ok_but_empty" });
            } catch (e) {
              const errBody = e.response?.data;
              attempts.push({
                referer: referer.substring(0, 60),
                key: key.substring(0, 8) + "...",
                key_source: scraped.keysFound.includes(key) ? "SCRAPED" : "static",
                http_status: e.response?.status,
                error: e.message,
                error_body: errBody
                  ? (typeof errBody === "string" ? errBody : JSON.stringify(errBody)).substring(0, 200)
                  : null,
              });
            }
          }
        }

        debug.steps.step3_megacloud_ajax = {
          ok: Boolean(mcData),
          sourceId,
          embedDomain,
          keys_tried: keyCandidates.length,
          keys_from_scrape: scraped.keysFound.length,
          keys_from_static: staticCandidates.length,
          winningCombo: winningCombo || "NONE — all failed",
          failed_attempts: attempts,
          encrypted: mcData?.encrypted,
          sources_type: typeof mcData?.sources,
          sources_count: Array.isArray(mcData?.sources) ? mcData.sources.length : "N/A",
          has_key_field: Boolean(mcData?.key),
          tracks_count: Array.isArray(mcData?.tracks) ? mcData.tracks.length : 0,
          verdict: !mcData
            ? "❌ All combinations failed — see failed_attempts[].error_body"
            : !mcData?.encrypted && Array.isArray(mcData?.sources) && mcData.sources.length > 0
            ? "✅ UNENCRYPTED — sources ready"
            : mcData?.encrypted && mcData?.key
            ? "⚠️ ENCRYPTED but server key present"
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

  // ── Gogoanime stream pipeline — search → info → episode sources ──────────
  // Used as primary fallback when HiAnime/MegaCloud is broken.
  // Gogoanime uses a different CDN (not MegaCloud) so it works independently.

  if (pathname === "/anime/gogoanime/stream") {
    const rawTitle = String(searchParams.get("title") || "").trim();
    const epNum = parseInt(searchParams.get("episode") || "1", 10);
    const dubbed = String(searchParams.get("dubbed") || "").toLowerCase() === "true";
    if (!rawTitle) return { status: 400, body: { detail: "title is required" } };

    const gogoanime = new ANIME.Gogoanime();

    // Step 1: search — try dubbed variant first if requested
    const searchQuery = dubbed ? `${rawTitle} (dub)` : rawTitle;
    let results = [];
    try {
      const sr = await gogoanime.search(searchQuery);
      results = Array.isArray(sr?.results) ? sr.results : [];
    } catch {}
    // Fallback: search plain title even if dubbed search failed
    if (!results.length && dubbed) {
      try {
        const sr2 = await gogoanime.search(rawTitle);
        results = Array.isArray(sr2?.results) ? sr2.results : [];
      } catch {}
    }
    if (!results.length) {
      throw new Error(`Gogoanime: no results for "${rawTitle}"`);
    }

    // Step 2: pick best match by title similarity
    function simpleScore(a, b) {
      a = a.toLowerCase().replace(/[^a-z0-9]/g, " ").trim();
      b = b.toLowerCase().replace(/[^a-z0-9]/g, " ").trim();
      if (a === b) return 100;
      const bWords = new Set(b.split(" ").filter(Boolean));
      const aWords = a.split(" ").filter(Boolean);
      const hits = aWords.filter(w => bWords.has(w)).length;
      return bWords.size ? (hits / bWords.size) * 100 : 0;
    }
    results.sort((a, b) => simpleScore(b.title || "", rawTitle) - simpleScore(a.title || "", rawTitle));
    const best = results[0];

    // Step 3: fetch episode list
    const info = await gogoanime.fetchAnimeInfo(best.id);
    const episodes = Array.isArray(info?.episodes) ? info.episodes : [];
    if (!episodes.length) throw new Error(`Gogoanime: no episodes for "${rawTitle}" (id=${best.id})`);

    // Match by episode number; fall back to index
    let ep = episodes.find(e => e.number === epNum);
    if (!ep) ep = episodes[Math.min(epNum - 1, episodes.length - 1)];
    if (!ep) throw new Error(`Gogoanime: episode ${epNum} not found`);

    // Step 4: fetch sources
    const sources = await gogoanime.fetchEpisodeSources(ep.id);
    return { status: 200, body: sources };
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
