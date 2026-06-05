import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, Fragment, type ReactNode } from "react";
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
import { LegScratchedHorses } from "@/components/LegScratchedHorses";
import { SystemLegPicksWithOdds } from "@/components/SystemLegPicks";
import { HorseScoreMatrix } from "@/components/HorseScoreMatrix";
import {
  BiggestRiskNote,
  LegHitPctBadge,
  LegTipHitNote,
  SystemHitOutlookSummary,
} from "@/components/SystemHitOutlook";

export const Route = createFileRoute("/v86/")({
  component: RuleSelectablePage,
});

export type TravRuleDashboardProps = {
  title: string;
  description: string;
  badgeText?: string;
  extraIntro?: ReactNode;
};

function RuleSelectablePage() {
  return (
    <TravRuleDashboardPage
      title="Förbättrad plusstrategi"
      description="Optimerar budget och utdelningsmål mot jämnare månadsresultat med chans på storvinster."
      badgeText="Aktiv"
    />
  );
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(days: number) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

const DEFAULT_TRAV_BUDGET_KR = 600;
const DEFAULT_DD_BUDGET_KR = 150;
const DEFAULT_TRAV_MIN_PAYOUT_KR = 30_000;
const DEFAULT_DD_MIN_PAYOUT_KR = 1_500;
const DEFAULT_BACKTEST_GAMES = 50;

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

function formatDateOnly(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toLocaleDateString("sv-SE");
}

function formatKmTime(kmTime: string | null | undefined): string {
  if (!kmTime) return "—";
  // Already has minute prefix: "1.14,4a" or "1:14,4"
  if (/^\d+[.:]\d{2}/.test(kmTime)) {
    // Normalize to "1:14,4 a" format
    return kmTime.replace(/^(\d+)[.:](\d{2})[,.](\d)([av]?)$/, (_, m, s, t, method) =>
      method ? `${m}:${s},${t} ${method}` : `${m}:${s},${t}`,
    );
  }
  // Swedish shorthand without minute: "14,4a" → "1:14,4 a"
  const short = kmTime.match(/^(\d{2})[,.](\d)([av]?)$/);
  if (short) return short[3] ? `1:${short[1]},${short[2]} ${short[3]}` : `1:${short[1]},${short[2]}`;
  return kmTime;
}

function placementOrdinal(placement: number | null | undefined): string {
  if (placement == null || placement <= 0) return "?";
  if (placement === 1) return "1:a";
  if (placement === 2) return "2:a";
  if (placement === 3) return "3:e";
  return `${placement}:e`;
}

function bestKmTimeFromTravsport(
  starts: Array<{ kmTime?: string | null; kmTimeSeconds?: number | null; date?: string; withdrawn?: boolean }>,
) {
  const candidates = starts.filter((row) => !row.withdrawn && row.kmTimeSeconds != null);
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => (a.kmTimeSeconds ?? 9999) - (b.kmTimeSeconds ?? 9999))[0] ?? null;
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
  showBetColumn = false,
  showEdgeColumn = false,
}: {
  legs: ReturnType<typeof analysisLegsOf>;
  compact?: boolean;
  showBetColumn?: boolean;
  showEdgeColumn?: boolean;
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
                    {showBetColumn && <th className="px-2 py-1">Spel%</th>}
                    {showEdgeColumn && <th className="px-2 py-1">Edge</th>}
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
                      {showBetColumn && (
                        <td className="px-2 py-1">
                          {horse.betDistribution != null ? `${horse.betDistribution.toFixed(1)}%` : "—"}
                        </td>
                      )}
                      {showEdgeColumn && (
                        <td className="px-2 py-1">
                          {horse.valueEdgePct != null
                            ? `${horse.valueEdgePct >= 0 ? "+" : ""}${horse.valueEdgePct.toFixed(1)}%`
                            : "—"}
                        </td>
                      )}
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

export function TravRuleDashboardPage({
  title,
  description,
  badgeText = "Regelprofil",
  extraIntro,
}: TravRuleDashboardProps) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayIso);
  const [gameId, setGameId] = useState<string>("");
  const [budgetKr, setBudgetKr] = useState(DEFAULT_TRAV_BUDGET_KR);
  const [minPayout, setMinPayout] = useState(DEFAULT_TRAV_MIN_PAYOUT_KR);
  const [autoBudget, setAutoBudget] = useState(true);
  const [copied, setCopied] = useState(false);
  const [expandedHorse, setExpandedHorse] = useState<string | null>(null);
  const [showAllLegs, setShowAllLegs] = useState<Record<number, boolean>>({});
  const [backtestType, setBacktestType] = useState<"V85" | "V86" | "dd">("dd");
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
    onSuccess: (snapshot) => {
      if (snapshot.meta?.historySaveError) {
        toast.warning(`Analys klar, men historiken sparades inte. ${snapshot.meta.historySaveError}`);
      } else {
        toast.success("Analys klar och sparad i historiken");
      }
      queryClient.invalidateQueries({ queryKey: ["trav-history", historyFilterType] });
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
      queryClient.invalidateQueries({ queryKey: ["trav-history", historyFilterType] });
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
      queryClient.invalidateQueries({ queryKey: ["trav-history", historyFilterType] });
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
  const showMarketView = true;
  const dataModelRows = [
    {
      label: "Form och nivå",
      detail: "Senaste starter, placeringar, formtrend, starter totalt och vinstprocent (ATG + Travsport).",
    },
    {
      label: "Tempo/trip",
      detail: "Byggs från historiska starter: framspår/bakspår + resultat ger en profil (front/closer/versatile).",
    },
    {
      label: "Galopprisk",
      detail: "Beräknas från andel galopp/disk i historiken, med extra vikt på de senaste starterna.",
    },
    {
      label: "Resa och dagsstatus",
      detail: "Resa senaste start är proxy från historik. Live-status och utrustningsändringar hämtas automatiskt från ATG.",
    },
    {
      label: "Saknad data",
      detail: "Saknade fält visas i coverage/missing notes. Veterinär, värmning och exakta splits finns inte i öppna API:er.",
    },
  ] as const;
  const activePrompt = useMemo(() => {
    const currentType = snapshot?.game.type ?? selectedGame?.type;
    if (currentType !== "V85") return null;
    const promptScope = `trav:${currentType}:rule6`;
    const fromHistory = historyQ.data?.prompts?.find((item) => item.game_type === promptScope)?.prompt_text;
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
      <Card className="border-[#2d6b45] bg-[#13261c] p-4 shadow-none">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[#d4f5e2]">
              {title}
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-[#b8f0d0]">
              {description}
            </p>
          </div>
          <Badge variant="outline" className="border-[#2d6b45] text-[#b8f0d0]">
            {badgeText}
          </Badge>
        </div>
      </Card>

      {extraIntro}

      <Card className="border-[#1e3d2a] bg-[#111c16] p-4 shadow-none">
        <h3 className="font-medium text-[#d4f5e2]">Så läser modellen datan</h3>
        <p className="mt-1 text-xs text-[#7fa892]">
          Allt nedan hämtas automatiskt från öppna källor när omgången analyseras.
        </p>
        <div className="mt-3 space-y-2 text-sm text-[#c8ddd2]">
          {dataModelRows.map((row) => (
            <p key={row.label}>
              <span className="text-[#5ec98a]">{row.label}:</span> {row.detail}
            </p>
          ))}
        </div>
      </Card>

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
                {visibleGames.map((g: GameOption) => {
                  const ddAvoidTracks = ["Boden", "Romme", "Bergsåker", "Östersund", "Gävle"];
                  const trackLabel = g.type === "dd" && g.trackNames ? ` · ${g.trackNames}` : "";
                  const isDdAvoid = g.type === "dd" && ddAvoidTracks.some(t => g.trackNames?.includes(t));
                  return (
                    <option key={g.id} value={g.id}>
                      {isDdAvoid ? "⛔ " : ""}
                      {g.typeLabel}
                      {g.startLabel ? ` · ${g.startLabel}` : ""}
                      {trackLabel}
                      {isDdAvoid ? " (undvik)" : ""}
                      {" — "}{g.status}
                    </option>
                  );
                })}
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
                    ? "Modellen väljer själv 30 kr för DD och siktar på en månadsstabil profil."
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
          {(() => {
            if (snapshot.game.type !== "dd") return null;
            const ddTrack = snapshot.game.races?.[0]?.track?.name ?? "";
            const avoidReasons: Record<string, string> = {
              Boden: "Alla träffar betalar under insatsen — favoriter vinner alltid och pool betalar för lite. ROI -89%.",
              Romme: "60% träffprocent men snittutbetalning 156 kr på 150 kr insats. Favoriter dominerar poolen. ROI -38%.",
              Bergsåker: "Modellen missar leg1-vinnaren i 57% av omgångarna. Oförutsägbara utommarker. ROI -55%.",
              Östersund: "Extremt låga utbetalningar vid träff (snitt 54 kr). Undvik. ROI -86%.",
              Gävle: "Leg2-vinnaren utanför vår lista i hälften av omgångarna. Svårpredikterad bana. ROI -33%.",
            };
            const reason = avoidReasons[ddTrack];
            if (!reason) return null;
            return (
              <div className="flex items-start gap-3 rounded-md border border-red-700 bg-red-950/60 px-4 py-3 text-red-300">
                <span className="mt-0.5 text-lg leading-none">⛔</span>
                <div>
                  <p className="font-semibold text-red-200">Undvik DD på {ddTrack}</p>
                  <p className="mt-0.5 text-sm">{reason}</p>
                </div>
              </div>
            );
          })()}
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
              <div className="min-w-0 flex-1">
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
                <BiggestRiskNote outlook={snapshot.system.hitOutlook} />
              </div>
              <SystemHitOutlookSummary
                outlook={snapshot.system.hitOutlook}
                gameType={snapshot.game.type}
              />
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
              {snapshot.system.selections.map((s) => {
                const raceForLeg = snapshot.raceData?.find((race) => race.leg === s.leg);
                const legAnalysis = snapshot.legs.find((leg) => leg.leg === s.leg);
                return (
                <div
                  key={s.leg}
                  className="rounded-lg border border-[#1e3d2a] bg-[#0c1410] px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[#7fa892]">
                      Avd {s.leg}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <LegHitPctBadge outlook={snapshot.system.hitOutlook} leg={s.leg} />
                      <Badge
                        variant="outline"
                        className="border-[#2d6b45] text-[10px] text-[#5ec98a]"
                      >
                        {s.type}
                      </Badge>
                    </div>
                  </div>
                  <SystemLegPicksWithOdds leg={legAnalysis} picks={s.picks} />
                  <LegScratchedHorses
                    variant="compact"
                    starts={raceForLeg?.starts}
                    scratchingNumbers={raceForLeg?.scratchings}
                  />
                  {s.note && (
                    <p className="mt-1 text-[11px] leading-snug text-[#7fa892]">
                      {s.note}
                    </p>
                  )}
                </div>
              );
              })}
            </div>
          </Card>

          {snapshot.systemAlt && snapshot.game.type === "dd" && (
            <Card className="border-[#3d5a48] bg-[#152a20] p-4 shadow-none">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold text-[#d4f5e2]">
                    DD-RAD 2 · {snapshot.systemAlt.costKr.toFixed(0)} kr
                  </h2>
                  <p className="text-sm text-[#7fa892]">
                    {snapshot.systemAlt.rows.toLocaleString("sv-SE")} rader ×{" "}
                    {formatRowPrice(snapshot.game.type)} kr
                  </p>
                  <p className="mt-2 max-w-2xl text-xs text-[#7fa892]">
                    {snapshot.systemAlt.estimatedPayoutNote}
                  </p>
                  <p className="mt-1 text-xs text-[#b8f0d0]">
                    Exakt 1 gemensam häst per lopp jämfört med DD-RAD 1.
                  </p>
                  <BiggestRiskNote outlook={snapshot.systemAlt.hitOutlook} />
                </div>
                <SystemHitOutlookSummary
                  outlook={snapshot.systemAlt.hitOutlook}
                  gameType={snapshot.game.type}
                />
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {snapshot.systemAlt.selections.map((s) => {
                  const raceForLeg = snapshot.raceData?.find((race) => race.leg === s.leg);
                  const legAnalysis = snapshot.legs.find((leg) => leg.leg === s.leg);
                  return (
                    <div
                      key={`alt-${s.leg}`}
                      className="rounded-lg border border-[#1e3d2a] bg-[#0c1410] px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-[#7fa892]">Avd {s.leg}</span>
                        <Badge variant="outline" className="border-[#2d6b45] text-[10px] text-[#5ec98a]">
                          {s.type}
                        </Badge>
                      </div>
                      <SystemLegPicksWithOdds leg={legAnalysis} picks={s.picks} />
                      <LegScratchedHorses
                        variant="compact"
                        starts={raceForLeg?.starts}
                        scratchingNumbers={raceForLeg?.scratchings}
                      />
                      {s.note && (
                        <p className="mt-1 text-[11px] leading-snug text-[#7fa892]">{s.note}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

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
              full hästrank med vinstprocent, spelprocent och kommentar.
              Först när ranken är klar byggs systemet från samma ordning.
            </p>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            {snapshot.legs.map((leg) => {
              const showAll = Boolean(showAllLegs[leg.leg]);
              const visibleHorses = showAll ? leg.horses : leg.horses.slice(0, 6);
              const raceDataForLeg = snapshot.raceData?.find((race) => race.leg === leg.leg);
              const legSelection = snapshot.system.selections.find((s) => s.leg === leg.leg);
              const tipPicks = legSelection?.picks;
              return (
                <Card
                  key={leg.leg}
                  className="border-[#1e3d2a] bg-[#111c16] p-4 shadow-none"
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-medium text-[#d4f5e2]">
                      Avd {leg.leg}
                      {leg.raceName ? ` — ${leg.raceName}` : ""}
                    </h3>
                    <div className="flex items-center gap-2">
                      <LegHitPctBadge outlook={snapshot.system.hitOutlook} leg={leg.leg} />
                      <Badge
                        variant="outline"
                        className="border-[#1e3d2a] text-[#7fa892] uppercase"
                      >
                        {leg.recommendation}
                      </Badge>
                    </div>
                  </div>
                  <LegTipHitNote
                    outlook={snapshot.system.hitOutlook}
                    leg={leg.leg}
                    picks={tipPicks}
                  />
                  {leg.tipNote && (
                    <p className="mb-2 text-xs text-[#7fa892]">{leg.tipNote}</p>
                  )}
                  <LegScratchedHorses
                    starts={raceDataForLeg?.starts}
                    scratchingNumbers={raceDataForLeg?.scratchings}
                  />
                  <ul className="space-y-1">
                    {visibleHorses.map((h) => {
                      const key = `${leg.leg}-${h.number}`;
                      const open = expandedHorse === key;
                      const isPicked = tipPicks?.includes(h.number) ?? false;
                      const startData = raceDataForLeg?.starts?.find((start) => start.number === h.number);
                      const tsProfile = startData?.travsportProfile ?? null;
                      const bestKm = tsProfile ? bestKmTimeFromTravsport(tsProfile.starts ?? []) : null;
                      const latestStart = tsProfile?.recentStarts?.[0];
                      const shoeChanged =
                        Boolean(startData?.horse?.shoes?.front?.changed) || Boolean(startData?.horse?.shoes?.back?.changed);
                      const sulkyChanged = Boolean(startData?.horse?.sulky?.type?.changed);
                      const liveStatus = startData?.scratched
                        ? "Struken"
                        : raceDataForLeg?.status
                          ? `Status: ${raceDataForLeg.status}`
                          : "Anmäld";
                      const equipmentStatus = shoeChanged || sulkyChanged
                        ? `${shoeChanged ? "Skor ändrat" : ""}${shoeChanged && sulkyChanged ? " + " : ""}${sulkyChanged ? "vagn ändrad" : ""}`
                        : "Ingen registrerad ändring";
                      const betText = h.betDistribution != null ? `${h.betDistribution.toFixed(1)}% spel` : null;
                      const winText = `${(h.estimatedWinPct ?? 0).toFixed(1)}% vinst`;
                      const horseFacts: Array<{ label: string; value: string; sourceLabel: string; sourceUrl: string }> = [
                        {
                          label: "Folkets spel%",
                          value: betText ?? "—",
                          sourceLabel: "ATG Racinginfo API",
                          sourceUrl: "https://www.atg.se/services/racinginfo/v1/api",
                        },
                        {
                          label: "Spår idag",
                          value: startData?.postPosition != null ? String(startData.postPosition) : "—",
                          sourceLabel: "ATG Racinginfo API",
                          sourceUrl: "https://www.atg.se/services/racinginfo/v1/api",
                        },
                        {
                          label: "Distans idag",
                          value: raceDataForLeg?.distance ? `${raceDataForLeg.distance} m` : "—",
                          sourceLabel: "ATG Racinginfo API",
                          sourceUrl: "https://www.atg.se/services/racinginfo/v1/api",
                        },
                        {
                          label: "Bästa km-tid",
                          value: bestKm
                            ? `${formatKmTime(bestKm.kmTime) ?? `${bestKm.kmTimeSeconds?.toFixed(1)}s`} · ${formatDateOnly(bestKm.date)}`
                            : "Saknas i historik",
                          sourceLabel: "Travsport Web API",
                          sourceUrl: "https://api.travsport.se/webapi",
                        },
                        {
                          label: "Galopprisk",
                          value:
                            h.gallopRiskLevel && h.gallopRiskScore != null
                              ? `${h.gallopRiskLevel} (${Math.round(h.gallopRiskScore * 100)}% stabilitet)`
                              : "—",
                          sourceLabel: "Travsport Web API",
                          sourceUrl: "https://api.travsport.se/webapi",
                        },
                        {
                          label: "Tempo/trip-profil",
                          value:
                            h.tempoTripStyle && h.tempoTripScore != null
                              ? `${h.tempoTripStyle} (${Math.round(h.tempoTripScore * 100)}%)`
                              : "—",
                          sourceLabel: "Travsport Web API",
                          sourceUrl: "https://api.travsport.se/webapi",
                        },
                        {
                          label: "Senaste start",
                          value: latestStart
                            ? `${formatDateOnly(latestStart.date)} · plac ${latestStart.placementDisplay || latestStart.placement || "?"}`
                            : "Saknas",
                          sourceLabel: "Travsport Web API",
                          sourceUrl: "https://api.travsport.se/webapi",
                        },
                        {
                          label: "Resa senaste start",
                          value: latestStart?.tripComment ?? "Saknas i rådata",
                          sourceLabel: "Travsport Web API",
                          sourceUrl: "https://api.travsport.se/webapi",
                        },
                        {
                          label: "Utrustning idag",
                          value: equipmentStatus,
                          sourceLabel: "ATG Racinginfo API",
                          sourceUrl: "https://www.atg.se/services/racinginfo/v1/api",
                        },
                        {
                          label: "Live-status",
                          value: liveStatus,
                          sourceLabel: "ATG Racinginfo API",
                          sourceUrl: "https://www.atg.se/services/racinginfo/v1/api",
                        },
                        {
                          label: "Värmning/veterinär",
                          value: "Ej exponerat i öppna API-flöden",
                          sourceLabel: "Coverage-status",
                          sourceUrl: "https://www.travsport.se/",
                        },
                      ];
                      return (
                        <Fragment key={h.number}>
                          <li>
                            <button
                              type="button"
                              onClick={() => setExpandedHorse(open ? null : key)}
                              className={`w-full rounded px-1 py-1.5 text-left hover:bg-[#1a2e22] ${isPicked ? "bg-[#1a2e22]/80 ring-1 ring-[#2d6b45]" : ""}`}
                            >
                              {/* Rad 1: nummer · namn · markering | odds */}
                              <div className="flex items-baseline justify-between gap-2">
                                <span className="text-sm text-[#e8f0ea]">
                                  <span className="font-mono text-[#5ec98a]">{h.number}.</span>{" "}
                                  {h.name}
                                  {isPicked && (
                                    <span className="ml-1.5 rounded bg-[#2d6b45]/40 px-1 py-0.5 text-[10px] font-medium text-[#b8f0d0]">
                                      markering
                                    </span>
                                  )}
                                </span>
                                {h.winOdds != null && (
                                  <span className="shrink-0 font-mono text-sm text-[#d4f5e2]">
                                    odds {h.winOdds.toFixed(2)}
                                  </span>
                                )}
                              </div>
                              {/* Rad 2: modell% | folkspel% · vinst% */}
                              <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px]">
                                <span className="text-[#7fa892]">
                                  {(h.combinedScore * 100).toFixed(0)}%
                                  {h.estimatedWinPct != null && ` · modell ${h.estimatedWinPct.toFixed(0)}%`}
                                </span>
                                <span className="shrink-0 tabular-nums">
                                  {h.betDistribution != null && h.betDistribution > 0 && (
                                    <span className="font-medium text-[#b8f0d0]">
                                      {h.betDistribution.toFixed(1)}% spel
                                    </span>
                                  )}
                                  {h.betDistribution != null && h.betDistribution > 0 && (
                                    <span className="text-[#7fa892]"> · {winText}</span>
                                  )}
                                  {(h.betDistribution == null || h.betDistribution === 0) && (
                                    <span className="text-[#7fa892]">{winText}</span>
                                  )}
                                </span>
                              </div>
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
                              {tsProfile?.recentStarts && tsProfile.recentStarts.length > 0 && (
                                <div>
                                  <p className="font-medium text-[#5ec98a]">Senaste {Math.min(3, tsProfile.recentStarts.length)} starter</p>
                                  <div className="mt-1 space-y-1">
                                    {tsProfile.recentStarts.slice(0, 3).map((s, i) => {
                                      const resultLabel = s.galloped
                                        ? "G"
                                        : s.disqualified
                                          ? "DQ"
                                          : s.withdrawn
                                            ? "–"
                                            : placementOrdinal(s.placement);
                                      const resultColor =
                                        s.galloped || s.disqualified || s.withdrawn
                                          ? "text-[#f0a070]"
                                          : s.placement === 1
                                            ? "text-[#5ec98a] font-bold"
                                            : s.placement != null && s.placement <= 3
                                              ? "text-[#b8f0d0] font-medium"
                                              : "text-[#c8ddd2]";
                                      return (
                                        <div key={i} className="rounded bg-[#0d1f14] px-2 py-1">
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="text-[#7fa892]">{s.displayDate || s.date}</span>
                                            <span className={resultColor}>{resultLabel}</span>
                                            <span className="font-mono text-[#c8ddd2]">{formatKmTime(s.kmTime)}</span>
                                            <span className="text-[#7fa892]">
                                              {s.distance ? `${s.distance}m` : ""}
                                              {s.startPosition ? ` · sp${s.startPosition}` : ""}
                                            </span>
                                          </div>
                                          {s.tripComment && (
                                            <p className="mt-0.5 text-[10px] italic text-[#5a7a68]">{s.tripComment}</p>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                              <div>
                                <p className="font-medium text-[#5ec98a]">Relevanta hästfakta</p>
                                {horseFacts.map((fact) => (
                                  <div
                                    key={`${key}-${fact.label}`}
                                    className="flex justify-between gap-2 text-[#c8ddd2]"
                                  >
                                    <span>{fact.label}</span>
                                    <span>
                                      {fact.value} · källa:{" "}
                                      <a
                                        href={fact.sourceUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-[#5ec98a] hover:underline"
                                      >
                                        {fact.sourceLabel}
                                      </a>
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
                      Skräll: {leg.skrellSpike.number}. {leg.skrellSpike.name}
                      {leg.skrellSpike.betDistribution != null ? ` (${leg.skrellSpike.betDistribution.toFixed(1)}%)` : ""}
                    </p>
                  )}
                </Card>
              );
            })}
          </div>

          <Card className="border-[#2d6b45] bg-[#13261c] p-4 shadow-none">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[#d4f5e2]">
                  Poängsystem — häst &amp; kusk
                </h2>
                <p className="mt-1 max-w-2xl text-sm text-[#b8f0d0]">
                  Varje häst ratas på 24 parametrar. Häst 62% + Kusk 38% = Totalpoäng. Stjärnan (★) är modellens val per lopp.
                </p>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-[10px] text-[#7fa892]">
                <div>
                  <span className="font-semibold text-[#5ec98a]">Häst (16 par.):</span>{" "}
                  Km-tid · Senaste starter · Distans · Loppklass · Formkurva · Tempo/trip ·
                  Galopprisk · Spår · Bana · Klassnivå · Uthållighet · Restitution ·
                  Tränarform · Utrustning · Ålder · Underlag
                </div>
                <div>
                  <span className="font-semibold text-[#5ec98a]">Kusk (8 par.):</span>{" "}
                  Form · Formtrend · Form m. häst · Körstil · Spurter · Bana · Storseger · Tränare
                </div>
              </div>
            </div>
            <div className="mt-4">
              <HorseScoreMatrix legs={snapshot.legs} />
            </div>
          </Card>

          <Card className="border-[#1e3d2a] bg-[#111c16] p-4 shadow-none">
            <div className="mb-2">
              <h3 className="font-medium text-[#d4f5e2]">Prognostabell för alla hästar</h3>
              <p className="text-xs text-[#7fa892]">
                Varje lopp sparas med full hästrank, förväntad slutbild och kort analys så att det kan tränas vidare senare.
              </p>
            </div>
            <HorseAnalysisTables
              legs={analysisLegsOf(snapshot.legs)}
              showBetColumn
              showEdgeColumn={showMarketView}
            />
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

          {snapshot.meta?.rule && (
            <Card className="border-[#1e3d2a] bg-[#111c16] p-4 shadow-none">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium text-[#d4f5e2]">Regelstatus och datatäckning</h3>
                  <p className="mt-1 text-xs text-[#7fa892]">
                    {snapshot.meta.rule.label} · version {snapshot.meta.rule.version}
                    {snapshot.meta.rule.partialExpertMode ? " · partial expert mode" : ""}
                  </p>
                </div>
                <Badge variant="outline" className="border-[#2d6b45] text-[#b8f0d0]">
                  {snapshot.meta.rule.usesMarketData ? "Marknad aktiv" : "Datadriven"}
                </Badge>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {snapshot.meta.rule.coverage.map((group) => (
                  <div key={group.id} className="rounded border border-[#1e3d2a] bg-[#0c1410] px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-[#d4f5e2]">{group.label}</span>
                      <Badge
                        variant="outline"
                        className={
                          group.status === "available"
                            ? "border-[#2d6b45] text-[#5ec98a]"
                            : group.status === "partial"
                              ? "border-[#66522a] text-[#f0c674]"
                              : "border-[#533] text-[#ffb4b4]"
                        }
                      >
                        {group.status}
                      </Badge>
                    </div>
                    {group.detail && <p className="mt-1 text-xs text-[#7fa892]">{group.detail}</p>}
                  </div>
                ))}
              </div>
              {snapshot.expertConsensus && snapshot.expertConsensus.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-[#5ec98a]">
                    Expertkonsensus
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {snapshot.expertConsensus.slice(0, 8).map((item) => (
                      <Badge
                        key={`${item.leg}-${item.horseNumber}`}
                        variant="outline"
                        className="border-[#2d6b45] text-[#b8f0d0]"
                      >
                        Avd {item.leg}: {item.horseNumber}. {item.horseName} · {item.consensusPoints.toFixed(1)}p
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {snapshot.meta.rule.missingDataNotes && snapshot.meta.rule.missingDataNotes.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-[#7fa892]">
                  {snapshot.meta.rule.missingDataNotes.map((note, index) => (
                    <li key={`${snapshot.game.id}-missing-${index}`}>• {note}</li>
                  ))}
                </ul>
              )}
            </Card>
          )}

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
                onChange={(e) => setBacktestType(e.target.value as "V85" | "V86" | "dd")}
                className="flex h-10 w-full rounded-md border border-[#1e3d2a] bg-[#111c16] px-3 text-sm text-[#e8f0ea]"
              >
                <option value="V85">V85</option>
                <option value="V86">V86</option>
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
                max={500}
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
                  ? "Varje DD-omgång väljer då själv 30 kr med fokus på månadsstabilitet."
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
                    {row.meta?.rule?.label && (
                      <Badge variant="outline" className="border-[#2d6b45] text-[#b8f0d0]">
                        {row.meta.rule.label}
                      </Badge>
                    )}
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
                          <HorseAnalysisTables
                            legs={storedLegs}
                            compact
                            showBetColumn
                            showEdgeColumn={
                              row.meta?.rule?.id === "rule2" ||
                              row.meta?.rule?.id === "rule5" ||
                              row.meta?.rule?.id === "rule6"
                            }
                          />
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
