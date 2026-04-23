/**
 * consumetProviders.ts — stub shim after Consumet/anime removal.
 *
 * Manga chapters, explore, and alt-title lookups now fall back to MangaDex /
 * Comick / other surviving providers. All functions here return empty results
 * gracefully so the UI doesn't crash — pages using these will simply show
 * "no results" for the Consumet-specific source option.
 */

import { BACKEND_API } from "./api";

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface ConsumetMediaSummary {
  id: string;
  title?: string;
  alt_title?: string;
  image?: string;
  provider?: string;
}

export interface ConsumetChapter {
  id: string;
  chapter_number?: string;
  title?: string;
  provider?: string;
}

export interface ConsumetMediaDetail extends ConsumetMediaSummary {
  description?: string;
  chapters?: ConsumetChapter[];
  pages?: string[];
}

export interface ConsumetNewsItem {
  id: string;
  title?: string;
  image?: string;
  topic?: string;
  url?: string;
  views?: number;
  uploadedAt?: string;
  topics?: string[];
}

export interface ConsumetNewsArticle extends ConsumetNewsItem {
  content?: string;
  intro?: string;
}

export type ConsumetDomain = "manga" | "light-novels" | "books" | "comics";

// ─── Manga helpers (backed by the GRABIX manga backend routes) ────────────────

export async function fetchConsumetMangaChapters(
  mangadexId: string,
  _provider = "mangadex",
): Promise<ConsumetChapter[]> {
  try {
    const res = await fetch(`${BACKEND_API}/manga/chapters/${encodeURIComponent(mangadexId)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.chapters ?? data.items ?? []) as ConsumetChapter[];
  } catch {
    return [];
  }
}

export async function fetchConsumetMangaRead(
  chapterId: string,
  _provider = "mangadex",
): Promise<string[]> {
  try {
    const res = await fetch(`${BACKEND_API}/manga/pages/${encodeURIComponent(chapterId)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.pages ?? data.images ?? []) as string[];
  } catch {
    return [];
  }
}

export async function searchConsumetManga(
  query: string,
): Promise<ConsumetMediaSummary[]> {
  try {
    const res = await fetch(
      `${BACKEND_API}/manga/search?q=${encodeURIComponent(query)}&source=anilist`,
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items ?? data.results ?? []) as ConsumetMediaSummary[];
  } catch {
    return [];
  }
}

// ─── Movie / TV alt-title lookup (non-critical — empty is fine) ───────────────

export async function fetchConsumetMetaSearch(
  _title: string,
  _type: string,
): Promise<ConsumetMediaSummary[]> {
  return [];
}

// ─── Explore page helpers (consumet sidecar gone — return empty) ──────────────

export async function fetchConsumetNews(
  _topic?: string,
): Promise<ConsumetNewsItem[]> {
  return [];
}

export async function fetchConsumetNewsArticle(
  _id: string,
): Promise<ConsumetNewsArticle> {
  return { id: _id };
}

export async function searchConsumetDomain(
  _domain: ConsumetDomain,
  _query: string,
  _provider?: string,
): Promise<ConsumetMediaSummary[]> {
  return [];
}

export async function fetchConsumetDomainInfo(
  _domain: ConsumetDomain,
  _id: string,
  _provider?: string,
): Promise<ConsumetMediaDetail> {
  return { id: _id };
}

export async function fetchConsumetGenericRead(
  _domain: ConsumetDomain,
  _id: string,
  _provider?: string,
): Promise<string[]> {
  return [];
}

export function toConsumetProxyUrl(url: string): string {
  return url;
}
