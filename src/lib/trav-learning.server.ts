import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database, Json } from "@/integrations/supabase/types";
import { hybridTravsportCache } from "./travsport-cache-backend";
import { fetchCalendarDay, fetchGame, listAllowedGamesFromCalendar } from "../../v86/src/atg-api";
import {
  buildSnapshotFromGame,
  sanitizeHistoricalGameForPrematch,
} from "../../v86/src/pipeline";
import type {
  AtgGame,
  AtgRace,
  AtgStart,
  FetchSnapshot,
  PoolGameType,
} from "../../v86/src/types";

const TRAV_MODEL_VERSION = 1;

export type TravResolvedLeg = {
  leg: number;
  raceId: string;
  raceName?: string;
  winners: number[];
  reserveOrder: number[];
  victoryMargin?: string | null;
  topFinishers: Array<{
    number: number;
    name: string;
    finishOrder: number | null;
    place: number | null;
    kmTime: string | null;
    finalOdds: number | null;
    postPosition: number | null;
    startNumber: number | null;
  }>;
};

export type TravSystemHitSummary = {
  totalLegs: number;
  correctLegs: number;
  fullHit: boolean;
  payoutTierHit: string | null;
  payoutAmountKr: number | null;
  hitLegs: number[];
  missLegs: Array<{
    leg: number;
    picks: number[];
    winners: number[];
    reserveOrder: number[];
  }>;
};

export type TravPostmortem = {
  verdict: "träff" | "delvis" | "miss";
  summary: string;
  why: string[];
  paceNotes: string;
  lessons: string[];
  modelMistakes?: string[];
  signalsMissed?: string[];
  alternativeActions?: string[];
  generated_at: string;
  model: string;
};

function formatMoney(amount: number | null | undefined) {
  if (amount == null) return "okänd utdelning";
  return `${Math.round(amount).toLocaleString("sv-SE")} kr`;
}

function kmTimeToString(km?: { minutes?: number; seconds?: number; tenths?: number } | null) {
  if (!km) return null;
  const min = km.minutes ?? 0;
  const sec = km.seconds ?? 0;
  const tenth = km.tenths ?? 0;
  return `${min > 0 ? `${min}:` : ""}${sec},${tenth}`;
}

function numbersFromPoolWinners(winners: unknown): number[] {
  if (Array.isArray(winners) && winners.every((item) => typeof item === "number")) {
    return winners as number[];
  }
  if (Array.isArray(winners)) {
    return winners
      .flatMap((item) =>
        typeof item === "object" && item && "combination" in item
          ? (((item as { combination?: number[] }).combination ?? []).filter((n) => typeof n === "number") as number[])
          : [],
      )
      .filter((n, idx, arr) => arr.indexOf(n) === idx);
  }
  return [];
}

function gameDateOf(snapshot: FetchSnapshot) {
  return snapshot.game.races[0]?.startTime ?? snapshot.game.races[0]?.scheduledStartTime ?? null;
}

function extractLegResult(race: AtgRace, gameType: PoolGameType, leg: number): TravResolvedLeg {
  const racePool = race.pools?.[gameType];
  const winners = numbersFromPoolWinners(racePool?.result?.winners);
  const reserveOrder = Array.isArray(racePool?.result?.reserveOrder) ? racePool?.result?.reserveOrder ?? [] : [];
  const topFinishers = [...(race.starts ?? [])]
    .map((start: AtgStart) => ({
      number: start.number,
      name: start.horse?.name ?? `nr ${start.number}`,
      finishOrder: start.result?.finishOrder ?? null,
      place: start.result?.place ?? null,
      kmTime: kmTimeToString(start.result?.kmTime ?? null),
      finalOdds: start.result?.finalOdds ?? null,
      postPosition: start.postPosition ?? null,
      startNumber: start.result?.startNumber ?? null,
    }))
    .sort((a, b) => (a.finishOrder ?? 999) - (b.finishOrder ?? 999))
    .slice(0, 6);

  return {
    leg,
    raceId: race.id,
    raceName: race.name,
    winners,
    reserveOrder,
    victoryMargin: race.result?.victoryMargin ?? null,
    topFinishers,
  };
}

