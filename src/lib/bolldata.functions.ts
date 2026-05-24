import { createServerFn } from "@tanstack/react-start";

// Scrapes bolldata.se/en for Allsvenskan xG / xGA / xP per team.
// Uses the rendered HTML — bolldata serves a complete static table per round.

const URL = "https://bolldata.se/en";

export type BolldataRow = {
  name: string;
  played: number;
  xG: number;
  xGA: number;
  xDiff: number;
  xPts: number;
  pts?: number;
  luck?: number; // pts - xPts (filled when joined with main table)
};

function stripTags(s: string) {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeTeamName(s: string) {
  // Bolldata renders team names twice ("Sirius Sirius") — collapse to one.
  const half = s.length / 2;
  if (s.length > 4 && s.length % 2 === 1 && s[Math.floor(half)] === " ") {
    const a = s.slice(0, Math.floor(half));
    const b = s.slice(Math.floor(half) + 1);
    if (a === b) return a;
  }
  return s;
}

function parseTable(html: string, headerMarker: string): string[][] | null {
  const i = html.indexOf(headerMarker);
  if (i === -1) return null;
  const m = html.slice(i, i + 30000).match(/<table[^>]*>([\s\S]*?)<\/table>/);
  if (!m) return null;
  const rows = [...m[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
  return rows.map((r) =>
    [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) =>
      stripTags(c[1]),
    ),
  );
}

export async function fetchAllsvenskanAdvanced() {
    try {
      const res = await fetch(URL, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
          Accept: "text/html",
        },
      });
      if (!res.ok) return { rows: [] as BolldataRow[], source: URL };
      const html = await res.text();

      const xpTable = parseTable(html, "xP TABLE");
      const mainTable = parseTable(html, "ALLSVENSKAN");

      const rows: BolldataRow[] = [];
      if (xpTable && xpTable.length > 1) {
        for (const r of xpTable.slice(1)) {
          // Format: ['', 'Sirius Sirius', '', '7', '6', '1', '0', '15', '6', '+9', '19']
          if (r.length < 11) continue;
          const name = dedupeTeamName(r[1]);
          rows.push({
            name,
            played: Number(r[3]) || 0,
            xG: Number(r[7]) || 0,
            xGA: Number(r[8]) || 0,
            xDiff: Number(r[9].replace("+", "")) || 0,
            xPts: Number(r[10]) || 0,
          });
        }
      }

      // Join with main standings to compute luck (pts - xPts)
      if (mainTable && mainTable.length > 1) {
        const ptsByName = new Map<string, number>();
        for (const r of mainTable.slice(1)) {
          if (r.length < 11) continue;
          const name = dedupeTeamName(r[1]);
          ptsByName.set(name, Number(r[10]) || 0);
        }
        for (const row of rows) {
          const pts = ptsByName.get(row.name);
          if (pts != null) {
            row.pts = pts;
            row.luck = Math.round((pts - row.xPts) * 10) / 10;
          }
        }
      }

      return { rows, source: URL };
    } catch {
      return { rows: [] as BolldataRow[], source: URL };
    }
}

export const getAllsvenskanAdvanced = createServerFn({ method: "GET" }).handler(
  async () => fetchAllsvenskanAdvanced(),
);

// Loose name matcher — ESPN uses e.g. "Malmö FF", "Djurgårdens IF",
// "IF Elfsborg", "BK Häcken", "IF Brommapojkarna", "IFK Göteborg".
// Bolldata uses short forms ("Malmö FF", "Djurgården", "Elfsborg", "Häcken",
// "Brommapojkarna", "IFK Göteborg").
export function findBolldataRow(
  rows: BolldataRow[],
  espnName: string,
): BolldataRow | undefined {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\b(if|ifk|bk|fc|ff|aif|is|sk|fk|sc)\b/g, "")
      .replace(/[^a-z0-9åäö]/g, "")
      .trim();
  const target = norm(espnName);
  return rows.find((r) => {
    const n = norm(r.name);
    return n === target || n.includes(target) || target.includes(n);
  });
}
