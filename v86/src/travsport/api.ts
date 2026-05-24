const TRAVSPORT_API = "https://api.travsport.se/webapi";

export async function fetchHorseResultsRaw(horseId: number): Promise<unknown[]> {
  const url =
    `${TRAVSPORT_API}/horses/results/organisation/TROT/sourceofdata/SPORT/horseid/${horseId}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`Travsport ${res.status} häst ${horseId}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function searchHorseByName(name: string): Promise<{ horseId: number; name: string } | null> {
  const q = encodeURIComponent(name.trim());
  const url =
    `${TRAVSPORT_API}/horses/search/organisation/TROT?horseName=${q}&age=0&gender=BOTH&trotBreed=ALL&autoSuffixWildcard=true`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const data = (await res.json()) as { horseId?: number; name?: string }[];
  const hit = data?.[0];
  if (!hit?.horseId) return null;
  return { horseId: hit.horseId, name: hit.name ?? name };
}