function extractPayoutSummary(game: AtgGame) {
  const pool = game.pools?.[game.type];
  return {
    turnover: pool?.turnover ?? null,
    systemCount: pool?.systemCount ?? null,
    jackpotAmount: pool?.jackpotAmount ?? null,
    resultPayouts: pool?.result?.payouts ?? null,
    distributionPayouts: pool?.payouts ?? null,
  };
}

export function extractTravResult(game: AtgGame) {
  return {
    gameId: game.id,
    gameType: game.type,
    gameStatus: game.status,
    payouts: extractPayoutSummary(game),
    legs: game.races.map((race, index) => extractLegResult(race, game.type, index + 1)),
  };
}

export function buildSystemHitSummary(
  system: FetchSnapshot["system"],
  resolved: ReturnType<typeof extractTravResult>,
): TravSystemHitSummary {
  const missLegs: TravSystemHitSummary["missLegs"] = [];
  const hitLegs: number[] = [];

  for (const selection of system.selections) {
    const leg = resolved.legs.find((item) => item.leg === selection.leg);
    if (!leg) continue;
    const isHit = leg.winners.some((winner) => selection.picks.includes(winner));
    if (isHit) hitLegs.push(selection.leg);
    else {
      missLegs.push({
        leg: selection.leg,
        picks: selection.picks,
        winners: leg.winners,
        reserveOrder: leg.reserveOrder,
      });
    }
  }

  const correctLegs = hitLegs.length;
  const payoutTierHit =
    resolved.payouts.resultPayouts && resolved.payouts.resultPayouts[String(correctLegs)]
      ? String(correctLegs)
      : null;
  const payoutAmountKr =
    payoutTierHit != null
      ? resolved.payouts.resultPayouts?.[payoutTierHit]?.payout != null
        ? resolved.payouts.resultPayouts[payoutTierHit]!.payout ?? null
        : null
      : null;

  return {
    totalLegs: system.selections.length,
    correctLegs,
    fullHit: correctLegs === system.selections.length,
    payoutTierHit,
    payoutAmountKr,
    hitLegs,
    missLegs,
  };
}

function findHorse(snapshot: FetchSnapshot, legNumber: number, number: number) {
  return snapshot.legs
    .find((leg) => leg.leg === legNumber)
    ?.horses.find((horse) => horse.number === number);
}

function checklistSignal(
  item:
    | { label?: string; score?: number; note?: string; available?: boolean }
    | undefined,
  positiveThreshold = 0.7,
): string | null {
  if (!item?.available || item.score == null) return null;
  if (item.score < positiveThreshold) return null;
  return `${item.label}: ${item.note}`;
}

function checklistWeakness(
  item:
    | { label?: string; score?: number; note?: string; available?: boolean }
    | undefined,
  negativeThreshold = 0.46,
): string | null {
  if (!item?.available || item.score == null) return null;
  if (item.score > negativeThreshold) return null;
  return `${item.label}: ${item.note}`;
}

function summarizeWinnerSignals(
  horse:
    | (FetchSnapshot["legs"][number]["horses"][number] & {
        estimatedWinPct?: number;
        valueEdgePct?: number;
      })
    | undefined,
) {
  if (!horse) return [];
  const horseById = new Map(horse.horseChecklist.map((item) => [item.id, item]));
  const driverById = new Map(horse.driverChecklist.map((item) => [item.id, item]));

  const signals = [
    (horse.valueEdgePct ?? 0) >= 5
      ? `Modellen hade ${horse.number} ${horse.name} högre än strecken (+${horse.valueEdgePct!.toFixed(1)}%).`
      : null,
    horse.formTrend === "stigande" ? `${horse.name} kom med stigande form.` : null,
    checklistSignal(horseById.get("lane_start")),
    checklistSignal(horseById.get("track")),
    checklistSignal(horseById.get("class")),
    checklistSignal(horseById.get("speed")),
    checklistSignal(driverById.get("driver_form")),
    checklistSignal(driverById.get("horse_pair")),
    checklistSignal(driverById.get("favorite_delivery")),
    checklistSignal(driverById.get("trainer_pair")),
    ...(horse.highlights ?? []).slice(0, 2),
  ].filter(Boolean) as string[];

  return signals.filter((text, index, arr) => arr.indexOf(text) === index).slice(0, 5);
}

