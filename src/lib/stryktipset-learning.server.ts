import { buildStryktipsetSystemInternal, type StryktipsetEvent } from "./stryktipset.functions";
import { updateModelPrompt } from "./model-prompts.server";

type DrawApiResponse = {
  draw?: {
    drawNumber: number;
    drawState?: string;
    regCloseTime?: string;
    drawEvents?: any[];
  };
};

type ResultApiResponse = {
  result?: {
    drawNumber?: number;
    currentNetSale?: string;
    distribution?: string;
    events?: Array<{
      eventNumber: number;
      outcome: "1" | "X" | "2";
      eventDescription?: string;
      outcomeScore?: { home?: number; away?: number };
    }>;
  };
};

function parsePct(raw: unknown) {
  const n = Number(String(raw ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function learnedLineFrequency(items: string[], limit = 6) {
  const map = new Map<string, number>();
  for (const item of items) {
    const text = item.trim();
    if (!text) continue;
    map.set(text, (map.get(text) ?? 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([text, count]) => (count > 1 ? `${text} (×${count})` : text));
}

async function fetchStryktipsetDraw(drawNumber: number): Promise<DrawApiResponse | null> {
  const res = await fetch(`https://api.spela.svenskaspel.se/draw/1/stryktipset/draws/${drawNumber}`, {
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Svenska Spel draw ${drawNumber}: ${res.status}`);
  return (await res.json()) as DrawApiResponse;
}

async function fetchStryktipsetResult(drawNumber: number): Promise<ResultApiResponse | null> {
  const res = await fetch(`https://api.spela.svenskaspel.se/draw/1/stryktipset/draws/${drawNumber}/result`, {
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Svenska Spel result ${drawNumber}: ${res.status}`);
  return (await res.json()) as ResultApiResponse;
}

function drawEventToInput(event: any): StryktipsetEvent {
  const match = event?.match ?? {};
  const home = match.participants?.find((p: any) => p.type === "home");
  const away = match.participants?.find((p: any) => p.type === "away");
  const values = Array.isArray(event?.betMetrics?.values) ? event.betMetrics.values : [];
  const byOutcome = new Map(values.map((item: any) => [item.outcome, item]));

  return {
    n: event.eventNumber,
    home: home?.name ?? "",
    away: away?.name ?? "",
    league: match.league?.name ?? "",
    odds: {
      one: event?.startOdds?.one ?? byOutcome.get("1")?.odds?.startOdds ?? undefined,
      x: event?.startOdds?.x ?? byOutcome.get("X")?.odds?.startOdds ?? undefined,
      two: event?.startOdds?.two ?? byOutcome.get("2")?.odds?.startOdds ?? undefined,
    },
    folket: {
      one: parsePct(event?.svenskaFolket?.one ?? byOutcome.get("1")?.distribution?.distribution),
      x: parsePct(event?.svenskaFolket?.x ?? byOutcome.get("X")?.distribution?.distribution),
      two: parsePct(event?.svenskaFolket?.two ?? byOutcome.get("2")?.distribution?.distribution),
    },
  };
}

async function findLatestHistoricalDrawNumber(startAt = 5100) {
  for (let drawNumber = startAt; drawNumber >= 4500; drawNumber--) {
    const draw = await fetchStryktipsetDraw(drawNumber);
    if (draw?.draw?.drawNumber) return drawNumber;
  }
  throw new Error("Kunde inte hitta senaste Stryktipset-omgången");
}

async function collectRecentFinalizedDraws(limit: number) {
  const latest = await findLatestHistoricalDrawNumber();
  const draws: Array<{
    drawNumber: number;
    regCloseTime: string | null;
    events: StryktipsetEvent[];
    resultEvents: ResultApiResponse["result"]["events"];
    netSale: string | null;
  }> = [];

  for (let drawNumber = latest; drawNumber >= 4500 && draws.length < limit; drawNumber--) {
    const [draw, result] = await Promise.all([
      fetchStryktipsetDraw(drawNumber),
      fetchStryktipsetResult(drawNumber),
    ]);
    if (!draw?.draw?.drawEvents?.length || !result?.result?.events?.length) continue;
    if ((draw.draw.drawState ?? "").toLowerCase() !== "finalized") continue;
    const events = draw.draw.drawEvents.map(drawEventToInput).filter((event) => event.home && event.away);
    if (events.length !== 13) continue;
    draws.push({
      drawNumber,
      regCloseTime: draw.draw.regCloseTime ?? null,
      events,
      resultEvents: result.result.events ?? [],
      netSale: result.result.currentNetSale ?? null,
    });
  }

  return draws;
}

function evaluateSystem(
  picks: Array<{ eventNumber: number; tecken: string; motivering: string }>,
  resultEvents: NonNullable<ResultApiResponse["result"]>["events"],
  events: StryktipsetEvent[],
) {
  const resultByEvent = new Map((resultEvents ?? []).map((event) => [event.eventNumber, event]));
  const eventByNumber = new Map(events.map((event) => [event.n, event]));
  let correct = 0;
  const misses: Array<{
    eventNumber: number;
    match: string;
    pick: string;
    actual: string;
    folketActual: number;
    folketPick: number;
    oddsActual: string | undefined;
    oddsPick: string | undefined;
  }> = [];

  for (const pick of picks) {
    const result = resultByEvent.get(pick.eventNumber);
    const event = eventByNumber.get(pick.eventNumber);
    if (!result || !event) continue;
    const actual = result.outcome;
    if (pick.tecken.includes(actual)) {
      correct++;
      continue;
    }
    const actualPct = actual === "1" ? event.folket.one : actual === "X" ? event.folket.x : event.folket.two;
    const pickSigns = pick.tecken.split("") as Array<"1" | "X" | "2">;
    const pickPct = Math.max(...pickSigns.map((sign) => (sign === "1" ? event.folket.one : sign === "X" ? event.folket.x : event.folket.two)));
    misses.push({
      eventNumber: pick.eventNumber,
      match: `${event.home} - ${event.away}`,
      pick: pick.tecken,
      actual,
      folketActual: actualPct,
      folketPick: pickPct,
      oddsActual: actual === "1" ? event.odds.one : actual === "X" ? event.odds.x : event.odds.two,
      oddsPick:
        pickSigns.length === 1
          ? pickSigns[0] === "1"
            ? event.odds.one
            : pickSigns[0] === "X"
              ? event.odds.x
              : event.odds.two
          : undefined,
    });
  }

  return { correct, total: picks.length, misses };
}

function fallbackStryktipsetPrompt(backtests: Array<{
  drawNumber: number;
  correct: number;
  misses: ReturnType<typeof evaluateSystem>["misses"];
}>) {
  const rules: string[] = [];
  for (const row of backtests) {
    for (const miss of row.misses) {
      if (miss.actual === "X") {
        rules.push("Undervärdera inte kryss när folket låser sig hårt på 1 eller 2.");
      }
      if (miss.folketActual > 0 && miss.folketActual <= 25) {
        rules.push("Respektera skrälltecken med låg folkprocent när oddsbilden inte avfärdar dem.");
      }
      if (miss.folketPick >= 55 && miss.folketActual < miss.folketPick / 2) {
        rules.push("Var mer skeptisk mot överstreckade favoriter och gardera tidigare.");
      }
      if (miss.actual !== "X" && miss.pick === "X") {
        rules.push("Spika inte kryss utan tydligt stöd i odds eller folkfördelning.");
      }
    }
  }

  return learnedLineFrequency(rules, 6)
    .map((rule) => `- ${rule}`)
    .join("\n");
}

export async function runStryktipsetLearningFromLatestDraws(drawCount = 20) {
  const apiKey = process.env.LOVABLE_API_KEY;
  const draws = await collectRecentFinalizedDraws(drawCount);
  const backtests: Array<{
    drawNumber: number;
    regCloseTime: string | null;
    correct: number;
    total: number;
    misses: ReturnType<typeof evaluateSystem>["misses"];
    strategy: string;
  }> = [];

  for (const draw of draws) {
    const system = await buildStryktipsetSystemInternal({
      events: draw.events,
      minPayout: 50000,
      minBudget: 500,
      targetBudget: 648,
      maxBudget: 750,
    });
    const evaluation = evaluateSystem(system.picks, draw.resultEvents ?? [], draw.events);
    backtests.push({
      drawNumber: draw.drawNumber,
      regCloseTime: draw.regCloseTime,
      correct: evaluation.correct,
      total: evaluation.total,
      misses: evaluation.misses,
      strategy: system.strategy,
    });
  }

  let promptText = fallbackStryktipsetPrompt(backtests);
  if (apiKey) {
    const system = `Du tränar en Stryktipset-modell från historiska kuponger. Du får 20 senaste backtester där modellen byggde ett helt system före facit.
Skriv en kort svensk träningsprompt (max 1500 tecken) med konkreta regler i imperativ.
Fokusera på:
- överstreckade favoriter
- skrälltecken/värdetecken mot folket
- krysshantering
- när gardering ska upp tidigare
- balans mellan säkra tecken och skrällar.
Ingen inledning. Bara regler.`;

    const user = JSON.stringify(
      {
        drawCount: backtests.length,
        sample: backtests.map((row) => ({
          drawNumber: row.drawNumber,
          date: row.regCloseTime,
          correct: row.correct,
          total: row.total,
          strategy: row.strategy,
          misses: row.misses.slice(0, 5),
        })),
      },
      null,
      2,
    );

    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (res.ok) {
        const json: any = await res.json();
        const candidate = String(json?.choices?.[0]?.message?.content ?? "").trim();
        if (candidate) promptText = candidate;
      }
    } catch {
      // fallback prompt already set
    }
  }

  await updateModelPrompt({
    scope: "stryktipset",
    promptText,
    lastSampleCount: backtests.length,
  });

  return {
    scope: "stryktipset",
    drawCount: backtests.length,
    promptText,
    averageCorrect:
      backtests.length > 0
        ? Math.round((backtests.reduce((sum, row) => sum + row.correct, 0) / backtests.length) * 100) / 100
        : 0,
    sample: backtests.slice(0, 5),
  };
}

