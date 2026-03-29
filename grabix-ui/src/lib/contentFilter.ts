const ADULT_TOKENS = ["hentai", "adult", "ecchi", "18+", "rx", "rx-17+"];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function stringLooksAdult(value: string): boolean {
  const normalized = normalize(value);
  return ADULT_TOKENS.some((token) => normalized.includes(token));
}

export function isAdultContentItem(item: unknown): boolean {
  if (!item || typeof item !== "object") return false;

  const values: string[] = [];
  const push = (value: unknown) => {
    if (!value) return;
    if (typeof value === "string") {
      values.push(value);
      return;
    }
    if (typeof value === "number") {
      values.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    if (typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach(push);
    }
  };

  const typed = item as Record<string, unknown>;
  push(typed.title);
  push(typed.name);
  push(typed.description);
  push(typed.synopsis);
  push(typed.rating);
  push(typed.status);
  push(typed.genres);
  push(typed.genre_names);
  push(typed.tags);
  push(typed.tag_names);
  push(typed.content_rating);
  push(typed.age_rating);

  return values.some(stringLooksAdult);
}

export function filterAdultContent<T>(items: T[], adultContentBlocked: boolean): T[] {
  if (!adultContentBlocked) return items;
  return items.filter((item) => !isAdultContentItem(item));
}