function summarizeSelectedWeaknesses(
  picks: number[],
  snapshot: FetchSnapshot,
  legNumber: number,
) {
  const weaknesses: string[] = [];
  for (const pick of picks) {
    const horse = findHorse(snapshot, legNumber, pick);
    if (!horse) continue;
    const horseById = new Map(horse.horseChecklist.map((item) => [item.id, item]));
    const driverById = new Map(horse.driverChecklist.map((item) => [item.id, item]));
    if (horse.formTrend === "nedåtgående") {
      weaknesses.push(`${horse.number} ${horse.name} kom med nedåtgående form.`);
    }
    weaknesses.push(
      ...[
        checklistWeakness(horseById.get("lane_start")),
        checklistWeakness(horseById.get("track")),
        checklistWeakness(horseById.get("rest")),
        checklistWeakness(driverById.get("horse_pair")),
        checklistWeakness(driverById.get("favorite_delivery")),
      ].filter(Boolean) as string[],
    );
  }
  return weaknesses.filter((text, index, arr) => arr.indexOf(text) === index).slice(0, 4);
}

function inferLegPaceHint(
  leg: TravResolvedLeg,
  winner:
    | (FetchSnapshot["legs"][number]["horses"][number] & {
        estimatedWinPct?: number;
        valueEdgePct?: number;
      })
    | undefined,
  favorite:
    | FetchSnapshot["legs"][number]["horses"][number]
    | undefined,
) {
  const top = leg.topFinishers[0];
  const winnerPost = top?.postPosition ?? winner?.number ?? null;
  const winnerOdds = top?.finalOdds ?? null;
  const favoriteMissed = Boolean(favorite && !leg.winners.includes(favorite.number));

  if (winnerPost != null && winnerPost >= 8 && favoriteMissed) {
    return "Loppbilden kan ha blivit hårdare än väntat; vinnaren kom från ett sämre läge samtidigt som mer betrodda hästar föll.";
  }
  if (winnerPost != null && winnerPost <= 3 && (winnerOdds ?? 0) > 0 && (winnerOdds ?? 0) <= 5) {
    return "Loppet ser mer positionsstyrt ut, där tidigt bra läge och kontroll i främre träffen blev avgörande.";
  }
  if (winnerPost != null && winnerPost >= 8) {
    return "Bakspår eller yttre läge övervanns, vilket tyder på att tempo eller löpningsförlopp neutraliserade spårnackdelen.";
  }
  if (leg.victoryMargin) {
    return `Segermarginalen (${leg.victoryMargin}) antyder att vinnaren fick loppet dit den ville, men tempot går inte att slå fast säkert.`;
  }
  return "Tempo eller loppbild går inte att avgöra säkert från resultatdatan ensam.";
}

function buildMissLegNarrative(
  snapshot: FetchSnapshot,
  miss: TravSystemHitSummary["missLegs"][number],
  resolvedLeg: TravResolvedLeg | undefined,
) {
  const leg = snapshot.legs.find((item) => item.leg === miss.leg);
  const winner = miss.winners[0] != null ? findHorse(snapshot, miss.leg, miss.winners[0]) : undefined;
  const favorite = leg?.favorite;
  const winnerSignals = summarizeWinnerSignals(winner);
  const selectedWeaknesses = summarizeSelectedWeaknesses(miss.picks, snapshot, miss.leg);
  return {
    winnerSignals,
    selectedWeaknesses,
    paceHint:
      resolvedLeg && winner
        ? inferLegPaceHint(resolvedLeg, winner, favorite)
        : "Tempo eller loppbild går inte att avgöra säkert från resultatdatan ensam.",
  };
}

