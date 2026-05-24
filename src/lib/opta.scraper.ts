/**
 * Opta (Stats Perform) — Playwright-baserad datahämtare.
 * Akamai blockerar headless; vi sparar session-cookies efter första headed-körningen.
 *
 * Endast server-side / lokala scripts — inte Cloudflare Workers.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const OPTA_BASE = "https://optaplayerstats.statsperform.com";
const SOCCER_URL = `${OPTA_BASE}/en_GB/soccer`;
const SESSION_PATH = resolve(".opta/session.json");

export type OptaScorePair = {
  home: number;
  away: number;
};

export type OptaMatch = {
  id: string;
  status: string;
  date: number;
  leagueId: string;
  leagueName: string;
  leagueSeo: string;
  leagueLink: string;
  countryId: string;
  countryName: string;
  countryFullName: string;
  countryFlag: string;
  homeId: string;
  homeName: string;
  awayId: string;
  awayName: string;
  link: string;
  coverage: number | null;
  period: number | null;
  updated: number | null;
  /** Halvtidsresultat (score.ht). */
  scoreHt: OptaScorePair | null;
  /** Slutresultat (score.ft), null om matchen inte är avgjord. */
  scoreFt: OptaScorePair | null;
  /** Aktuell ställning (score.total) — live eller slut. */
  scoreTotal: OptaScorePair | null;
  /** Antal mål i events-listan (spelade/live med täckning). */
  goalCount: number | null;
};

export type OptaLiveScores = {
  fetchedAt: string;
  matches: OptaMatch[];
};

function mapScorePair(side: { home?: number; away?: number } | undefined): OptaScorePair | null {
  if (!side || side.home == null || side.away == null) return null;
  return { home: side.home, away: side.away };
}

/** Mappar ett rått livescores-matchobjekt från Opta API. */
export function mapOptaMatch(raw: Record<string, unknown>): OptaMatch {
  const comp = raw.comp as Record<string, unknown> | undefined;
  const country = comp?.country as Record<string, unknown> | undefined;
  const home = raw.home as Record<string, unknown> | undefined;
  const away = raw.away as Record<string, unknown> | undefined;
  const score = raw.score as Record<string, unknown> | undefined;
  const events = Array.isArray(raw.events) ? raw.events : [];
  const goalCount = events.filter(
    (e) =>
      (e as Record<string, unknown>).entity_type === "goal" ||
      (e as Record<string, unknown>).type === "G",
  ).length;

  const leagueLink = typeof comp?.link === "string" ? comp.link : "";
  const matchLink = typeof raw.link === "string" ? raw.link : "";

  return {
    id: String(raw.id ?? ""),
    status: String(raw.status ?? ""),
    date: Number(raw.date ?? 0),
    leagueId: String(comp?.id ?? ""),
    leagueName: String(comp?.name ?? ""),
    leagueSeo: String(comp?.nameSeo ?? ""),
    leagueLink: leagueLink ? `${OPTA_BASE}${leagueLink}` : "",
    countryId: String(country?.id ?? ""),
    countryName: String(country?.name ?? ""),
    countryFullName: String(country?.fullName ?? ""),
    countryFlag: String(country?.flag ?? ""),
    homeId: String(home?.id ?? ""),
    homeName: String(home?.name ?? ""),
    awayId: String(away?.id ?? ""),
    awayName: String(away?.name ?? ""),
    link: matchLink ? `${OPTA_BASE}${matchLink}` : "",
    coverage: raw.coverage != null ? Number(raw.coverage) : null,
    period: raw.period != null ? Number(raw.period) : null,
    updated: raw.updated != null ? Number(raw.updated) : null,
    scoreHt: mapScorePair(score?.ht as { home?: number; away?: number }),
    scoreFt: mapScorePair(score?.ft as { home?: number; away?: number }),
    scoreTotal: mapScorePair(score?.total as { home?: number; away?: number }),
    goalCount: events.length > 0 ? goalCount : null,
  };
}

async function waitPastBotCheck(page: Page, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await page.locator("body").innerText().catch(() => "");
    const denied = /access denied/i.test(text);
    const verify = page.url().includes("bm-verify") || /checking your browser/i.test(text);
    if (denied) throw new Error("Opta: Access Denied (Akamai). Kör OPTA_HEADED=1 en gång för att skapa session.");
    if (!verify && text.length > 300 && /live scores|premier league/i.test(text)) return;
    await page.waitForTimeout(1200);
  }
  throw new Error("Opta: timeout väntar på att sidan laddas förbi bot-skydd.");
}

async function createContext(browser: Browser, headed: boolean): Promise<BrowserContext> {
  mkdirSync(resolve(".opta"), { recursive: true });
  const hasSession = existsSync(SESSION_PATH);

  const context = await browser.newContext({
    locale: "en-GB",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 900 },
    ...(hasSession ? { storageState: SESSION_PATH } : {}),
  });

  if (!hasSession && !headed) {
    await context.close();
    throw new Error(
      "Ingen Opta-session sparad. Kör: npm run test:opta:headed — loggar in cookies i .opta/session.json",
    );
  }

  return context;
}

async function saveSession(context: BrowserContext) {
  await context.storageState({ path: SESSION_PATH });
}

/** Hämtar live/fixture-matcher via Optas interna API (kräver giltig browser-session). */
export async function fetchOptaLiveScores(options?: {
  headed?: boolean;
  offsetHours?: number;
}): Promise<OptaLiveScores> {
  const headed = options?.headed ?? true; // Akamai blockerar headless
  const offset = options?.offsetHours ?? -120;

  const browser = await chromium.launch({
    headless: !headed,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  let context: BrowserContext | null = null;
  try {
    context = await createContext(browser, headed);
    const page = await context.newPage();

    await page.goto(SOCCER_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitPastBotCheck(page);

    const apiUrl = `${OPTA_BASE}/api/en_GB/soccer/livescores?offset=${offset}`;
    const payload = await page.evaluate(async (url) => {
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error(`Opta API ${r.status}`);
      return r.json();
    }, apiUrl);

    await saveSession(context);

    const matches = (payload?.matches ?? []).map((m: Record<string, unknown>) => mapOptaMatch(m));
    return { fetchedAt: new Date().toISOString(), matches };
  } finally {
    await context?.close();
    await browser.close();
  }
}

/** Hämtar JSON från valfri Opta API-path (relativ eller absolut). */
export async function fetchOptaApi<T = unknown>(
  apiPath: string,
  options?: { headed?: boolean },
): Promise<T> {
  const headed = options?.headed ?? true; // Akamai blockerar headless
  const url = apiPath.startsWith("http") ? apiPath : `${OPTA_BASE}${apiPath.startsWith("/") ? "" : "/"}${apiPath}`;

  const browser = await chromium.launch({ headless: !headed });
  const context = await createContext(browser, headed);
  try {
    const page = await context.newPage();
    await page.goto(SOCCER_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitPastBotCheck(page);
    const data = await page.evaluate(async (u) => {
      const r = await fetch(u, { credentials: "include" });
      if (!r.ok) throw new Error(`Opta API ${r.status}`);
      return r.json();
    }, url);
    await saveSession(context);
    return data as T;
  } finally {
    await context.close();
    await browser.close();
  }
}

/** Normalisera lagnamn för matchning mot ESPN. */
export { findOptaMatch, formatOptaMatchSummary, normTeam } from "./opta.utils";
