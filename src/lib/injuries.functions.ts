// Transfermarkt injury scraper. Free and stable enough as a server-side fetch.
// The URL is slug-agnostic: /x/sperrenundverletzungen/verein/{id}

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
    .replace(/\bfc\b|\bif\b|\bbk\b|\bsk\b|\bcf\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

export function transfermarktIdFor(name: string): number | undefined {
  const k = norm(name);
  return TM_IDS[k] ?? TM_IDS[k.replace(/\s+/g, "")];
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
  const tmId = transfermarktIdFor(teamName);
  if (!tmId) return { source: "transfermarkt:unmapped", injuries: [] };
  try {
    const res = await fetch(
      `https://www.transfermarkt.com/x/sperrenundverletzungen/verein/${tmId}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9",
        },
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