export function buildFallbackTravPostmortem(
  snapshot: FetchSnapshot,
  resolved: ReturnType<typeof extractTravResult>,
  hitSummary: TravSystemHitSummary,
): TravPostmortem {
  const missNarratives = hitSummary.missLegs.map((miss) => {
    const resolvedLeg = resolved.legs.find((leg) => leg.leg === miss.leg);
    return {
      miss,
      resolvedLeg,
      ...buildMissLegNarrative(snapshot, miss, resolvedLeg),
    };
  });
  const missedWinnerNotes = missNarratives
    .map((entry) =>
      entry.winnerSignals[0]
        ? `Avd ${entry.miss.leg}: ${entry.winnerSignals[0]}`
        : `Avd ${entry.miss.leg}: vinnaren fångades inte av systemet trots bättre signaler än valda hästar.`,
    )
    .filter(Boolean);
  const paceNotes = topByFrequency(
    missNarratives
      .map((entry) => `Avd ${entry.miss.leg}: ${entry.paceHint}`)
      .filter(Boolean),
    3,
  );
  const selectedWeaknessNotes = missNarratives.flatMap((entry) =>
    entry.selectedWeaknesses.map((text) => `Avd ${entry.miss.leg}: ${text}`),
  );

  const why = [
    `Systemet satte ${hitSummary.correctLegs} av ${hitSummary.totalLegs} avdelningar.`,
    hitSummary.payoutTierHit
      ? `Det räckte till ${hitSummary.payoutTierHit} rätt med utdelning ${formatMoney(hitSummary.payoutAmountKr)}.`
      : "Systemet nådde ingen betald nivå enligt aktuell utdelning.",
    missedWinnerNotes[0] ?? "De avgörande missarna kom i lopp där vinnaren hade bättre edge eller annan löpningsprofil än systemet fångade.",
    paceNotes[0] ?? "Tempo eller loppbild gick inte att avgöra helt säkert från resultatdatan.",
  ];

  const lessons = [
    missedWinnerNotes[0] ??
      "Väg vinnare med positiv edge mot strecken tyngre när modellen samtidigt ger hög kombinerad score.",
    hitSummary.missLegs.some((miss) => {
      const winner = miss.winners[0] != null ? findHorse(snapshot, miss.leg, miss.winners[0]) : null;
      const lane = winner?.horseChecklist.find((item) => item.id === "lane_start");
      return Boolean(lane?.available && lane.score >= 0.72);
    })
      ? "Stark spårhistorik i samma startmetod ska väga tyngre i öppna lopp."
      : "Fortsätt låta spårhistorik, formtrend och Travsport-rad styra före rena streckprocenter i jämna lopp.",
    selectedWeaknessNotes[0] ??
      "När valda hästar har svaga checklistesignaler i spår, vila eller kusk/häst-historik ska garderingsbehovet höjas.",
    "Om tempo eller loppbild inte går att läsa ur ATG-datan ska modellen uttryckligen markera osäkerhet i efteranalysen.",
  ].filter(Boolean);

  return {
    verdict: hitSummary.fullHit ? "träff" : hitSummary.correctLegs >= Math.max(1, hitSummary.totalLegs - 2) ? "delvis" : "miss",
    summary: `Systemet slutade på ${hitSummary.correctLegs}/${hitSummary.totalLegs} rätt${hitSummary.payoutTierHit ? ` och gav ${formatMoney(hitSummary.payoutAmountKr)}` : ""}.`,
    why,
    paceNotes: paceNotes.join(" "),
    lessons,
    modelMistakes: missedWinnerNotes.slice(0, 3),
    signalsMissed: topByFrequency(
      [
        ...missNarratives.flatMap((entry) =>
          entry.winnerSignals.map((text) => `Avd ${entry.miss.leg}: ${text}`),
        ),
        ...selectedWeaknessNotes,
      ],
      6,
    ),
    alternativeActions: missNarratives.slice(0, 3).map((entry) => {
      const winnerText = entry.miss.winners.join(", ");
      const extra =
        entry.winnerSignals[1] ?? entry.selectedWeaknesses[0] ?? "vinnarsignalerna var starkare än systemet antog";
      return `Gardera avd ${entry.miss.leg} med ${winnerText}; ${extra}.`;
    }),
    generated_at: new Date().toISOString(),
    model: "fallback-rules",
  };
}

