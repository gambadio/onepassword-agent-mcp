export function normalizeSite(input: string): URL | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed);
  } catch {
    try {
      return new URL(`https://${trimmed}`);
    } catch {
      return null;
    }
  }
}

export function normalizePattern(pattern: string): string {
  return pattern.trim().toLowerCase().replace(/\/+$/, "");
}

export function siteMatches(allowedPatterns: string[], site: string): boolean {
  if (!allowedPatterns.length) return true;
  const target = normalizeSite(site);
  if (!target) return false;
  const targetHost = target.hostname.toLowerCase();
  const targetHref = target.href.toLowerCase().replace(/\/+$/, "");

  return allowedPatterns.some((rawPattern) => {
    const pattern = normalizePattern(rawPattern);
    if (!pattern) return false;
    if (pattern === "*") return true;

    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1);
      return targetHost.endsWith(suffix) && targetHost !== suffix.slice(1);
    }

    const patternUrl = normalizeSite(pattern);
    if (!patternUrl) return false;
    const patternHost = patternUrl.hostname.toLowerCase();
    const patternHref = patternUrl.href.toLowerCase().replace(/\/+$/, "");

    if (pattern.includes("/")) {
      return targetHref.startsWith(patternHref);
    }
    return targetHost === patternHost || targetHost.endsWith(`.${patternHost}`);
  });
}

export function formatSites(sites: string[]): string[] {
  return Array.from(
    new Set(
      sites
        .map((site) => site.trim())
        .filter(Boolean)
        .map((site) => {
          const parsed = normalizeSite(site);
          return parsed ? parsed.hostname : site;
        }),
    ),
  );
}
