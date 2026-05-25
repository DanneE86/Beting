// Transfermarkt injury scraper. Free and stable enough as a server-side fetch.
// The URL is slug-agnostic: /x/sperrenundverletzungen/verein/{id}

const TM_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

const TM_SEARCH_CACHE = new Map<string, number | null>();

// Mapping from normalized team name (ESPN displayName) → Transfermarkt club id.
// Premier League 2025/26 squads + a few common Allsvenskan clubs.
const TM_IDS: Record<string, number> = {
  // Premier League
  arsenal: 11,
  "aston villa": 405,
  bournemouth: 989,
  "afc bournemouth": 989,
  brentford: 1148,
  brighton: 1237,
  "brighton hove albion": 1237,
  "brighton & hove albion": 1237,
  burnley: 1132,
  chelsea: 631,
  "crystal palace": 873,
  everton: 29,
  fulham: 931,
  ipswich: 677,
  "ipswich town": 677,
  leeds: 399,
  "leeds united": 399,
  leicester: 1003,
  "leicester city": 1003,
  liverpool: 31,
  "manchester city": 281,
  "man city": 281,
  "manchester united": 985,
  "man united": 985,
  newcastle: 762,
  "newcastle united": 762,
  "nottingham forest": 703,
  southampton: 180,
  sunderland: 289,
  tottenham: 148,
  "tottenham hotspur": 148,
  spurs: 148,
  "west ham": 379,
  "west ham united": 379,
  wolves: 543,
  "wolverhampton wanderers": 543,
  // Allsvenskan (most common — best effort)
  aik: 165,
  "aik stockholm": 165,
  djurgården: 1849,
  djurgardens: 1849,
  "djurgårdens if": 1849,
  hammarby: 2528,
  "hammarby if": 2528,
  malmö: 1010,
  "malmö ff": 1010,
  malmo: 1010,
  "ifk göteborg": 991,
  "ifk goteborg": 991,
  göteborg: 991,
  goteborg: 991,
  "ifk norrköping": 1003 + 0, // not mapped
  häcken: 6552,
  "bk häcken": 6552,
  hacken: 6552,
  elfsborg: 989 + 0, // skip if unsure
  "if elfsborg": 1240,
  mjällby: 4708,
  "mjällby aif": 4708,
  mjallby: 4708,
  "gais": 1146,
  "halmstads bk": 426,
  halmstad: 426,
  "ifk värnamo": 25446,
  värnamo: 25446,
  varnamo: 25446,
  brommapojkarna: 4929,
  "ik sirius": 6826,
  sirius: 6826,
  "degerfors if": 6797,
  degerfors: 6797,
  "östers if": 1147,
  öster: 1147,
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bfc\b|\bif\b|\bbk\b|\bsk\b|\bcf\b/g, "")
    .replace(/\bunited\b/g, "utd")
    .replace(/\bfootball club\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

export function transfermarktIdFor(name: string): number | undefined {
  const k = norm(name);
  return TM_IDS[k] ?? TM_IDS[k.replace(/\s+/g, "")];
}

function decodeHtml(text: string) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x2F;/g, "/")
    .replace(/&#x27;/g, "'")
    .replace(/&ouml;/g, "o")
    .replace(/&auml;/g, "a")
    .replace(/&uuml;/g, "u")
    .replace(/&aring;/g, "a")
    .replace(/&oslash;/g, "o");
}

export type TransfermarktClubCandidate = {
  id: number;
  name: string;
  href: string;
};

export function extractTransfermarktClubCandidates(html: string): TransfermarktClubCandidate[] {
  const candidates = new Map<number, TransfermarktClubCandidate>();
  const patterns = [
    /<a[^>]+href="([^"]*\/startseite\/verein\/(\d+)[^"]*)"[^>]*title="([^"]+)"[^>]*>/gi,
    /<a[^>]+href="([^"]*\/startseite\/verein\/(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
  ];

  for (const re of patterns) {
    for (const match of html.matchAll(re)) {
      const id = Number(match[2]);
      if (!Number.isFinite(id)) continue;
      const rawName = decodeHtml(String(match[3] ?? ""))
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!rawName) continue;
      candidates.set(id, {
        id,
        name: rawName,
        href: String(match[1] ?? ""),
      });
    }
  }

  return [...candidates.values()];
}