async function generateTravPostmortemAI(
  snapshot: FetchSnapshot,
  resolved: ReturnType<typeof extractTravResult>,
  hitSummary: TravSystemHitSummary,
): Promise<TravPostmortem | null> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return null;

  const system = `Du gör postmortem på ett travsystem (V86/V85). Använd bara den data som finns i indata.
- Förklara varför systemet gick rätt/fel.
- Lyft utdelning, vinnare, missade lopp och tydliga mönster.
- Nämn tempo/loppbild ENDAST om det går att stödja av datan; annars säg att det inte går att avgöra säkert.
- Fokusera på spår, form, kusk/häst-kemi, bana, klass, vila, slutodds, seger marginal, streck kontra modell och eventuella undervärderade vinnare.
- Lyft även sådant användaren inte uttryckligen frågat om när datan stödjer det, t.ex. tränarform, utrustningssignal, bankvalitet och risk i överstreckade favoriter.
Returnera ENDAST JSON med fälten:
{
  "verdict": "träff|delvis|miss",
  "summary": "kort text",
  "why": ["..."],
  "paceNotes": "kort text",
  "lessons": ["..."],
  "modelMistakes": ["..."],
  "signalsMissed": ["..."],
  "alternativeActions": ["..."]
}`;

  const user = JSON.stringify(
    {
      snapshot: {
        gameId: snapshot.game.id,
        gameType: snapshot.game.type,
        system: snapshot.system,
        legs: snapshot.legs,
        meta: snapshot.meta,
      },
      resolved,
      hitSummary,
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
    if (!res.ok) return null;
    const json: any = await res.json();
    const content = String(json?.choices?.[0]?.message?.content ?? "").trim();
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as Omit<TravPostmortem, "generated_at" | "model">;
    return {
      verdict: parsed.verdict,
      summary: parsed.summary,
      why: parsed.why ?? [],
      paceNotes: parsed.paceNotes ?? "",
      lessons: parsed.lessons ?? [],
      modelMistakes: parsed.modelMistakes ?? [],
      signalsMissed: parsed.signalsMissed ?? [],
      alternativeActions: parsed.alternativeActions ?? [],
      generated_at: new Date().toISOString(),
      model: "google/gemini-2.5-flash",
    };
  } catch {
    return null;
  }
}

export async function getTravLearningPrompt(gameType: PoolGameType): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("trav_learning_prompts")
    .select("prompt_text")
    .eq("game_type", gameType)
    .maybeSingle();
  const txt = String(data?.prompt_text ?? "").trim();
  return txt.length ? txt : null;
}

type SaveTravPredictionOptions = {
  source?: "live" | "historical-backtest";
  backtestDate?: string | null;
  dedupe?: boolean;
  extraMeta?: Record<string, Json | undefined>;
};

async function findExistingTravPrediction(
  gameId: string,
  gameType: PoolGameType,
  source: SaveTravPredictionOptions["source"],
) {
  const { data } = await supabaseAdmin
    .from("trav_predictions")
    .select("id, meta_json")
    .eq("game_id", gameId)
    .eq("game_type", gameType)
    .order("created_at", { ascending: false })
    .limit(20);
  return (
    data?.find((row) => {
      const meta = (row.meta_json ?? {}) as Record<string, unknown>;
      return String(meta.source ?? "live") === (source ?? "live");
    })?.id ?? null
  );
}

