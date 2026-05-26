import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, Fragment } from "react";
import {
  v86Analyze,
  v86BacktestHistory,
  v86History,
  v86ListGames,
  pickDefaultPoolGame,
  v86ResolveHistory,
  type FetchSnapshot,
  type GameOption,
} from "@/lib/v86.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Loader2,
  RefreshCw,
  Copy,
  Check,
  ExternalLink,
  Sparkles,
  TrendingUp,
  Brain,
} from "lucide-react";
import { toast } from "sonner";
import { rowPriceKr } from "../../../v86/src/game-types";

export const Route = createFileRoute("/v86/")({
  component: V86Dashboard,
});

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

const DEFAULT_TRAV_BUDGET_KR = 600;
const DEFAULT_DD_BUDGET_KR = 60;
const DEFAULT_TRAV_MIN_PAYOUT_KR = 30_000;
const DEFAULT_DD_MIN_PAYOUT_KR = 1_500;
const DEFAULT_BACKTEST_GAMES = 10;

function formatRowPrice(type: FetchSnapshot["game"]["type"] | GameOption["type"]) {
  const value = rowPriceKr(type);
  return value.toLocaleString("sv-SE", {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  });
}

function formatMarks(snapshot: FetchSnapshot): string {
  return snapshot.system.selections
    .map((s) => s.picks.join(","))
    .join("\n");
}

function formatCurrencyKr(amount: number | null | undefined) {
  if (amount == null) return "—";
  return `${Math.round(amount).toLocaleString("sv-SE")} kr`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("sv-SE");
}

function systemSelectionsOf(system: unknown) {
  const selections = typeof system === "object" && system && "selections" in (system as Record<string, unknown>)
    ? (system as { selections?: Array<{ leg?: number; picks?: number[]; type?: string; note?: string }> }).selections
    : [];
  return Array.isArray(selections) ? selections : [];
}

function hitSummaryOf(hitSummary: unknown) {
  if (!hitSummary || typeof hitSummary !== "object") return null;
  return hitSummary as {
    totalLegs?: number;
    correctLegs?: number;
    payoutTierHit?: string | null;
    payoutAmountKr?: number | null;
    hitLegs?: number[];
    missLegs?: Array<{ leg?: number; picks?: number[]; winners?: number[] }>;
  };
}

function postmortemOf(postmortem: unknown) {
  if (!postmortem || typeof postmortem !== "object") return null;
  return postmortem as {
    summary?: string;
    why?: string[];
    lessons?: string[];
    paceNotes?: string;
    modelMistakes?: string[];
    signalsMissed?: string[];
    alternativeActions?: string[];
  };
}

function resolvedLegsOf(result: unknown) {
  if (!result || typeof result !== "object" || !("legs" in (result as Record<string, unknown>))) {
    return [];
  }
  const legs = (result as { legs?: Array<{ leg?: number; winners?: number[]; topFinishers?: Array<{ number?: number; name?: string; finalOdds?: number | null }> }> }).legs;
  return Array.isArray(legs) ? legs : [];
}

function payoutRowsOf(payouts: unknown) {
  if (!payouts || typeof payouts !== "object" || !("resultPayouts" in (payouts as Record<string, unknown>))) {
    return [];
  }
  const resultPayouts = (payouts as { resultPayouts?: Record<string, { payout?: number; jackpot?: boolean; systems?: number | string }> }).resultPayouts ?? {};
  return Object.entries(resultPayouts)
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([tier, value]) => ({
      tier,
      text:
        value?.jackpot
          ? "Jackpot"
          : `${formatCurrencyKr(value?.payout ?? null)}${value?.systems != null ? ` · ${value.systems} system` : ""}`,
    }));
}

function visibleHistoryRows(rows: any[] | undefined) {
  return Array.isArray(rows) ? rows : [];
}

function analysisLegsOf(legs: unknown) {
  return Array.isArray(legs)
    ? (legs as Array<{
        leg?: number;
        raceName?: string;
        horses?: Array<{
          number?: number;
          name?: string;
          projectedRank?: number;
          projectedFinishLabel?: string;
          estimatedWinPct?: number;
          betDistribution?: number;
          valueEdgePct?: number;
          analystComment?: string;
        }>;
      }>)
    : [];
}

