import type { OptaMatch } from "./opta.scraper";

export function normTeam(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function findOptaMatch(
  matches: OptaMatch[],
  homeName: string,
  awayName: string,
): OptaMatch | undefined {
  const h = normTeam(homeName);
  const a = normTeam(awayName);
  return matches.find((m) => {
    const mh = normTeam(m.homeName);
    const ma = normTeam(m.awayName);
    return (mh.includes(h) || h.includes(mh)) && (ma.includes(a) || a.includes(ma));
  });
}