export async function saveTravPrediction(
  snapshot: FetchSnapshot,
  options: SaveTravPredictionOptions = {},
): Promise<string | null> {
  const learningPrompt = await getTravLearningPrompt(snapshot.game.type).catch(() => null);
  const source = options.source ?? snapshot.meta?.source ?? "live";
  const metaJson = {
    ...(snapshot.meta ?? {}),
    source,
    backtestDate: options.backtestDate ?? snapshot.meta?.backtestDate ?? null,
    ...(options.extraMeta ?? {}),
  } as Json;
  const payload: Database["public"]["Tables"]["trav_predictions"]["Insert"] = {
    game_id: snapshot.game.id,
    game_type: snapshot.game.type,
    game_date: gameDateOf(snapshot),
    status: snapshot.game.status,
    snapshot_json: snapshot as unknown as Json,
    system_json: snapshot.system as unknown as Json,
    legs_json: snapshot.legs as unknown as Json,
    meta_json: metaJson,
    analysis_model: snapshot.meta?.analysisModel ?? null,
    learning_prompt: learningPrompt,
    model_version: TRAV_MODEL_VERSION,
  };
  if (options.dedupe) {
    const existingId = await findExistingTravPrediction(snapshot.game.id, snapshot.game.type, source);
    if (existingId) {
      const { error } = await supabaseAdmin
        .from("trav_predictions")
        .update(payload)
        .eq("id", existingId);
      if (error) {
        console.error("saveTravPrediction update failed", error);
        return null;
      }
      return existingId;
    }
  }
  const { data, error } = await supabaseAdmin
    .from("trav_predictions")
    .insert(payload)
    .select("id")
    .single();
  if (error) {
    console.error("saveTravPrediction insert failed", error);
    return null;
  }
  return data?.id ?? null;
}

async function resolveTravPredictionRow(
  rowId: string,
  snapshot: FetchSnapshot,
  game: AtgGame,
): Promise<boolean> {
  const resolvedData = extractTravResult(game);
  const hitSummary = buildSystemHitSummary(snapshot.system, resolvedData);
  const aiPostmortem = await generateTravPostmortemAI(snapshot, resolvedData, hitSummary);
  const postmortem = aiPostmortem ?? buildFallbackTravPostmortem(snapshot, resolvedData, hitSummary);

  const { error } = await supabaseAdmin
    .from("trav_predictions")
    .update({
      status: "results",
      resolved_at: new Date().toISOString(),
      result_json: resolvedData as unknown as Json,
      payouts_json: resolvedData.payouts as unknown as Json,
      winning_numbers_json: resolvedData.legs.map((leg) => ({
        leg: leg.leg,
        winners: leg.winners,
        reserveOrder: leg.reserveOrder,
      })) as unknown as Json,
      system_hit_summary: hitSummary as unknown as Json,
      postmortem_json: postmortem as unknown as Json,
    })
    .eq("id", rowId);
  if (error) {
    console.error("resolveTravPredictionRow update failed", error);
    return false;
  }
  return true;
}

function extractLessons(postmortem: unknown): string[] {
  const pm = postmortem as { lessons?: string[] } | null | undefined;
  return Array.isArray(pm?.lessons) ? pm!.lessons.filter(Boolean) : [];
}