function HorseAnalysisTables({
  legs,
  compact = false,
}: {
  legs: ReturnType<typeof analysisLegsOf>;
  compact?: boolean;
}) {
  if (!legs.length) return null;

  return (
    <div className={`space-y-3 ${compact ? "" : "mt-4"}`}>
      {legs.map((leg) => {
        const horses = Array.isArray(leg.horses) ? [...leg.horses] : [];
        if (horses.length === 0) return null;
        return (
          <div
            key={`horse-analysis-${compact ? "compact" : "full"}-${leg.leg ?? "x"}`}
            className="rounded border border-[#1e3d2a] bg-[#0c1410] p-3"
          >
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[#5ec98a]">
              Hästanalys avd {leg.leg}
              {leg.raceName ? ` · ${leg.raceName}` : ""}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="text-[#7fa892]">
                  <tr className="border-b border-[#1e3d2a]">
                    <th className="px-2 py-1">Rank</th>
                    <th className="px-2 py-1">Häst</th>
                    <th className="px-2 py-1">Förväntad slutbild</th>
                    <th className="px-2 py-1">Vinst%</th>
                    <th className="px-2 py-1">Spel%</th>
                    <th className="px-2 py-1">Edge</th>
                    <th className="px-2 py-1">Kort analys</th>
                  </tr>
                </thead>
                <tbody>
                  {horses.map((horse, index) => (
                    <tr
                      key={`${leg.leg}-${horse.number ?? index}-${compact ? "compact" : "full"}`}
                      className="border-b border-[#13261c] align-top text-[#e8f0ea] last:border-b-0"
                    >
                      <td className="px-2 py-1">{horse.projectedRank ?? index + 1}</td>
                      <td className="px-2 py-1">
                        <span className="font-mono text-[#5ec98a]">{horse.number}.</span> {horse.name}
                      </td>
                      <td className="px-2 py-1">{horse.projectedFinishLabel ?? "—"}</td>
                      <td className="px-2 py-1">
                        {horse.estimatedWinPct != null ? `${horse.estimatedWinPct.toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-2 py-1">
                        {horse.betDistribution != null ? `${horse.betDistribution.toFixed(1)}%` : "—"}
                      </td>
                      <td className="px-2 py-1">
                        {horse.valueEdgePct != null
                          ? `${horse.valueEdgePct >= 0 ? "+" : ""}${horse.valueEdgePct.toFixed(1)}%`
                          : "—"}
                      </td>
                      <td className="px-2 py-1 text-[#b8f0d0]">
                        {horse.analystComment ?? "Ingen kommentar"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function V86Dashboard() {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayIso);
  const [gameId, setGameId] = useState<string>("");
  const [budgetKr, setBudgetKr] = useState(DEFAULT_TRAV_BUDGET_KR);
  const [minPayout, setMinPayout] = useState(DEFAULT_TRAV_MIN_PAYOUT_KR);
  const [autoBudget, setAutoBudget] = useState(true);
  const [copied, setCopied] = useState(false);
  const [expandedHorse, setExpandedHorse] = useState<string | null>(null);
  const [showAllLegs, setShowAllLegs] = useState<Record<number, boolean>>({});
  const [backtestType, setBacktestType] = useState<"V85" | "dd">("dd");
  const [backtestFromDate, setBacktestFromDate] = useState(daysAgoIso(90));
  const [backtestToDate, setBacktestToDate] = useState(todayIso());
  const [backtestMaxGames, setBacktestMaxGames] = useState(DEFAULT_BACKTEST_GAMES);
  const [backtestAutoBudget, setBacktestAutoBudget] = useState(true);

  const gamesQ = useQuery({
    queryKey: ["v86-games", date],
    queryFn: () => v86ListGames({ data: { date } }),
  });

  const games = gamesQ.data?.games ?? [];
  const visibleGames = useMemo(() => games, [games]);
  const selectedGame = visibleGames.find((g) => g.id === gameId);
  const isV85Game = selectedGame?.type === "V85";
  const isV86Game = selectedGame?.type === "V86";
  const isDdGame = selectedGame?.type === "dd";
  const supportsAutoBudget = isV85Game || isV86Game || isDdGame;
  const historyFilterType = selectedGame?.type ?? "all";

  useEffect(() => {
    if (!visibleGames.length) return;
    const preferred =
      pickDefaultPoolGame(visibleGames) ??
      visibleGames.find((g) => g.type === "dd") ??
      visibleGames[0];
    if (preferred && (!gameId || !visibleGames.some((g) => g.id === gameId))) {
      setGameId(preferred.id);
      if (preferred.type === "dd") {
        setBudgetKr(DEFAULT_DD_BUDGET_KR);
        setMinPayout(DEFAULT_DD_MIN_PAYOUT_KR);
      } else if (preferred.type === "V85" || preferred.type === "V86") {
        setBudgetKr(DEFAULT_TRAV_BUDGET_KR);
        setMinPayout(DEFAULT_TRAV_MIN_PAYOUT_KR);
      }
    }
  }, [visibleGames, gameId]);

  useEffect(() => {
    if (!selectedGame) return;
    if (selectedGame.type === "dd") {
      setBudgetKr((b) => (b === DEFAULT_TRAV_BUDGET_KR ? DEFAULT_DD_BUDGET_KR : b));
      setMinPayout((m) => (m === DEFAULT_TRAV_MIN_PAYOUT_KR ? DEFAULT_DD_MIN_PAYOUT_KR : m));
    } else if (selectedGame.type === "V85" || selectedGame.type === "V86") {
      setBudgetKr((b) => (b === DEFAULT_DD_BUDGET_KR ? DEFAULT_TRAV_BUDGET_KR : b));
      setMinPayout((m) => (m === DEFAULT_DD_MIN_PAYOUT_KR ? DEFAULT_TRAV_MIN_PAYOUT_KR : m));
    }
  }, [selectedGame?.id, selectedGame?.type]);

  const analyzeM = useMutation({
    mutationFn: () =>
      v86Analyze({
        data: {
          date,
          gameId: gameId || undefined,
          budgetKr: autoBudget && supportsAutoBudget ? undefined : budgetKr,
          targetMinPayoutKr: autoBudget && supportsAutoBudget ? undefined : minPayout,
          autoBudget: autoBudget && supportsAutoBudget,
        },
      }),
    onError: (e: Error) => toast.error(e.message),
    onSuccess: () => {
      toast.success("Analys klar och sparad i historiken");
      queryClient.invalidateQueries({ queryKey: ["trav-history"] });
    },
  });

  const historyQ = useQuery({
    queryKey: ["trav-history", historyFilterType],
    queryFn: () =>
      v86History({
        data: {
          limit: 16,
          gameType: historyFilterType,
        },
      }),
  });

  const resolveM = useMutation({
    mutationFn: () => v86ResolveHistory({ data: { limit: 20 } }),
    onError: (e: Error) => toast.error(e.message),
    onSuccess: (res) => {
      if (res.resolved > 0) {
        toast.success(`Hämtade facit för ${res.resolved} omgångar`);
      } else {
        toast.info("Inga nya avgjorda omgångar att resolve:a just nu");
      }
      queryClient.invalidateQueries({ queryKey: ["trav-history"] });
    },
  });

  const backtestM = useMutation({
    mutationFn: () =>
      v86BacktestHistory({
        data: {
          gameType: backtestType,
          fromDate: backtestFromDate,
          toDate: backtestToDate,
          maxGames: backtestMaxGames,
          budgetKr: backtestAutoBudget ? undefined : budgetKr,
          targetMinPayoutKr: backtestAutoBudget ? undefined : minPayout,
          autoBudget: backtestAutoBudget,
        },
      }),
    onError: (e: Error) => toast.error(e.message),
    onSuccess: (res) => {
      toast.success(`Backtest klar: ${res.backtested} omgångar`);
      queryClient.invalidateQueries({ queryKey: ["trav-history"] });
    },
  });

  const snapshot = analyzeM.data;
  const pool = snapshot?.game.pools?.[snapshot.game.type];

  const andelUrl = gameId
    ? `https://www.atg.se/andelsspel?gameId=${encodeURIComponent(gameId)}`
    : "https://www.atg.se/andelsspel";

  const marksText = useMemo(
    () => (snapshot ? formatMarks(snapshot) : ""),
    [snapshot],
  );
  const activePrompt = useMemo(() => {
    const currentType = snapshot?.game.type ?? selectedGame?.type;
    if (currentType !== "V85") return null;
    const fromHistory = historyQ.data?.prompts?.find((item) => item.game_type === currentType)?.prompt_text;
    return (fromHistory ?? snapshot?.meta?.learningPromptText ?? "").trim() || null;
  }, [historyQ.data?.prompts, selectedGame?.type, snapshot?.game.type, snapshot?.meta?.learningPromptText]);

  useEffect(() => {
    setShowAllLegs({});
    setExpandedHorse(null);
  }, [snapshot?.game.id]);

  async function copyMarks() {
    if (!marksText) return;
    await navigator.clipboard.writeText(marksText);
    setCopied(true);
    toast.success("Markeringar kopierade");
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-6">
      <Card className="border-[#1e3d2a] bg-[#111c16] p-4 text-[#e8f0ea] shadow-none">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-[#7fa892]">Datum</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border-[#1e3d2a] bg-[#0c1410] text-[#e8f0ea]"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-[#7fa892]">Spel</Label>
            {gamesQ.isLoading ? (
              <Skeleton className="h-10 w-full bg-[#1e3d2a]" />
            ) : (
              <select
                value={gameId}
                onChange={(e) => setGameId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-[#1e3d2a] bg-[#0c1410] px-3 text-sm text-[#e8f0ea]"
              >
                {visibleGames.length === 0 && (
                  <option value="">Inget V85, V86 eller DD denna dag</option>
                )}
                {visibleGames.map((g: GameOption) => (
                  <option key={g.id} value={g.id}>
                    {g.typeLabel}
                    {g.startLabel ? ` · ${g.startLabel}` : ""} — {g.status}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-end">
            <Button
              className="w-full bg-[#1a5c38] text-[#e8f0ea] hover:bg-[#22704a]"
              disabled={!gameId || analyzeM.isPending}
              onClick={() => analyzeM.mutate()}
            >
              {analyzeM.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Sparkles />
              )}
              Analysera
            </Button>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[#7fa892]">Budget (kr)</Label>
            <Input
              type="number"
              min={isDdGame ? 50 : 25}
              max={10000}
              step={isDdGame ? 10 : 25}
              value={autoBudget && supportsAutoBudget ? (isDdGame ? DEFAULT_DD_BUDGET_KR : DEFAULT_TRAV_BUDGET_KR) : budgetKr}
              onChange={(e) => setBudgetKr(Number(e.target.value))}
              disabled={autoBudget && supportsAutoBudget}
              className="border-[#1e3d2a] bg-[#0c1410] text-[#e8f0ea]"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[#7fa892]">Målutdelning (kr)</Label>
            <Input
              type="number"
              min={isV85Game ? 30_000 : 1_000}
              step={isV85Game ? 5_000 : 500}
              value={autoBudget && supportsAutoBudget ? (isDdGame ? DEFAULT_DD_MIN_PAYOUT_KR : DEFAULT_TRAV_MIN_PAYOUT_KR) : minPayout}
              onChange={(e) => setMinPayout(Number(e.target.value))}
              disabled={autoBudget && supportsAutoBudget}
              className="border-[#1e3d2a] bg-[#0c1410] text-[#e8f0ea]"
            />
          </div>
          <div className="flex items-end sm:col-span-2">
            <Button
              variant="outline"
              className="w-full border-[#1e3d2a] bg-transparent text-[#b8f0d0] hover:bg-[#1a5c38]/20"
              onClick={() => gamesQ.refetch()}
              disabled={gamesQ.isFetching}
            >
              <RefreshCw className={gamesQ.isFetching ? "animate-spin" : ""} />
              Uppdatera spellista
            </Button>
          </div>
          {supportsAutoBudget && (
            <label className="sm:col-span-4 flex items-start gap-3 rounded-md border border-[#1e3d2a] bg-[#0c1410] px-3 py-2 text-sm text-[#b8f0d0]">
              <input
                type="checkbox"
                checked={autoBudget}
                onChange={(e) => setAutoBudget(e.target.checked)}
                className="mt-1 h-4 w-4 accent-[#1a5c38]"
              />
              <span>
                <span className="font-medium text-[#d4f5e2]">Auto-föreslå spelbudget</span>
                <span className="block text-xs text-[#7fa892]">
                  {isDdGame
                    ? "Modellen väljer själv mellan 50 och 60 kr för DD och siktar på en månadsstabil profil."
                    : "Modellen väljer själv mellan 600, 700, 800, 900 och 1000 kr och håller alltid minst 30 000 kr i målutdelning."}
                </span>
              </span>
            </label>
          )}
        </div>
      </Card>

      {analyzeM.isPending && (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-40 bg-[#1e3d2a]" />
          ))}
        </div>
      )}

      {snapshot && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Badge className="bg-[#1a5c38] text-[#d4f5e2]">{snapshot.game.type}</Badge>
            {snapshot.meta?.poolStartLabel && (
              <Badge variant="outline" className="border-[#2d6b45] text-[#b8f0d0]">
                Start {snapshot.meta.poolStartLabel}
                {snapshot.meta.isWednesdayRound ? " (onsdag)" : snapshot.meta.isSaturdayRound ? " (lördag)" : ""}
              </Badge>
            )}
            {snapshot.meta?.analysisModel && (
              <span className="text-xs text-[#5a7a68]">
                {snapshot.meta.analysisModel}
                {snapshot.meta.travsportHorses != null &&
                  snapshot.meta.travsportHorses > 0 &&
                  " ✓"}
              </span>
            )}
            {snapshot.meta?.recommendedPlay && (
              <Badge variant="outline" className="border-[#2d6b45] text-[#b8f0d0]">
                Auto: {snapshot.meta.recommendedPlay.budgetKr} kr · mål {Math.round(snapshot.meta.recommendedPlay.targetMinPayoutKr).toLocaleString("sv-SE")} kr
              </Badge>
            )}
            {snapshot.meta?.predictionId && (
              <Badge variant="outline" className="border-[#2d6b45] text-[#b8f0d0]">
                Sparad i historik
              </Badge>
            )}
            {snapshot.meta?.fullRaceDataStored && (
              <Badge variant="outline" className="border-[#2d6b45] text-[#b8f0d0]">
                Full data: {snapshot.meta.fullRaceDataRaces ?? snapshot.legs.length} lopp ·{" "}
                {snapshot.meta.fullRaceDataStarts ?? 0} starter
              </Badge>
            )}
            <span className="text-sm text-[#7fa892]">{snapshot.game.id}</span>
            {pool?.turnover != null && (
              <span className="text-sm text-[#b8f0d0]">
                Omsättning {(pool.turnover / 100).toLocaleString("sv-SE")} kr
              </span>
            )}
            <a
              href={andelUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-sm text-[#5ec98a] hover:underline"
            >
              Andelsspel <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>

          <Card className="border-[#2d6b45] bg-[#13261c] p-4 shadow-none">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-[#d4f5e2]">
                  System {snapshot.system.costKr.toFixed(0)} kr
                </h2>
                <p className="text-sm text-[#7fa892]">
                  {snapshot.system.rows.toLocaleString("sv-SE")} rader ×{" "}
                  {formatRowPrice(snapshot.game.type)} kr
                  {snapshot.system.skrellSpikeLeg != null &&
                    ` · Skräll-spik avd ${snapshot.system.skrellSpikeLeg}`}
                </p>
                <p className="mt-2 max-w-2xl text-xs text-[#7fa892]">
                  {snapshot.system.estimatedPayoutNote}
                </p>
                {snapshot.meta?.recommendedPlay?.reason && (
                  <p className="mt-2 max-w-3xl text-xs text-[#b8f0d0]">
                    Autoförslag: {snapshot.meta.recommendedPlay.reason}
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="border-[#2d6b45] text-[#b8f0d0]"
                onClick={copyMarks}
              >
                {copied ? <Check /> : <Copy />}
                Kopiera markeringar
              </Button>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {snapshot.system.selections.map((s) => (
                <div
                  key={s.leg}
                  className="rounded-lg border border-[#1e3d2a] bg-[#0c1410] px-3 py-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[#7fa892]">
                      Avd {s.leg}
                    </span>
                    <Badge
                      variant="outline"
                      className="border-[#2d6b45] text-[10px] text-[#5ec98a]"
                    >
                      {s.type}
                    </Badge>
                  </div>
                  <p className="mt-1 font-mono text-lg text-[#d4f5e2]">
                    {s.picks.join(", ")}
                  </p>
                  {s.note && (
                    <p className="mt-1 text-[11px] leading-snug text-[#7fa892]">
                      {s.note}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </Card>

          {activePrompt && (
            <Card className="border-[#2d6b45] bg-[#13261c] p-4 shadow-none">
              <div className="mb-2 flex items-center gap-2 text-[#d4f5e2]">
                <Brain className="h-4 w-4 text-[#5ec98a]" />
                <h3 className="font-medium">
                  Aktiv lärprompt {snapshot.game.type === "V85" ? snapshot.game.type : ""}
                </h3>
              </div>
              <p className="whitespace-pre-wrap text-xs leading-5 text-[#b8f0d0]">
                {activePrompt}
              </p>
            </Card>
          )}

          <Card className="border-[#2d6b45] bg-[#13261c] p-4 shadow-none">
            <h2 className="text-lg font-semibold text-[#d4f5e2]">
              Steg 1: ranka varje lopp först
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-[#b8f0d0]">
              Modellen går nu alltid igenom hela avdelningen först och sätter en
              full hästrank med vinstprocent, spelprocent och kommentar. Först när
              ranken är klar byggs systemet från samma ordning.
            </p>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            {snapshot.legs.map((leg) => {
              const showAll = Boolean(showAllLegs[leg.leg]);
              const visibleHorses = showAll ? leg.horses : leg.horses.slice(0, 6);
              return (
                <Card
                  key={leg.leg}
                  className="border-[#1e3d2a] bg-[#111c16] p-4 shadow-none"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-medium text-[#d4f5e2]">
                      Avd {leg.leg}
                      {leg.raceName ? ` — ${leg.raceName}` : ""}
                    </h3>
                    <Badge
                      variant="outline"
                      className="border-[#1e3d2a] text-[#7fa892] uppercase"
                    >
                      {leg.recommendation}
                    </Badge>
                  </div>
                  {leg.tipNote && (
                    <p className="mb-2 text-xs text-[#7fa892]">{leg.tipNote}</p>
                  )}
                  <ul className="space-y-1">
                    {visibleHorses.map((h) => {
                      const key = `${leg.leg}-${h.number}`;
                      const open = expandedHorse === key;
                      return (
                        <Fragment key={h.number}>
                          <li>
                            <button
                              type="button"
                              onClick={() => setExpandedHorse(open ? null : key)}
                              className="flex w-full items-center justify-between rounded px-1 py-1 text-left text-sm hover:bg-[#1a2e22]"
                            >
                              <span className="text-[#e8f0ea]">
                                <span className="font-mono text-[#5ec98a]">{h.number}.</span>{" "}
                                {h.name}
                                <span className="ml-1 text-[10px] text-[#5ec98a]">
                                  {(h.combinedScore * 100).toFixed(0)}%
                                </span>
                              </span>
                              <span className="tabular-nums text-[#7fa892]">
                                {h.betDistribution.toFixed(1)}% spel
                              </span>
                            </button>
                          </li>
                          {open && (
                            <li className="mb-2 ml-2 space-y-2 border-l border-[#2d6b45] pl-3 text-[11px]">
                              <p className="text-[#b8f0d0]">
                                Häst {(h.horseScore * 100).toFixed(0)}% · Kusk{" "}
                                {(h.driverScore * 100).toFixed(0)}% · Form {h.formTrend}
                              </p>
                              {h.highlights.length > 0 && (
                                <p className="text-[#7fa892]">{h.highlights.join(" · ")}</p>
                              )}
                              <div>
                                <p className="font-medium text-[#5ec98a]">Häst – checklista</p>
                                {h.horseChecklist.map((c) => (
                                  <div
                                    key={c.id}
                                    className={`flex justify-between gap-2 ${c.available ? "text-[#c8ddd2]" : "text-[#5a7a68]"}`}
                                  >
                                    <span>{c.label}</span>
                                    <span>
                                      {c.available ? `${(c.score * 100).toFixed(0)}%` : "—"} · {c.note}
                                    </span>
                                  </div>
                                ))}
                              </div>
                              <div>
                                <p className="font-medium text-[#5ec98a]">Kusk – checklista</p>
                                {h.driverChecklist.map((c) => (
                                  <div
                                    key={c.id}
                                    className={`flex justify-between gap-2 ${c.available ? "text-[#c8ddd2]" : "text-[#5a7a68]"}`}
                                  >
                                    <span>{c.label}</span>
                                    <span>
                                      {c.available ? `${(c.score * 100).toFixed(0)}%` : "—"} · {c.note}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </li>
                          )}
                        </Fragment>
                      );
                    })}
                  </ul>
                  {leg.horses.length > 6 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3 border-[#2d6b45] text-[#b8f0d0] hover:bg-[#1a5c38]/20"
                      onClick={() =>
                        setShowAllLegs((prev) => ({
                          ...prev,
                          [leg.leg]: !prev[leg.leg],
                        }))
                      }
                    >
                      {showAll ? "Visa topp 6" : `Visa alla (${leg.horses.length})`}
                    </Button>
                  )}
                  {leg.skrellSpike && (
                    <p className="mt-3 flex items-center gap-1 text-xs text-[#f0c674]">
                      <TrendingUp className="h-3.5 w-3.5" />
                      Skräll: {leg.skrellSpike.number}. {leg.skrellSpike.name} (
                      {leg.skrellSpike.betDistribution.toFixed(1)}%)
                    </p>
                  )}
                </Card>
              );
            })}
          </div>

          <Card className="border-[#1e3d2a] bg-[#111c16] p-4 shadow-none">
            <div className="mb-2">
              <h3 className="font-medium text-[#d4f5e2]">Prognostabell för alla hästar</h3>
              <p className="text-xs text-[#7fa892]">
                Varje lopp sparas med full hästrank, förväntad slutbild och kort analys så att det kan tränas vidare senare.
              </p>
            </div>
            <HorseAnalysisTables legs={analysisLegsOf(snapshot.legs)} />
          </Card>

          <Card className="border-[#2d6b45] bg-[#13261c] p-4 shadow-none">
            <h2 className="text-lg font-semibold text-[#d4f5e2]">
              Steg 2: bygg system från ranken
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-[#b8f0d0]">
              Kupongen plockar nu hästar direkt från den rankade listan i varje avdelning.
              Spik är rank 1 i loppet, och garderingar fylls på i rankordning.
            </p>
          </Card>

          {snapshot.andelsspel && snapshot.andelsspel.length > 0 && (
            <Card className="border-[#1e3d2a] bg-[#111c16] p-4 shadow-none">
              <h3 className="mb-3 font-medium text-[#d4f5e2]">
                Andelsspel – populära andelar
              </h3>
              <ul className="divide-y divide-[#1e3d2a]">
                {snapshot.andelsspel.slice(0, 10).map((a, i) => (
                  <li
                    key={`${a.name}-${i}`}
                    className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                  >
                    <span className="text-[#e8f0ea]">{a.name}</span>
                    <span className="text-[#7fa892]">
                      {a.costKr != null && `${a.costKr} kr`}
                      {a.sharesLeft != null && ` · ${a.sharesLeft} kvar`}
                      {a.expert && ` · ${a.expert}`}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <p className="text-center text-xs text-[#5a7a68]">
            Uppdaterad {new Date(snapshot.fetchedAt).toLocaleString("sv-SE")} · Data
            från ATG (endast analys, inget spel placeras här)
          </p>
        </>
      )}

      <Card className="border-[#1e3d2a] bg-[#111c16] p-4 shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[#d4f5e2]">
              Historik, facit och lärdomar
            </h2>
            <p className="text-sm text-[#7fa892]">
              Sparade analyser för {historyFilterType === "all" ? "V85, V86 och Dagens Dubbel" : historyFilterType}. Resolve:a avgjorda omgångar för att hämta utdelning och postmortem.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="border-[#2d6b45] text-[#b8f0d0]"
              onClick={() => resolveM.mutate()}
              disabled={resolveM.isPending}
            >
              {resolveM.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Hämta facit & lärdomar
            </Button>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-[#1e3d2a] bg-[#0c1410] p-3">
          <div className="mb-3 flex items-center gap-2">
            <Brain className="h-4 w-4 text-[#5ec98a]" />
            <h3 className="font-medium text-[#d4f5e2]">Historisk backtest</h3>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-1.5">
              <Label className="text-[#7fa892]">Speltyp</Label>
              <select
                value={backtestType}
                onChange={(e) => setBacktestType(e.target.value as "V85" | "dd")}
                className="flex h-10 w-full rounded-md border border-[#1e3d2a] bg-[#111c16] px-3 text-sm text-[#e8f0ea]"
              >
                <option value="V85">V85</option>
                <option value="dd">Dagens Dubbel</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#7fa892]">Från datum</Label>
              <Input
                type="date"
                value={backtestFromDate}
                onChange={(e) => setBacktestFromDate(e.target.value)}
                className="border-[#1e3d2a] bg-[#111c16] text-[#e8f0ea]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#7fa892]">Till datum</Label>
              <Input
                type="date"
                value={backtestToDate}
                onChange={(e) => setBacktestToDate(e.target.value)}
                className="border-[#1e3d2a] bg-[#111c16] text-[#e8f0ea]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[#7fa892]">Max omgångar</Label>
              <Input
                type="number"
                min={1}
                max={200}
                value={backtestMaxGames}
                onChange={(e) => setBacktestMaxGames(Number(e.target.value))}
                className="border-[#1e3d2a] bg-[#111c16] text-[#e8f0ea]"
              />
            </div>
            <div className="flex items-end">
              <Button
                className="w-full bg-[#1a5c38] text-[#e8f0ea] hover:bg-[#22704a]"
                onClick={() => backtestM.mutate()}
                disabled={backtestM.isPending || backtestFromDate > backtestToDate}
              >
                {backtestM.isPending ? <Loader2 className="animate-spin" /> : <Brain />}
                Kör backtest
              </Button>
            </div>
          </div>
          <label className="mt-3 flex items-start gap-3 rounded-md border border-[#1e3d2a] bg-[#111c16] px-3 py-2 text-sm text-[#b8f0d0]">
            <input
              type="checkbox"
              checked={backtestAutoBudget}
              onChange={(e) => setBacktestAutoBudget(e.target.checked)}
              className="mt-1 h-4 w-4 accent-[#1a5c38]"
            />
            <span>
              <span className="font-medium text-[#d4f5e2]">Auto-föreslå budget i backtest</span>
              <span className="block text-xs text-[#7fa892]">
                {backtestType === "dd"
                  ? "Varje DD-omgång väljer då själv mellan 50 och 60 kr med fokus på månadsstabilitet."
                  : "Varje omgång väljer då själv mellan 600, 700, 800, 900 och 1000 kr, med minst 30 000 kr i målutdelning."}
              </span>
            </span>
          </label>

          {backtestM.data?.rows?.length ? (
            <div className="mt-4 grid gap-2 lg:grid-cols-2">
              {backtestM.data.rows.map((row: any) => (
                <div
                  key={`backtest-${row.gameId}`}
                  className="rounded border border-[#2d6b45] bg-[#13261c] p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="bg-[#1a5c38] text-[#d4f5e2]">{row.gameType}</Badge>
                    <span className="font-medium text-[#e8f0ea]">{row.gameId}</span>
                    <span className="text-xs text-[#7fa892]">{row.gameDate ?? "—"}</span>
                    <Badge variant="outline" className="border-[#2d6b45] text-[#b8f0d0]">
                      {row.budgetKr} kr
                    </Badge>
                    <Badge variant="outline" className="border-[#2d6b45] text-[#b8f0d0]">
                      mål {Math.round(row.targetMinPayoutKr ?? (row.gameType === "dd" ? DEFAULT_DD_MIN_PAYOUT_KR : 30_000)).toLocaleString("sv-SE")} kr
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm text-[#b8f0d0]">
                    {row.correctLegs}/{row.totalLegs} rätt
                    {row.payoutAmountKr != null ? ` · ${formatCurrencyKr(row.payoutAmountKr)}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-[#7fa892]">{row.summary}</p>
                  {row.recommendedReason ? (
                    <p className="mt-1 text-xs text-[#b8f0d0]">{row.recommendedReason}</p>
                  ) : null}
                  {Array.isArray(row.lessons) && row.lessons.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs text-[#b8f0d0]">
                      {row.lessons.map((lesson: string, idx: number) => (
                        <li key={`${row.gameId}-lesson-${idx}`}>• {lesson}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {historyQ.isLoading ? (
          <div className="mt-4 grid gap-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 bg-[#1e3d2a]" />
            ))}
          </div>
        ) : visibleHistoryRows(historyQ.data?.rows).length ? (
          <div className="mt-4 space-y-3">
            {visibleHistoryRows(historyQ.data?.rows).map((row: any) => {
              const selections = systemSelectionsOf(row.system);
              const storedLegs = analysisLegsOf(row.legs);
              const hitSummary = hitSummaryOf(row.hitSummary);
              const postmortem = postmortemOf(row.postmortem);
              const resolvedLegs = resolvedLegsOf(row.result);
              const payoutRows = payoutRowsOf(row.payouts);
              return (
                <details
                  key={row.id}
                  className="rounded-lg border border-[#1e3d2a] bg-[#0c1410] p-3"
                >
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2">
                    <Badge className="bg-[#1a5c38] text-[#d4f5e2]">{row.gameType}</Badge>
                    {row.meta?.source === "historical-backtest" && (
                      <Badge variant="outline" className="border-[#66522a] text-[#f0c674]">
                        Backtest
                      </Badge>
                    )}
                    <span className="font-medium text-[#e8f0ea]">{row.gameId}</span>
                    <span className="text-xs text-[#7fa892]">
                      Sparad {formatDateTime(row.createdAt)}
                    </span>
                    {row.meta?.analysisVersion != null && (
                      <Badge variant="outline" className="border-[#2d6b45] text-[#b8f0d0]">
                        Analys #{row.meta.analysisVersion}
                      </Badge>
                    )}
                    {row.meta?.fullRaceDataStored && (
                      <Badge variant="outline" className="border-[#2d6b45] text-[#b8f0d0]">
                        {row.meta.fullRaceDataRaces ?? "?"} lopp · {row.meta.fullRaceDataStarts ?? "?"} starter sparade
                      </Badge>
                    )}
                    {row.resolvedAt ? (
                      <Badge variant="outline" className="border-[#2d6b45] text-[#b8f0d0]">
                        Resolve:ad {formatDateTime(row.resolvedAt)}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-[#66522a] text-[#f0c674]">
                        Väntar på facit
                      </Badge>
                    )}
                    {hitSummary?.correctLegs != null && hitSummary?.totalLegs != null && (
                      <span className="ml-auto text-sm text-[#b8f0d0]">
                        {hitSummary.correctLegs}/{hitSummary.totalLegs} rätt
                        {hitSummary.payoutAmountKr != null
                          ? ` · ${formatCurrencyKr(hitSummary.payoutAmountKr)}`
                          : ""}
                      </span>
                    )}
                  </summary>

                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-[#5ec98a]">
                          Prematch-system
                        </p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {selections.map((selection) => (
                            <div
                              key={`${row.id}-${selection.leg}`}
                              className="rounded border border-[#1e3d2a] px-3 py-2 text-sm"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-[#7fa892]">Avd {selection.leg}</span>
                                <span className="text-[10px] uppercase text-[#5ec98a]">
                                  {selection.type}
                                </span>
                              </div>
                              <p className="font-mono text-[#e8f0ea]">
                                {(selection.picks ?? []).join(", ")}
                              </p>
                              {selection.note && (
                                <p className="text-[11px] text-[#7fa892]">{selection.note}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {row.learningPrompt && (
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-[#5ec98a]">
                            Lärprompt när systemet skapades
                          </p>
                          <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[#7fa892]">
                            {row.learningPrompt}
                          </p>
                        </div>
                      )}

                      {storedLegs.length > 0 && (
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-[#5ec98a]">
                            Sparad hästtabell
                          </p>
                          <HorseAnalysisTables legs={storedLegs} compact />
                        </div>
                      )}
                    </div>

                    <div className="space-y-3">
                      {payoutRows.length > 0 && (
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-[#5ec98a]">
                            Utdelning
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {payoutRows.map((payout) => (
                              <Badge
                                key={`${row.id}-${payout.tier}`}
                                variant="outline"
                                className="border-[#2d6b45] text-[#b8f0d0]"
                              >
                                {payout.tier} rätt: {payout.text}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {resolvedLegs.length > 0 && (
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-[#5ec98a]">
                            Facit per avdelning
                          </p>
                          <div className="mt-2 space-y-2">
                            {resolvedLegs.map((leg: any) => {
                              const selection = selections.find((item) => item.leg === leg.leg);
                              const winners = Array.isArray(leg.winners) ? leg.winners : [];
                              const hit = winners.some((winner: number) => (selection?.picks ?? []).includes(winner));
                              return (
                                <div
                                  key={`${row.id}-leg-${leg.leg}`}
                                  className={`rounded border px-3 py-2 text-sm ${
                                    hit ? "border-[#2d6b45] bg-[#13261c]" : "border-[#533] bg-[#1a1010]"
                                  }`}
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-[#e8f0ea]">Avd {leg.leg}</span>
                                    <span className={hit ? "text-[#5ec98a]" : "text-[#f0c674]"}>
                                      System {(selection?.picks ?? []).join(", ") || "—"} · Vinnare {winners.join(", ") || "—"}
                                    </span>
                                  </div>
                                  {Array.isArray(leg.topFinishers) && leg.topFinishers.length > 0 && (
                                    <p className="mt-1 text-[11px] text-[#7fa892]">
                                      Topp: {leg.topFinishers
                                        .slice(0, 3)
                                        .map(
                                          (horse: any) =>
                                            `${horse.number}. ${horse.name}${horse.finalOdds != null ? ` (${horse.finalOdds.toFixed(2)} ggr)` : ""}`,
                                        )
                                        .join(" · ")}
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {postmortem && (
                        <div className="rounded border border-[#2d6b45] bg-[#13261c] p-3">
                          <p className="text-xs font-medium uppercase tracking-wide text-[#5ec98a]">
                            Postmortem
                          </p>
                          {postmortem.summary && (
                            <p className="mt-2 text-sm text-[#e8f0ea]">{postmortem.summary}</p>
                          )}
                          {Array.isArray(postmortem.why) && postmortem.why.length > 0 && (
                            <ul className="mt-2 space-y-1 text-xs text-[#7fa892]">
                              {postmortem.why.map((reason, idx) => (
                                <li key={`${row.id}-why-${idx}`}>• {reason}</li>
                              ))}
                            </ul>
                          )}
                          {postmortem.paceNotes && (
                            <p className="mt-2 text-xs text-[#b8f0d0]">
                              Tempo/loppbild: {postmortem.paceNotes}
                            </p>
                          )}
                          {Array.isArray(postmortem.signalsMissed) && postmortem.signalsMissed.length > 0 && (
                            <div className="mt-3">
                              <p className="text-xs font-medium uppercase tracking-wide text-[#5ec98a]">
                                Missade signaler
                              </p>
                              <ul className="mt-1 space-y-1 text-xs text-[#7fa892]">
                                {postmortem.signalsMissed.map((signal, idx) => (
                                  <li key={`${row.id}-signal-${idx}`}>• {signal}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {Array.isArray(postmortem.modelMistakes) && postmortem.modelMistakes.length > 0 && (
                            <div className="mt-3">
                              <p className="text-xs font-medium uppercase tracking-wide text-[#5ec98a]">
                                Modellfel
                              </p>
                              <ul className="mt-1 space-y-1 text-xs text-[#7fa892]">
                                {postmortem.modelMistakes.map((mistake, idx) => (
                                  <li key={`${row.id}-mistake-${idx}`}>• {mistake}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {Array.isArray(postmortem.lessons) && postmortem.lessons.length > 0 && (
                            <div className="mt-3">
                              <p className="text-xs font-medium uppercase tracking-wide text-[#5ec98a]">
                                Lärdomar
                              </p>
                              <ul className="mt-1 space-y-1 text-xs text-[#b8f0d0]">
                                {postmortem.lessons.map((lesson, idx) => (
                                  <li key={`${row.id}-lesson-${idx}`}>• {lesson}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {Array.isArray(postmortem.alternativeActions) && postmortem.alternativeActions.length > 0 && (
                            <div className="mt-3">
                              <p className="text-xs font-medium uppercase tracking-wide text-[#5ec98a]">
                                Vad systemet borde gjort
                              </p>
                              <ul className="mt-1 space-y-1 text-xs text-[#b8f0d0]">
                                {postmortem.alternativeActions.map((action, idx) => (
                                  <li key={`${row.id}-alt-${idx}`}>• {action}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        ) : (
          <p className="mt-4 text-sm text-[#7fa892]">
            Ingen sparad V85-, V86- eller DD-historik ännu. Kör en analys så lagras första snapshoten.
          </p>
        )}
      </Card>

      {!snapshot && !analyzeM.isPending && (
        <p className="text-center text-sm text-[#7fa892]">
          Välj datum och spel, klicka Analysera för att bygga system.
        </p>
      )}
    </div>
  );
}
