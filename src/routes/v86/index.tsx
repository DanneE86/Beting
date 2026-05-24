import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, Fragment } from "react";
import {
  v86Analyze,
  v86ListGames,
  pickDefaultV85Game,
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
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/v86/")({
  component: V86Dashboard,
});

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatMarks(snapshot: FetchSnapshot): string {
  return snapshot.system.selections
    .map((s) => s.picks.join(","))
    .join("\n");
}

function V86Dashboard() {
  const [date, setDate] = useState(todayIso);
  const [gameId, setGameId] = useState<string>("");
  const [budgetKr, setBudgetKr] = useState(400);
  const [minPayout, setMinPayout] = useState(30_000);
  const [copied, setCopied] = useState(false);
  const [expandedHorse, setExpandedHorse] = useState<string | null>(null);

  const gamesQ = useQuery({
    queryKey: ["v86-games", date],
    queryFn: () => v86ListGames({ data: { date } }),
  });

  const games = gamesQ.data?.games ?? [];
  const selectedGame = games.find((g) => g.id === gameId);

  useEffect(() => {
    if (!games.length) return;
    const preferred =
      pickDefaultV85Game(games) ??
      games.find((g) => g.type === "dd") ??
      games[0];
    if (preferred && (!gameId || !games.some((g) => g.id === gameId))) {
      setGameId(preferred.id);
      if (preferred.type === "dd") {
        setBudgetKr(50);
        setMinPayout(5_000);
      } else if (preferred.type === "V85") {
        setBudgetKr(400);
        setMinPayout(30_000);
      }
    }
  }, [games, gameId]);

  useEffect(() => {
    if (!selectedGame) return;
    if (selectedGame.type === "dd") {
      setBudgetKr((b) => (b === 400 ? 50 : b));
      setMinPayout((m) => (m === 30_000 ? 5_000 : m));
    }
  }, [selectedGame?.id, selectedGame?.type]);

  const analyzeM = useMutation({
    mutationFn: () =>
      v86Analyze({
        data: {
          date,
          gameId: gameId || undefined,
          budgetKr,
          targetMinPayoutKr: minPayout,
        },
      }),
    onError: (e: Error) => toast.error(e.message),
    onSuccess: () => toast.success("Analys klar"),
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
                {games.length === 0 && (
                  <option value="">Inget V85 eller DD denna dag</option>
                )}
                {games.map((g: GameOption) => (
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
              min={25}
              max={10000}
              step={25}
              value={budgetKr}
              onChange={(e) => setBudgetKr(Number(e.target.value))}
              className="border-[#1e3d2a] bg-[#0c1410] text-[#e8f0ea]"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[#7fa892]">Målutdelning (kr)</Label>
            <Input
              type="number"
              min={5000}
              step={5000}
              value={minPayout}
              onChange={(e) => setMinPayout(Number(e.target.value))}
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
                {snapshot.meta.isSaturdayRound ? " (lördag)" : ""}
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
                  {snapshot.game.type === "dd" ? "1" : "0,25"} kr
                  {snapshot.system.skrellSpikeLeg != null &&
                    ` · Skräll-spik avd ${snapshot.system.skrellSpikeLeg}`}
                </p>
                <p className="mt-2 max-w-2xl text-xs text-[#7fa892]">
                  {snapshot.system.estimatedPayoutNote}
                </p>
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

          <div className="grid gap-4 lg:grid-cols-2">
            {snapshot.legs.map((leg) => (
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
                  {leg.horses.slice(0, 6).map((h) => {
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
                {leg.skrellSpike && (
                  <p className="mt-3 flex items-center gap-1 text-xs text-[#f0c674]">
                    <TrendingUp className="h-3.5 w-3.5" />
                    Skräll: {leg.skrellSpike.number}. {leg.skrellSpike.name} (
                    {leg.skrellSpike.betDistribution.toFixed(1)}%)
                  </p>
                )}
              </Card>
            ))}
          </div>

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

      {!snapshot && !analyzeM.isPending && (
        <p className="text-center text-sm text-[#7fa892]">
          Välj datum och spel, klicka Analysera för att bygga system.
        </p>
      )}
    </div>
  );
}