function topByFrequency(items: string[], limit = 6): string[] {
  const map = new Map<string, number>();
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    map.set(trimmed, (map.get(trimmed) ?? 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([text, count]) => (count > 1 ? `${text} (×${count})` : text));
}

export async function updateTravLearningPrompt(gameType: PoolGameType): Promise<string | null> {
  const { count } = await supabaseAdmin
    .from("trav_predictions")
    .select("id", { count: "exact", head: true })
    .eq("game_type", gameType)
    .not("resolved_at", "is", null);
  const resolvedCount = count ?? 0;

  const { data: prev } = await supabaseAdmin
    .from("trav_learning_prompts")
    .select("prompt_text, last_resolved_count")
    .eq("game_type", gameType)
    .maybeSingle();
  const lastCount = prev?.last_resolved_count ?? 0;

  const { data: rows } = await supabaseAdmin
    .from("trav_predictions")
    .select("game_id, postmortem_json, system_hit_summary, payouts_json")
    .eq("game_type", gameType)
    .not("resolved_at", "is", null)
    .order("resolved_at", { ascending: false })
    .limit(60);

  const lessons = topByFrequency((rows ?? []).flatMap((row) => extractLessons(row.postmortem_json)));

  let promptText =
    lessons.length > 0
      ? lessons.map((lesson) => `- ${lesson}`).join("\n")
      : "Bygg travsystemen datadrivet: respektera edge mot strecken, spårhistorik, formtrend och kusk/häst-kemi.";

  const apiKey = process.env.LOVABLE_API_KEY;
  if (apiKey && resolvedCount >= Math.max(3, lastCount + 3)) {
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
            {
              role: "system",
              content:
                "Du tränar en travmodell för V86/V85. Skriv en kort svensk träningsprompt med konkreta regler i imperativ, max 1200 tecken. Fokusera på systematiska mönster i resolverade tips.",
            },
            {
              role: "user",
              content: JSON.stringify(
                {
                  gameType,
                  previousPrompt: prev?.prompt_text ?? "",
                  recentPostmortems: rows ?? [],
                  topLessons: lessons,
                },
                null,
                2,
              ),
            },
          ],
        }),
      });
      if (res.ok) {
        const json: any = await res.json();
        const candidate = String(json?.choices?.[0]?.message?.content ?? "").trim();
        if (candidate) promptText = candidate;
      }
    } catch {
      // keep fallback prompt
    }
  }

  const { error } = await supabaseAdmin.from("trav_learning_prompts").upsert(
    {
      game_type: gameType,
      prompt_text: promptText,
      last_resolved_count: resolvedCount,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "game_type" },
  );
  if (error) {
    console.error("updateTravLearningPrompt failed", error);
    return null;
  }
  return promptText;
}