function scoreClubCandidate(teamName: string, candidateName: string) {
  const a = norm(teamName);
  const b = norm(candidateName);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.replace(/\s+/g, "") === b.replace(/\s+/g, "")) return 96;
  if (a.includes(b) || b.includes(a)) return 88;

  const aTokens = new Set(a.split(" ").filter(Boolean));
  const bTokens = new Set(b.split(" ").filter(Boolean));
  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap++;
  }
  if (!overlap) return 0;
  return 60 + overlap * 10 - Math.abs(aTokens.size - bTokens.size) * 4;
}

export function pickBestTransfermarktClubId(
  teamName: string,
  candidates: TransfermarktClubCandidate[],
): number | undefined {
  const scored = candidates
    .map((candidate) => ({
      id: candidate.id,
      score: scoreClubCandidate(teamName, candidate.name),
    }))
    .sort((a, b) => b.score - a.score);

  return scored[0]?.score >= 72 ? scored[0].id : undefined;
}

async function searchTransfermarktClubId(teamName: string): Promise<number | undefined> {
  const key = norm(teamName);
  if (!key) return undefined;
  if (TM_SEARCH_CACHE.has(key)) {
    return TM_SEARCH_CACHE.get(key) ?? undefined;
  }

  try {
    const res = await fetch(
      `https://www.transfermarkt.com/schnellsuche/ergebnis/schnellsuche?query=${encodeURIComponent(teamName)}`,
      {
        headers: TM_HEADERS,
      },
    );
    if (!res.ok) {
      TM_SEARCH_CACHE.set(key, null);
      return undefined;
    }
    const html = await res.text();
    const candidates = extractTransfermarktClubCandidates(html);
    const id = pickBestTransfermarktClubId(teamName, candidates);
    TM_SEARCH_CACHE.set(key, id ?? null);
    return id;
  } catch {
    TM_SEARCH_CACHE.set(key, null);
    return undefined;
  }
}

export type Injury = {
  name: string;
  reason: string;
  since?: string;
  until?: string;
  missedMatches?: number;
};

export async function getTransfermarktInjuries(
  teamName: string,
): Promise<{ source: string; injuries: Injury[] }> {
  const tmId = transfermarktIdFor(teamName) ?? (await searchTransfermarktClubId(teamName));
  if (!tmId) return { source: "transfermarkt:unmapped", injuries: [] };
  try {
    const res = await fetch(
      `https://www.transfermarkt.com/x/sperrenundverletzungen/verein/${tmId}`,
      {
        headers: TM_HEADERS,
      },
    );
    if (!res.ok) return { source: `transfermarkt:${res.status}`, injuries: [] };
    const html = await res.text();
    const injuries: Injury[] = [];
    // Split into player rows by the parent <tr class="odd|even"> markers.
    // Cannot use a non-greedy </tr> match because each row contains a nested
    // <table class="inline-table"> with its own <tr>...</tr> pairs.
    const rowStarts = [...html.matchAll(/<tr class="(?:odd|even)">/g)].map(
      (m) => m.index ?? 0,
    );
    const rows = rowStarts.map((start, i) =>
      html.slice(start, rowStarts[i + 1] ?? start + 6000),
    );
    for (const row of rows) {
      const nameMatch = row.match(
        /<a title="([^"]+)" href="\/[^"]+\/profil\/spieler\/\d+">/,
      );
      if (!nameMatch) continue;
      // Strip the inline-table (player image/name/position block) so the
      // remaining <td> cells are: age, reason, since, until, missedMatches.
      const stripped = row.replace(
        /<table class="inline-table">[\s\S]*?<\/table>/g,
        "",
      );
      const cells = [...stripped.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(
        (c) => c[1].replace(/<[^>]+>/g, "").trim(),
      );
      if (cells.length < 5) continue;
      // The player column becomes an empty <td> after stripping inline-table.
      // Drop only the leading empties; keep mid-empty cells (e.g. unknown until).
      const c = [...cells];
      while (c.length && c[0] === "") c.shift();
      if (c.length < 5) continue;
      const reason = c[1];
      const since = c[2];
      const until = c[3];
      const missed = Number(c[4].replace(/[^\d]/g, ""));
      injuries.push({
        name: nameMatch[1].trim(),
        reason,
        since,
        until,
        missedMatches: Number.isFinite(missed) ? missed : undefined,
      });
    }
    return { source: "transfermarkt", injuries };
  } catch {
    return { source: "transfermarkt:error", injuries: [] };
  }
}