export async function resolvePendingTravPredictions(limit = 20) {
  const { data, error } = await supabaseAdmin
    .from("trav_predictions")
    .select("id, game_id, game_type, snapshot_json")
    .is("resolved_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error || !data) return { resolved: 0, checked: 0, promptsUpdated: 0 };

  let resolved = 0;
  const touched = new Set<PoolGameType>();

  for (const row of data) {
    const snapshot = row.snapshot_json as unknown as FetchSnapshot;
    if (!snapshot?.game?.id) continue;

    const game = await fetchGame(row.game_id).catch(() => null);
    if (!game || game.status !== "results") continue;

    const ok = await resolveTravPredictionRow(row.id, snapshot, game);
    if (!ok) {
      continue;
    }
    resolved++;
    touched.add(row.game_type as PoolGameType);
  }

  let promptsUpdated = 0;
  for (const gameType of touched) {
    const prompt = await updateTravLearningPrompt(gameType);
    if (prompt) promptsUpdated++;
  }

  return { resolved, checked: data.length, promptsUpdated };
}

function parseDateOnly(value?: string | null) {
  if (!value) return null;
  return value.slice(0, 10);
}

function* dateRangeDescending(fromDate: string, toDate: string) {
  const end = new Date(`${toDate}T12:00:00Z`);
  const start = new Date(`${fromDate}T12:00:00Z`);
  for (let cursor = end; cursor >= start; cursor = new Date(cursor.getTime() - 86400000)) {
    yield cursor.toISOString().slice(0, 10);
  }
}

export async function backtestTravHistory(input: {
  gameType: PoolGameType;
  fromDate: string;
  toDate: string;
  maxGames?: number;
  budgetKr?: number;
  targetMinPayoutKr?: number;
}) {
  const maxGames = Math.max(1, Math.min(input.maxGames ?? 6, 24));
  const rows: Array<{
    id: string | null;
    gameId: string;
    gameType: PoolGameType;
    gameDate: string | null;
    correctLegs: number;
    totalLegs: number;
    payoutAmountKr: number | null;
    summary: string;
    lessons: string[];
  }> = [];

  for (const date of dateRangeDescending(input.fromDate, input.toDate)) {
    if (rows.length >= maxGames) break;
    const calendar = await fetchCalendarDay(date).catch(() => null);
    if (!calendar?.games) continue;
    const entries =
      listAllowedGamesFromCalendar(calendar.games).find((item) => item.type === input.gameType)?.entries ?? [];
    for (const entry of entries) {
      if (rows.length >= maxGames) break;
      const fullGame = await fetchGame(entry.id).catch(() => null);
      if (!fullGame || fullGame.status !== "results") continue;

      const prematchGame = sanitizeHistoricalGameForPrematch(fullGame);
      const snapshot = await buildSnapshotFromGame(prematchGame, {
        budgetKr: input.budgetKr,
        targetMinPayoutKr: input.targetMinPayoutKr,
        includeAndelsspel: false,
        includeTravsport: true,
        travsportDbCache: hybridTravsportCache,
      });
      const snapshotWithMeta: FetchSnapshot = {
        ...snapshot,
        meta: {
          ...snapshot.meta,
          source: "historical-backtest",
          backtestDate: parseDateOnly(gameDateOf(snapshot) ?? date),
        },
      };

      const rowId = await saveTravPrediction(snapshotWithMeta, {
        source: "historical-backtest",
        backtestDate: parseDateOnly(gameDateOf(snapshot) ?? date),
        dedupe: true,
        extraMeta: {
          origin_status: fullGame.status,
        },
      });
      if (!rowId) continue;

      const ok = await resolveTravPredictionRow(rowId, snapshotWithMeta, fullGame);
      if (!ok) continue;

      const resolvedData = extractTravResult(fullGame);
      const hitSummary = buildSystemHitSummary(snapshotWithMeta.system, resolvedData);
      const postmortem =
        (await supabaseAdmin
          .from("trav_predictions")
          .select("postmortem_json")
          .eq("id", rowId)
          .maybeSingle()
          .then((res) => res.data?.postmortem_json as { summary?: string; lessons?: string[] } | null)
          .catch(() => null)) ?? null;

      rows.push({
        id: rowId,
        gameId: fullGame.id,
        gameType: input.gameType,
        gameDate: parseDateOnly(fullGame.races[0]?.date ?? fullGame.races[0]?.startTime ?? date),
        correctLegs: hitSummary.correctLegs,
        totalLegs: hitSummary.totalLegs,
        payoutAmountKr: hitSummary.payoutAmountKr,
        summary: postmortem?.summary ?? `${hitSummary.correctLegs}/${hitSummary.totalLegs} rätt`,
        lessons: Array.isArray(postmortem?.lessons) ? postmortem!.lessons.slice(0, 3) : [],
      });
    }
  }

  if (rows.length > 0) {
    await updateTravLearningPrompt(input.gameType);
  }

  return {
    backtested: rows.length,
    rows,
    fromDate: input.fromDate,
    toDate: input.toDate,
    gameType: input.gameType,
  };
}

export async function getTravHistory(limit = 20, gameType?: PoolGameType | null) {
  let query = supabaseAdmin
    .from("trav_predictions")
    .select(
      "id, game_id, game_type, game_date, status, created_at, resolved_at, system_json, result_json, payouts_json, winning_numbers_json, system_hit_summary, postmortem_json, analysis_model, learning_prompt, meta_json",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (gameType) query = query.eq("game_type", gameType);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const { data: prompts } = await supabaseAdmin
    .from("trav_learning_prompts")
    .select("game_type, prompt_text, updated_at")
    .order("game_type");

  return {
    rows: (data ?? []).map((row) => ({
      id: row.id,
      gameId: row.game_id,
      gameType: row.game_type,
      gameDate: row.game_date,
      status: row.status,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
      system: row.system_json,
      result: row.result_json,
      payouts: row.payouts_json,
      winningNumbers: row.winning_numbers_json,
      hitSummary: row.system_hit_summary,
      postmortem: row.postmortem_json,
      analysisModel: row.analysis_model,
      learningPrompt: row.learning_prompt,
      meta: row.meta_json,
    })),
    prompts: prompts ?? [],
  };
}

