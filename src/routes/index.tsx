import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useRef, useState } from "react";
import {
  getTodayMatches,
  getLeague,
  getNextRound,
  getLineups,
  LEAGUES,
} from "@/lib/fotmob.functions";
import {
  getStryktipset,
  analyzeStryktipsetMatch,
  recommendSpikar,
  buildSystem,
} from "@/lib/stryktipset.functions";
import { BttsDisplay } from "@/components/BttsDisplay";
import { MatchAnalysisDisplay } from "@/components/MatchAnalysisDisplay";
import type { BttsCall } from "@/lib/prediction-meta";
import type { MatchAnalysisSections } from "@/lib/match-analysis";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Activity,
  Trophy,
  Users,
  Target,
  Calendar,
  Sparkles,
  Loader2,
  Ticket,
  Brain,
} from "lucide-react";
import { getLeagueLearning, getHistory, resolveResults, getTodayTips, generateTodayPredictions, hideResolvedFromToday } from "@/lib/learning.functions";
import { getLeaguePrompts, updateLeaguePrompt, analyzeAndUpdateLeaguePrompts } from "@/lib/prompts.functions";
import { Textarea } from "@/components/ui/textarea";
import { backfillAllLeagues, getAllLeagueSeasonStatus, archiveSeasonIfChanged } from "@/lib/season-archive.functions";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import {
  PredictionResultsTable,
  type PredictionRow,
} from "@/components/PredictionResultsTable";
import { MatchDateTime } from "@/components/MatchDateTime";
import { ProbBar } from "@/components/ProbBar";
import { LeagueSelect } from "@/components/LeagueSelect";
import { LeagueFilterBar } from "@/components/LeagueFilterBar";
import { SkeletonGrid, EmptyState, MiniStat } from "@/components/common";


// Cuper sist, övriga ligor alfabetiskt
const CUP_PREFIXES = ["uefa.", "conmebol.", "fifa."];
function isCupLeague(id: string) {
  return CUP_PREFIXES.some((p) => id.startsWith(p));
}
function sortLeaguesCupsLast<T extends { id: string; name: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const ac = isCupLeague(a.id) ? 1 : 0;
    const bc = isCupLeague(b.id) ? 1 : 0;
    if (ac !== bc) return ac - bc;
    return a.name.localeCompare(b.name, "sv");
  });
}



export const Route = createFileRoute("/")({
  component: Dashboard,
});

type LeagueId = (typeof LEAGUES)[number]["id"];

function Dashboard() {
  const [leagueId, setLeagueId] = useState<LeagueId>("eng.1");
  const [liveLeagueFilter, setLiveLeagueFilter] = useState<string>("all");
  const queryClient = useQueryClient();

  const matchesQ = useQuery({
    queryKey: ["matches-today"],
    queryFn: () => getTodayMatches(),
    refetchInterval: 30_000,
  });

  const nextRoundQ = useQuery({
    queryKey: ["next-round"],
    queryFn: () => getNextRound(),
    enabled: false,
    staleTime: 5 * 60_000,
  });

  const leagueQ = useQuery({
    queryKey: ["league", leagueId],
    queryFn: () => getLeague({ data: { id: leagueId } }),
    refetchInterval: 60_000,
  });

  // Säsongsstatus + auto-backfill av historisk data (3 år) första gången
  const seasonStatusQ = useQuery({
    queryKey: ["season-status"],
    queryFn: () => getAllLeagueSeasonStatus(),
    staleTime: 5 * 60_000,
  });
  const statusByLeague = new Map(
    (seasonStatusQ.data ?? []).map((s) => [s.leagueId, s]),
  );
  const backfillTriggered = useRef(false);
  useEffect(() => {
    if (backfillTriggered.current) return;
    const status = seasonStatusQ.data;
    if (!status) return;
    const missing = status.filter((s) => !s.backfilled);
    if (missing.length === 0) return;
    backfillTriggered.current = true;
    toast.info(`Hämtar 3 års historik för ${missing.length} ligor i bakgrunden…`);
    backfillAllLeagues({ data: { years: 3 } })
      .then((res) => {
        const okCount = res.results.filter((r) => r.ok).length;
        toast.success(`Historik hämtad för ${okCount}/${res.results.length} ligor`);
        queryClient.invalidateQueries({ queryKey: ["season-status"] });
      })
      .catch((e) => toast.error(`Backfill misslyckades: ${e.message}`));
    // Kör säsongs-arkivering parallellt (snabbt — bara DB-jämförelse)
    for (const lg of LEAGUES) {
      archiveSeasonIfChanged({ data: { leagueId: lg.id } }).catch(() => {});
    }
  }, [seasonStatusQ.data, queryClient]);


  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  const bulkPredict = useMutation({
    mutationFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const matches: any[] = [];
      for (const lg of matchesQ.data?.leagues ?? []) {
        for (const m of lg.matches) {
          if (m.state === "post") continue;
          if (!m.homeId || !m.awayId || !m.utcTime) continue;
          if (new Date(m.utcTime).toISOString().slice(0, 10) !== today) continue;
          // Hoppa över de som redan är cachade
          if (queryClient.getQueryData(["predict", m.id])) continue;
          matches.push(m);
        }
      }
      setBulkProgress({ done: 0, total: matches.length });
      if (matches.length === 0) return { ran: 0 };

      const CONCURRENCY = 3;
      let i = 0;
      let done = 0;
      const worker = async () => {
        while (i < matches.length) {
          const m = matches[i++];
          try {
            await queryClient.fetchQuery({
              queryKey: ["predict", m.id],
              queryFn: () => fetchPrediction(m),
              staleTime: Infinity,
              retry: false,
            });
          } catch (e) {
            // tystas — varje kort visar sitt eget fel
          }
          done++;
          setBulkProgress({ done, total: matches.length });
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, matches.length) }, worker));
      return { ran: matches.length };
    },
    onSuccess: (r) => {
      if (r.ran === 0) toast.info("Alla matcher har redan en prognos.");
      else toast.success(`AI-prognoser genererade för ${r.ran} matcher.`);
      setTimeout(() => setBulkProgress(null), 2000);
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setBulkProgress(null);
    },
  });

  return (
    <main className="min-h-screen">
      <Toaster theme="dark" position="top-right" />
      <header className="border-b border-border/60 backdrop-blur-md bg-background/40 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-md bg-primary text-primary-foreground grid place-items-center font-display font-bold">
              P
            </div>
            <div>
              <h1 className="font-display text-xl leading-none">PitchData</h1>
              <p className="text-xs text-muted-foreground mt-1">
                Fotbollsstatistik för betting
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="size-2 rounded-full bg-live live-dot" />
            Live data via ESPN (öppet API)
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* League switcher */}
        <div className="space-y-3">
          {(["Europa", "Sydamerika", "Nordamerika", "Asien", "Australien", "Internationellt"] as const).map((region) => {
            const items = sortLeaguesCupsLast(LEAGUES.filter((l) => (l as any).region === region));
            if (items.length === 0) return null;
            return (
              <div key={region} className="flex flex-wrap items-center gap-3">
                <span className="text-xs uppercase tracking-widest text-muted-foreground w-28 shrink-0">
                  {region}
                </span>
                {items.map((l) => {
                  const st = statusByLeague.get(l.id);
                  return (
                    <button
                      key={l.id}
                      onClick={() => setLeagueId(l.id)}
                      className={`relative px-4 py-2 rounded-md text-sm font-medium border transition ${
                        leagueId === l.id
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card border-border hover:border-primary/50"
                      }`}
                    >
                      {l.name}
                      {st?.isNewSeason && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-1.5 py-0.5 text-[10px] font-display uppercase tracking-wide">
                          <Sparkles className="size-2.5" /> Ny säsong
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        <Tabs defaultValue="live" className="space-y-6">
          <TabsList className="bg-card/60 border border-border flex-wrap h-auto">
            <TabsTrigger value="live" className="gap-2">
              <Activity className="size-4" /> Idag & Live
            </TabsTrigger>
            <TabsTrigger value="today-tips" className="gap-2">
              <Sparkles className="size-4" /> Dagens tips
            </TabsTrigger>
            <TabsTrigger value="table" className="gap-2">
              <Trophy className="size-4" /> Tabell
            </TabsTrigger>
            <TabsTrigger value="upcoming" className="gap-2">
              <Calendar className="size-4" /> Kommande
            </TabsTrigger>
            <TabsTrigger value="stryk" className="gap-2">
              <Ticket className="size-4" /> Stryktipset
            </TabsTrigger>
            <TabsTrigger value="learning" className="gap-2">
              <Brain className="size-4" /> Lärdomar
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <Trophy className="size-4" /> Historik
            </TabsTrigger>
            <TabsTrigger value="prompt" className="gap-2">
              <Sparkles className="size-4" /> Prompt
            </TabsTrigger>
          </TabsList>

          {/* LIVE / TODAY — grouped by matchday (date) */}
          <TabsContent value="live" className="space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="font-display text-2xl">Kommande omgång & live</h2>
              <Button
                size="sm"
                onClick={() => bulkPredict.mutate()}
                disabled={bulkPredict.isPending || matchesQ.isLoading}
                className="gap-1.5"
              >
                {bulkPredict.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                {bulkProgress
                  ? `AI-prognoser ${bulkProgress.done}/${bulkProgress.total}`
                  : "AI-prognos för alla matcher idag"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => nextRoundQ.refetch()}
                disabled={nextRoundQ.isFetching}
                className="gap-1.5"
              >
                {nextRoundQ.isFetching ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Calendar className="size-3.5" />
                )}
                Hämta nästkommande omgång
              </Button>
            </div>
            {matchesQ.isLoading && <SkeletonGrid />}
            {matchesQ.data?.leagues.length === 0 && (
              <EmptyState text="Inga matcher i de valda ligorna." />
            )}
            {matchesQ.data && (() => {
              const leaguesWithMatches = sortLeaguesCupsLast(
                (matchesQ.data.leagues ?? [])
                  .filter((lg: any) => lg.matches.length > 0)
                  .map((lg: any) => ({ id: lg.id, name: lg.name })),
              );
              const filteredLeagues =
                liveLeagueFilter === "all"
                  ? (matchesQ.data.leagues ?? [])
                  : (matchesQ.data.leagues ?? []).filter((lg: any) => lg.id === liveLeagueFilter);
              const allMatches = filteredLeagues.flatMap((lg: any) =>
                lg.matches.map((m: any) => ({ ...m, leagueName: lg.name })),
              );
              const dayGroups = groupByDateAcrossLeagues(allMatches);
              return (
                <>
                  {leaguesWithMatches.length > 0 && (
                    <LeagueFilterBar
                      value={liveLeagueFilter}
                      onChange={setLiveLeagueFilter}
                      leagues={leaguesWithMatches}
                    />
                  )}
                  {allMatches.length === 0 ? (
                    <EmptyState text="Inga matcher för vald liga." />
                  ) : (
                    dayGroups.map((day) => (
                      <section key={day.key} className="space-y-4">
                        <div className="flex items-baseline gap-3 border-l-2 border-primary pl-3">
                          <span className="font-display text-base uppercase tracking-widest text-primary">
                            {day.dateLabel}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {day.matches.length} matcher · {day.leagues.length} ligor
                          </span>
                        </div>
                        {day.leagues.map((lg) => (
                          <div key={lg.name} className="space-y-2">
                            <div className="flex items-center gap-2 pl-3">
                              <h4 className="font-display text-sm text-muted-foreground">
                                {lg.name}
                              </h4>
                              <span className="text-xs text-muted-foreground">
                                · {lg.matches.length}
                              </span>
                            </div>
                            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                              {lg.matches.map((m: any) => (
                                <MatchCard key={m.id} m={m} round={m.round} />
                              ))}
                            </div>
                          </div>
                        ))}
                      </section>
                    ))
                  )}
                </>
              );
            })()}


            {nextRoundQ.data && (
              <div className="space-y-6 pt-4 border-t border-border/60">
                <h3 className="font-display text-xl">Nästkommande omgång</h3>
                {nextRoundQ.data.leagues.map((lg) => {
                  const groups = groupByMatchday(lg.matches);
                  const roundLabel =
                    lg.round != null ? `Omgång ${lg.round}` : "Nästa omgång";
                  return (
                    <section key={lg.id} className="space-y-3">
                      <div className="flex items-center gap-2">
                        <h4 className="font-display text-lg">{lg.name}</h4>
                        <Badge variant="outline" className="font-display">
                          {roundLabel}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {lg.matches.length} matcher
                        </span>
                      </div>
                      {lg.matches.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Inga kommande matcher hittades.
                        </p>
                      ) : (
                        groups.map((g) => (
                          <div key={g.key} className="space-y-2">
                            <div className="flex items-baseline gap-3 border-l-2 border-primary pl-3">
                              <span className="font-display text-sm uppercase tracking-widest text-primary">
                                {roundLabel}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {g.dateLabel} · {g.matches.length} matcher
                              </span>
                            </div>
                            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                              {g.matches.map((m: any) => (
                                <MatchCard key={m.id} m={m} round={lg.round} />
                              ))}
                            </div>
                          </div>
                        ))
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* TABLE */}
          <TabsContent value="table">
            <h2 className="font-display text-2xl mb-4">
              {leagueQ.data?.name ?? "Tabell"}
            </h2>
            <Card className="overflow-hidden p-0">
              {leagueQ.isLoading ? (
                <div className="p-6"><Skeleton className="h-64" /></div>
              ) : (leagueQ.data?.standings?.length ?? 0) === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Ingen tabell tillgänglig för {leagueQ.data?.name ?? "denna liga"} just nu.
                  <div className="text-xs mt-1 opacity-70">
                    Datakällan (ESPN) levererar inte standings för den här serien.
                  </div>
                </div>
              ) : (() => {
                const rows = leagueQ.data?.standings ?? [];
                const groups = new Map<string, any[]>();
                for (const t of rows) {
                  const g = (t.group as string | null) ?? "";
                  if (!groups.has(g)) groups.set(g, []);
                  groups.get(g)!.push(t);
                }
                const groupList = [...groups.entries()];
                return groupList.map(([gName, gRows], gi) => (
                  <div key={gName || gi}>
                    {gName && (
                      <div className="px-4 py-2 bg-secondary/80 border-t border-border/60 font-display text-sm uppercase tracking-widest text-primary">
                        {gName}
                      </div>
                    )}
                    <table className="w-full text-sm">
                      <thead className="bg-secondary/60 text-muted-foreground">
                        <tr>
                          <th className="text-left px-4 py-3 w-10">#</th>
                          <th className="text-left px-4 py-3">Lag</th>
                          <th className="px-2 py-3">M</th>
                          <th className="px-2 py-3">V</th>
                          <th className="px-2 py-3">O</th>
                          <th className="px-2 py-3">F</th>
                          <th className="px-2 py-3" title="Gjorda mål">GM</th>
                          <th className="px-2 py-3" title="Insläppta mål">IM</th>
                          <th className="px-2 py-3">+/-</th>
                          <th className="px-2 py-3" title="Expected Goals — kvalitet på skapade chanser (bolldata.se)">xG</th>
                          <th className="px-2 py-3" title="Expected Goals Against — kvalitet på insläppta chanser (bolldata.se)">xGI</th>
                          <th className="px-2 py-3" title="Förväntade poäng baserat på målskillnad / xG">xP</th>
                          <th className="px-2 py-3" title="Poäng − förväntade poäng. + = haft tur, − = otur">Tur</th>
                          <th className="px-2 py-3 text-right pr-4">P</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gRows.map((t: any, i: number) => (
                          <tr
                            key={t.teamId ?? `${gName}-${i}`}
                            className="border-t border-border/60 hover:bg-secondary/40"
                          >
                            <td className="px-4 py-3 text-muted-foreground">{t.idx}</td>
                            <td className="px-4 py-3 font-medium">{t.name}</td>
                            <td className="text-center px-2 py-3">{t.played}</td>
                            <td className="text-center px-2 py-3">{t.wins}</td>
                            <td className="text-center px-2 py-3">{t.draws}</td>
                            <td className="text-center px-2 py-3">{t.losses}</td>
                            <td className="text-center px-2 py-3 tabular-nums">{t.gf ?? "—"}</td>
                            <td className="text-center px-2 py-3 tabular-nums">{t.ga ?? "—"}</td>
                            <td className="text-center px-2 py-3 text-muted-foreground">{t.goalConDiff}</td>
                            <td className="text-center px-2 py-3 text-muted-foreground tabular-nums">{t.xG ?? "—"}</td>
                            <td className="text-center px-2 py-3 text-muted-foreground tabular-nums">{t.xGA ?? "—"}</td>
                            <td className="text-center px-2 py-3 text-muted-foreground tabular-nums">{t.xPts}</td>
                            <td
                              className={`text-center px-2 py-3 tabular-nums font-medium ${
                                t.luck > 1.5
                                  ? "text-live"
                                  : t.luck < -1.5
                                    ? "text-primary"
                                    : "text-muted-foreground"
                              }`}
                              title={
                                t.luck > 1.5
                                  ? "Överpresterat — risk för tapp"
                                  : t.luck < -1.5
                                    ? "Underpresterat — bör studsa tillbaka"
                                    : "I linje med förväntat"
                              }
                            >
                              {t.luck > 0 ? `+${t.luck}` : t.luck}
                            </td>
                            <td className="text-right px-2 py-3 pr-4 font-display font-bold text-primary">
                              {t.pts}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ));
              })()}
            </Card>
          </TabsContent>

          {/* UPCOMING */}
          <TabsContent value="upcoming">
            <h2 className="font-display text-2xl mb-4">Kommande omgång</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {leagueQ.isLoading && <SkeletonGrid />}
              {leagueQ.data?.upcoming.map((m: any) => (
                <Card key={m.id} className="p-4">
                  <div className="text-xs text-muted-foreground mb-2">
                    {m.utcTime
                      ? new Date(m.utcTime).toLocaleString("sv-SE", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "TBD"}
                  </div>
                  <div className="flex items-center justify-between font-medium">
                    <span>{m.home}</span>
                    <span className="text-muted-foreground text-sm">vs</span>
                    <span>{m.away}</span>
                  </div>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* STRYKTIPSET */}
          <TabsContent value="stryk">
            <StryktipsetTab />
          </TabsContent>

          {/* LEARNING */}
          <TabsContent value="learning">
            <LearningTab />
          </TabsContent>

          {/* HISTORY */}
          <TabsContent value="history">
            <HistoryTab />
          </TabsContent>

          {/* PROMPT */}
          <TabsContent value="prompt">
            <PromptTab />
          </TabsContent>

          {/* TODAY TIPS */}
          <TabsContent value="today-tips">
            <TodayTipsTab />
          </TabsContent>
        </Tabs>

        <footer className="pt-8 pb-4 text-xs text-muted-foreground text-center">
          Data hämtas från ESPN:s offentliga API. Endast informationssyfte — spela ansvarsfullt.
        </footer>
      </div>
    </main>
  );
}

async function fetchPrediction(m: any) {
  const res = await fetch("/api/predict", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      leagueId: m.leagueId,
      homeId: m.homeId,
      awayId: m.awayId,
      homeName: m.home,
      awayName: m.away,
      state: m.state,
      round: m.round ?? null,
    }),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new Error(payload?.error ?? "Kunde inte hämta AI-prognos.");
  return payload;
}

function MatchCard({ m, round }: { m: any; round?: number | null }) {
  const isLive = m.state === "in";
  const isFinished = m.state === "post";
  const [open, setOpen] = useState(false);
  const [lineupsOpen, setLineupsOpen] = useState(false);

  const predict = useQuery({
    queryKey: ["predict", m.id],
    queryFn: () => fetchPrediction(m),
    enabled: open,
    staleTime: Infinity,
    retry: false,
  });

  const lineups = useQuery({
    queryKey: ["lineups", m.id],
    queryFn: () =>
      getLineups({
        data: {
          eventId: m.id,
          leagueId: m.leagueId,
          home: m.home,
          away: m.away,
          utcTime: m.utcTime,
        },
      }),
    enabled: lineupsOpen,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const runPredict = () => setOpen(true);

  // Visa lineup-knapp ungefär 1h innan avspark + under match
  const minutesToKickoff = m.utcTime
    ? (new Date(m.utcTime).getTime() - Date.now()) / 60_000
    : null;
  const showLineupBtn =
    !isFinished &&
    (isLive || (minutesToKickoff != null && minutesToKickoff <= 75));

  return (
    <Card className="p-4 hover:border-primary/40 transition flex flex-col">
      <div className="flex items-center justify-between mb-3 text-xs">
        {isLive ? (
          <Badge className="bg-live text-white border-0 gap-1.5">
            <span className="size-1.5 rounded-full bg-white live-dot" /> LIVE {m.clock}
            {m.utcTime && (
              <MatchDateTime
                value={m.utcTime}
                variant="date"
                className="ml-1 text-[10px] font-normal opacity-80"
              />
            )}
          </Badge>
        ) : isFinished ? (
          <Badge variant="secondary">Slut</Badge>
        ) : (
          <span className="text-muted-foreground">
            {m.utcTime ? (
              <MatchDateTime value={m.utcTime} variant="time-date" />
            ) : (
              m.detail
            )}
          </span>
        )}

        {round != null && (
          <Badge variant="outline" className="text-[10px] font-display ml-2">
            Omg. {round}
          </Badge>
        )}
      </div>
      <div className="space-y-1.5">
        <Row name={m.home} score={m.homeScore} />
        <Row name={m.away} score={m.awayScore} />
      </div>

      {!isFinished && m.homeId && m.awayId && (
        <Button
          variant="outline"
          size="sm"
          className="mt-3 gap-1.5 border-primary/40 hover:bg-primary/10 hover:border-primary"
          onClick={runPredict}
          disabled={predict.isFetching}
        >
          {predict.isFetching ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5 text-primary" />
          )}
          {predict.data ? "Visa AI-prognos" : "AI-prognos"}
        </Button>
      )}

      {showLineupBtn && (
        <Button
          variant="outline"
          size="sm"
          className="mt-2 gap-1.5"
          onClick={() => setLineupsOpen((v) => !v)}
        >
          {lineups.isFetching ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Users className="size-3.5" />
          )}
          {lineupsOpen ? "Dölj startelvor" : "Startelvor"}
        </Button>
      )}

      {lineupsOpen && lineups.data && <LineupsPanel data={lineups.data} m={m} />}
      {lineupsOpen && lineups.error && (
        <div className="mt-2 text-xs text-destructive">
          Kunde inte hämta startelvor
        </div>
      )}

      {predict.error && open && (
        <div className="mt-2 text-xs text-destructive">
          {(predict.error as Error).message}
        </div>
      )}
      {open && predict.data && <PredictionPanel p={predict.data} />}
    </Card>
  );
}

function LineupsPanel({ data, m }: { data: any; m: any }) {
  if (!data?.released) {
    return (
      <div className="mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
        Startelvor inte släppta än. Brukar komma ca 1 timme före avspark.
      </div>
    );
  }
  const Side = ({ side, label }: { side: any; label: string }) => (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-xs font-semibold truncate">{label}</div>
        {side?.formation && (
          <Badge variant="outline" className="text-[10px]">
            {side.formation}
          </Badge>
        )}
      </div>
      <ul className="space-y-0.5 text-xs">
        {side?.starters?.map((p: any) => (
          <li key={p.id} className="flex gap-1.5 text-muted-foreground">
            {p.jersey && <span className="w-5 text-right tabular-nums">{p.jersey}</span>}
            <span className="truncate text-foreground">{p.name}</span>
            {p.position && <span className="ml-auto text-[10px]">{p.position}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div className="mt-3 pt-3 border-t border-border">
      <div className="flex gap-4">
        <Side side={data.home} label={m.home} />
        <Side side={data.away} label={m.away} />
      </div>
    </div>
  );
}


function PredictionPanel({
  p,
}: {
  p: {
    homeWinPct: number;
    drawPct: number;
    awayWinPct: number;
    predictedScore: string;
    confidence: string;
    keyFactors: string[];
    bettingTip: string;
    bttsCall?: BttsCall;
    bttsReason?: string;
    valueBet?: string;
    lineupNotes?: string;
    lineupValueShift?: "ökat" | "minskat" | "oförändrat" | "okänt";
    source?: "ai" | "espn-stat";
    lineupReleased?: boolean;
    missingHome?: string[];
    missingAway?: string[];
    matchAnalysis?: MatchAnalysisSections | null;
    marketOdds?: {
      decimalOdds: { home: number | null; draw: number | null; away: number | null };
      marketProbPct: { home: number; draw: number; away: number };
      books: number;
    } | null;
    marketLineMovement?: { summary: string; significant: boolean } | null;
  };
}) {
  const isValue = p.valueBet && /värde/i.test(p.valueBet) && !/inget/i.test(p.valueBet);
  return (
    <div className="mt-3 pt-3 border-t border-border space-y-3 text-sm">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Sparkles className="size-3 text-primary" />{" "}
          {p.source === "espn-stat" ? "Statistikprognos (ESPN)" : "AI-prognos"}
        </span>
        <span>Säkerhet: {p.confidence}</span>
      </div>
      <ProbBar home={p.homeWinPct} draw={p.drawPct} away={p.awayWinPct} />

      <div className="flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">Troligt resultat</span>
        <span className="font-display font-bold text-lg text-primary">
          {p.predictedScore}
        </span>
      </div>
      {p.marketOdds && (
        <div className="rounded-md bg-secondary/40 border border-border px-3 py-2 text-xs space-y-1">
          <div className="flex items-center justify-between text-muted-foreground">
            <span>Marknadsodds</span>
            <span className="text-[10px]">{p.marketOdds.books} bookmakers</span>
          </div>
          <div className="grid grid-cols-3 gap-2 tabular-nums">
            <div className="text-center">
              <div className="font-display font-bold">{p.marketOdds.decimalOdds.home?.toFixed(2) ?? "—"}</div>
              <div className="text-[10px] text-muted-foreground">1 · {Math.round(p.marketOdds.marketProbPct.home)}%</div>
            </div>
            <div className="text-center">
              <div className="font-display font-bold">{p.marketOdds.decimalOdds.draw?.toFixed(2) ?? "—"}</div>
              <div className="text-[10px] text-muted-foreground">X · {Math.round(p.marketOdds.marketProbPct.draw)}%</div>
            </div>
            <div className="text-center">
              <div className="font-display font-bold">{p.marketOdds.decimalOdds.away?.toFixed(2) ?? "—"}</div>
              <div className="text-[10px] text-muted-foreground">2 · {Math.round(p.marketOdds.marketProbPct.away)}%</div>
            </div>
          </div>
          {p.marketLineMovement?.summary && (
            <div
              className={`rounded border px-2 py-1 text-[11px] ${
                p.marketLineMovement.significant
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  : "border-border/60 bg-background/40 text-muted-foreground"
              }`}
            >
              {p.marketLineMovement.summary}
            </div>
          )}
        </div>
      )}
      {p.matchAnalysis ? (
        <MatchAnalysisDisplay analysis={p.matchAnalysis} compact />
      ) : (
        <ul className="text-xs space-y-1 text-muted-foreground list-disc pl-4">
          {p.keyFactors.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}
      {p.bttsCall && (
        <BttsDisplay call={p.bttsCall} reason={p.bttsReason} variant="panel" />
      )}
      {p.lineupNotes && (
        <div className="rounded-md bg-secondary/60 border border-border px-3 py-2 text-xs">
          <strong>Personal:</strong> {p.lineupNotes}
        </div>
      )}
      {p.lineupReleased && p.lineupValueShift && p.lineupValueShift !== "oförändrat" && p.lineupValueShift !== "okänt" && (
        <div
          className={`rounded-md border px-3 py-2 text-xs font-medium ${
            p.lineupValueShift === "ökat"
              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400"
          }`}
        >
          <strong>Spelvärde {p.lineupValueShift}</strong> efter officiella startelvor.
          {(p.missingHome?.length || p.missingAway?.length) ? (
            <span className="block mt-0.5 opacity-90">
              Saknas: {[...(p.missingHome ?? []).map((n) => `H: ${n}`), ...(p.missingAway ?? []).map((n) => `B: ${n}`)].slice(0, 4).join(", ")}
            </span>
          ) : null}
        </div>
      )}
      <div className="rounded-md bg-primary/10 border border-primary/30 px-3 py-2 text-xs">
        <strong className="text-primary">Tips:</strong> {p.bettingTip}
      </div>
      {p.valueBet && (
        <div
          className={`rounded-md border px-3 py-2 text-xs ${
            isValue
              ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
              : "border-border bg-secondary/40 text-muted-foreground"
          }`}
        >
          <strong>{isValue ? "💎 Spelvärde:" : "Spelvärde:"}</strong> {p.valueBet}
        </div>
      )}
    </div>
  );
}

function Row({ name, score }: { name: string; score: number | null }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-medium truncate pr-2">{name}</span>
      <span className="font-display text-lg tabular-nums">
        {score ?? "—"}
      </span>
    </div>
  );
}

function PlayerList({
  title,
  icon,
  items,
  loading,
}: {
  title: string;
  icon: React.ReactNode;
  items?: any[];
  loading: boolean;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h3 className="font-display text-lg">{title}</h3>
      </div>
      {loading && <Skeleton className="h-48" />}
      <ul className="space-y-2">
        {items?.map((p, i) => (
          <li
            key={p.id ?? i}
            className="flex items-center justify-between border-b border-border/40 last:border-0 py-2"
          >
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground tabular-nums w-5">
                {i + 1}
              </span>
              <div>
                <div className="font-medium leading-tight">{p.name}</div>
                <div className="text-xs text-muted-foreground">
                  {p.teamName}
                </div>
              </div>
            </div>
            <span className="font-display font-bold text-primary tabular-nums">
              {p.value}
            </span>
          </li>
        ))}
        {!loading && (!items || items.length === 0) && (
          <li className="text-sm text-muted-foreground py-4">
            Ingen data tillgänglig.
          </li>
        )}
      </ul>
    </Card>
  );
}


type MatchdayGroup = {
  key: string;
  label: string;
  dateLabel: string;
  matches: any[];
};

function groupByMatchday(matches: any[]): MatchdayGroup[] {
  const map = new Map<string, any[]>();
  for (const m of matches) {
    if (!m.utcTime) continue;
    const d = new Date(m.utcTime);
    const key = d.toISOString().slice(0, 10);
    (map.get(key) ?? map.set(key, []).get(key)!).push(m);
  }
  const sorted = [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  const today = new Date().toISOString().slice(0, 10);
  return sorted.map(([key, ms], i) => {
    const d = new Date(ms[0].utcTime);
    const dateLabel = d.toLocaleDateString("sv-SE", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    // Hitta omgångsnummer från första matchen som har det satt
    const round = ms.find((m: any) => m.round != null)?.round ?? null;
    let label = round != null ? `Omgång ${round}` : `Omgångsdag ${i + 1}`;
    if (key === today) label = round != null ? `Omgång ${round} · Idag` : "Idag";
    else if (key < today) label = round != null ? `Omgång ${round} · Spelad` : "Spelad";
    return {
      key,
      label,
      dateLabel: dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1),
      matches: ms.sort(
        (a, b) => +new Date(a.utcTime) - +new Date(b.utcTime),
      ),
    };
  });
}

type DayGroup = {
  key: string;
  dateLabel: string;
  matches: any[];
  leagues: { name: string; matches: any[] }[];
};

function groupByDateAcrossLeagues(matches: any[]): DayGroup[] {
  const map = new Map<string, any[]>();
  for (const m of matches) {
    if (!m.utcTime) continue;
    const key = new Date(m.utcTime).toISOString().slice(0, 10);
    (map.get(key) ?? map.set(key, []).get(key)!).push(m);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, ms]) => {
      const d = new Date(ms[0].utcTime);
      const dateLabel = d.toLocaleDateString("sv-SE", {
        weekday: "long",
        day: "numeric",
        month: "long",
      });
      const byLeague = new Map<string, any[]>();
      for (const m of ms) {
        const name = m.leagueName ?? "Övrigt";
        (byLeague.get(name) ?? byLeague.set(name, []).get(name)!).push(m);
      }
      const leagues = [...byLeague.entries()].map(([name, list]) => ({
        name,
        matches: list.sort(
          (a, b) => +new Date(a.utcTime) - +new Date(b.utcTime),
        ),
      }));
      return {
        key,
        dateLabel: dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1),
        matches: ms,
        leagues,
      };
    });
}

function StryktipsetTab() {
  const q = useQuery({
    queryKey: ["stryktipset"],
    queryFn: () => getStryktipset(),
  });

  if (q.isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }
  if (q.error)
    return <EmptyState text={`Kunde inte hämta kupongen: ${(q.error as Error).message}`} />;

  const draw = q.data!;
  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-display text-2xl">Stryktipset</h2>
          <p className="text-xs text-muted-foreground">
            Omgång {draw.drawNumber} · stänger{" "}
            {new Date(draw.regCloseTime).toLocaleString("sv-SE", {
              weekday: "short",
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
      </div>
      <SpikarPanel events={draw.events} />
      <SystemPanel events={draw.events} />
      <div className="space-y-3">
        {draw.events.map((e: any) => (
          <StrykMatchRow key={e.n} e={e} />
        ))}
      </div>
    </div>
  );
}

function SpikarPanel({ events }: { events: any[] }) {
  const m = useMutation({
    mutationFn: () => recommendSpikar({ data: { events } }),
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card className="p-5 border-primary/40 bg-gradient-to-br from-primary/5 to-transparent">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-primary" />
          <h3 className="font-display text-lg">5 spikar för kupongen</h3>
          <span className="text-xs text-muted-foreground">
            2 säkra + 3 skräll
          </span>
        </div>
        <Button
          size="sm"
          onClick={() => m.mutate()}
          disabled={m.isPending}
          className="gap-1.5"
        >
          {m.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          {m.data ? "Generera nya" : "Generera spikar"}
        </Button>
      </div>
      {!m.data && !m.isPending && (
        <p className="text-sm text-muted-foreground">
          AI väljer 5 spikar från hela systemet — 2 säkra favoriter och 3
          värdetecken där folket har streckat fel.
        </p>
      )}
      {m.isPending && <Skeleton className="h-40" />}
      {m.data && (
        <div className="grid sm:grid-cols-2 gap-3">
          {m.data.spikar.map((s) => (
            <div
              key={s.eventNumber}
              className={`rounded-md border p-3 space-y-2 ${
                s.typ === "skräll"
                  ? "border-live/50 bg-live/5"
                  : "border-primary/40 bg-primary/5"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="size-7 rounded-md bg-card text-muted-foreground grid place-items-center font-display text-xs shrink-0">
                    {s.eventNumber}
                  </span>
                  <span className="font-medium text-sm truncate">
                    {s.match}
                  </span>
                </div>
                <Badge
                  className={`border-0 font-display ${
                    s.typ === "skräll"
                      ? "bg-live text-white"
                      : "bg-primary text-primary-foreground"
                  }`}
                >
                  {s.tecken}
                </Badge>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>
                  Min sannolikhet:{" "}
                  <strong className="text-foreground tabular-nums">
                    {Math.round(s.confidencePct)}%
                  </strong>
                </span>
                <span>
                  Folket:{" "}
                  <span className="tabular-nums">{Math.round(s.folketPct)}%</span>
                </span>
                <span
                  className={`uppercase tracking-widest text-[10px] ml-auto ${
                    s.typ === "skräll" ? "text-live" : "text-primary"
                  }`}
                >
                  {s.typ}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{s.motivering}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function StrykMatchRow({ e }: { e: any }) {
  const [open, setOpen] = useState(false);
  const m = useMutation({
    mutationFn: () =>
      analyzeStryktipsetMatch({
        data: {
          home: e.home,
          away: e.away,
          league: e.league,
          odds: e.odds,
          folket: e.folket,
        },
      }),
    onError: (err: Error) => toast.error(err.message),
  });

  const run = () => {
    setOpen(true);
    if (!m.data && !m.isPending) m.mutate();
  };

  const fav =
    e.folket.one >= e.folket.x && e.folket.one >= e.folket.two
      ? "1"
      : e.folket.x >= e.folket.two
        ? "X"
        : "2";

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <span className="size-8 rounded-md bg-secondary text-muted-foreground grid place-items-center font-display text-sm">
            {e.n}
          </span>
          <div className="min-w-0">
            <div className="font-medium truncate">
              {e.home} <span className="text-muted-foreground">–</span>{" "}
              {e.away}
            </div>
            <div className="text-xs text-muted-foreground">
              {e.league} ·{" "}
              {new Date(e.startTime).toLocaleString("sv-SE", {
                weekday: "short",
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 text-xs">
          <Pill label="1" odds={e.odds.one} folket={e.folket.one} highlighted={fav === "1"} aiPct={m.data?.homePct} />
          <Pill label="X" odds={e.odds.x} folket={e.folket.x} highlighted={fav === "X"} aiPct={m.data?.drawPct} />
          <Pill label="2" odds={e.odds.two} folket={e.folket.two} highlighted={fav === "2"} aiPct={m.data?.awayPct} />
          <Button
            variant="outline"
            size="sm"
            className="ml-2 gap-1.5 border-primary/40 hover:bg-primary/10 hover:border-primary"
            onClick={run}
            disabled={m.isPending}
          >
            {m.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5 text-primary" />
            )}
            Analys
          </Button>
        </div>
      </div>
      {open && m.data && (
        <div className="mt-4 pt-4 border-t border-border space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <Badge className="bg-primary text-primary-foreground border-0 font-display">
              {m.data.tip}
            </Badge>
            <span className="text-xs text-muted-foreground uppercase tracking-widest">
              {m.data.valueSign}
            </span>
          </div>
          <ProbBar
            home={m.data.homePct}
            draw={m.data.drawPct}
            away={m.data.awayPct}
          />
          <p className="text-xs text-muted-foreground italic">
            {m.data.probReasoning}
          </p>
          <p className="text-muted-foreground">{m.data.rationale}</p>
          <p className="text-xs">
            <strong>Personal:</strong>{" "}
            <span className="text-muted-foreground">{m.data.keyPlayers}</span>
          </p>
        </div>
      )}
    </Card>
  );
}

function Pill({
  label,
  odds,
  folket,
  highlighted,
  aiPct,
}: {
  label: string;
  odds?: string;
  folket: number;
  highlighted: boolean;
  aiPct?: number;
}) {
  // Värde: AI tror >5% mer än folket = grön. AI tror >5% mindre = överstreckat (gul).
  const diff = aiPct != null ? aiPct - folket : null;
  const value = diff != null && diff > 5;
  const over = diff != null && diff < -5;
  return (
    <div
      className={`relative px-2 py-1 rounded-md border text-center min-w-[3.5rem] ${
        value
          ? "border-emerald-500 bg-emerald-500/15 ring-1 ring-emerald-500/40"
          : over
            ? "border-amber-500 bg-amber-500/10"
            : highlighted
              ? "border-primary bg-primary/10"
              : "border-border bg-card"
      }`}
    >
      {value && (
        <span className="absolute -top-2 -right-1 text-[9px] font-display font-bold bg-emerald-500 text-white px-1 rounded">
          VÄRDE
        </span>
      )}
      {over && (
        <span className="absolute -top-2 -right-1 text-[9px] font-display font-bold bg-amber-500 text-white px-1 rounded">
          ÖVER
        </span>
      )}
      <div className="font-display text-xs text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums leading-tight">{odds ?? "—"}</div>
      <div className="text-[10px] text-muted-foreground tabular-nums">
        {folket}%{aiPct != null && (
          <span className={value ? "text-emerald-500 ml-1" : over ? "text-amber-500 ml-1" : "ml-1"}>
            /{Math.round(aiPct)}%
          </span>
        )}
      </div>
    </div>
  );
}

function SystemPanel({ events }: { events: any[] }) {
  const m = useMutation({
    mutationFn: () =>
      buildSystem({
        data: { events, minPayout: 50000, minBudget: 500, targetBudget: 648, maxBudget: 750 },
      }),
    onError: (err: Error) => toast.error(err.message),
  });
  const data = m.data;
  return (
    <Card className="p-4 border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-display text-lg flex items-center gap-2">
            <Ticket className="size-4 text-primary" /> Reduceringssystem 500–750 kr
          </h3>
          <p className="text-xs text-muted-foreground">
            Gamblingcabin-stil reducering. Röd grupp (skrälltecken &lt;25%) hålls mellan 1–3. Förväntad utdelning ≥ 50 000 kr.
          </p>
        </div>
        <Button onClick={() => m.mutate()} disabled={m.isPending} size="sm">
          {m.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {data ? "Bygg om" : "Bygg system"}
        </Button>
      </div>
      {data && (
        <div className="mt-4 space-y-3">
          <div className="flex items-baseline gap-3 flex-wrap">
            <Badge className="bg-emerald-500 text-white border-0 font-display text-base px-3 py-1">
              EV {Math.round(data.expectedPayout).toLocaleString("sv-SE")} kr
            </Badge>
            <Badge className="bg-primary text-primary-foreground border-0 font-display text-sm px-3 py-1">
              Kostnad {data.totalCost} kr
            </Badge>
            <Badge variant="outline" className="font-display text-xs px-2 py-1">
              Skrälltecken {(data as any).skrällCount ?? "–"}/3
            </Badge>
            <span className="text-xs text-muted-foreground">
              Träffchans 13 rätt: {(data.winProbability * 100).toFixed(2)}% • mål ≥ {data.minPayout.toLocaleString("sv-SE")} kr
            </span>
          </div>
          <p className="text-sm text-muted-foreground italic">{data.strategy}</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {data.picks.map((p) => {
              const ev = events.find((e) => e.n === p.eventNumber);
              return (
                <div
                  key={p.eventNumber}
                  className="flex items-start gap-2 p-2 rounded-md bg-card border border-border"
                >
                  <span className="size-6 rounded bg-secondary text-muted-foreground grid place-items-center font-display text-xs shrink-0">
                    {p.eventNumber}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate">
                      {ev ? `${ev.home} – ${ev.away}` : `Match #${p.eventNumber}`}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {p.motivering}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={`shrink-0 font-display ${
                      p.cost === 1
                        ? "border-primary text-primary"
                        : p.cost === 2
                          ? "border-amber-500 text-amber-500"
                          : "border-rose-500 text-rose-500"
                    }`}
                  >
                    {p.tecken}
                  </Badge>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}




function LearningTab() {
  const learningQ = useQuery({
    queryKey: ["learning-all"],
    queryFn: () => getLeagueLearning(),
    refetchInterval: 60_000,
  });
  const [selectedLeague, setSelectedLeague] = useState<string>("all");

  if (learningQ.isLoading) return <Skeleton className="h-64" />;
  const calibrations = learningQ.data?.calibrations ?? {};
  const perLeague = learningQ.data?.perLeague ?? [];
  const filtered =
    selectedLeague === "all"
      ? perLeague
      : perLeague.filter((p) => p.leagueId === selectedLeague);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="font-display text-2xl flex items-center gap-2">
          <Brain className="size-6 text-primary" /> Lärdomar — per liga
        </h2>
        <div className="flex items-center gap-2">
          <LeagueSelect
            value={selectedLeague}
            onChange={setSelectedLeague}
            options={perLeague.map((l) => ({
              id: l.leagueId,
              label: `${l.leagueName} (${l.hits}/${l.resolved})`,
            }))}
          />
        </div>
      </div>


      {filtered.map((lg) => {
        const cal = calibrations[lg.leagueId];
        const hitPct = lg.resolved ? Math.round(lg.hitRate * 100) : 0;
        const outcomes = lg.byOutcome;
        return (
          <Card key={lg.leagueId} className="p-0 overflow-hidden">
            <details>
              <summary className="px-4 py-3 bg-secondary/40 border-b border-border/60 flex items-baseline justify-between flex-wrap gap-2 cursor-pointer select-none hover:bg-secondary/60">
                <div className="flex items-baseline gap-3">
                  <h3 className="font-display text-xl">{lg.leagueName}</h3>
                  <span className="text-xs text-muted-foreground">
                    {lg.resolved} avgjorda · {lg.total - lg.resolved} pågående
                  </span>
                </div>
                <Badge variant={hitPct >= 50 ? "default" : "outline"} className="font-display">
                  Träff {hitPct}% ({lg.hits}/{lg.resolved})
                </Badge>
              </summary>
              <div className="p-4 space-y-4">
                {/* Sammanfattning */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <MiniStat label="Rätt 1" value={`${outcomes.H.hits}/${outcomes.H.n}`} />
                  <MiniStat label="Rätt X" value={`${outcomes.D.hits}/${outcomes.D.n}`} />
                  <MiniStat label="Rätt 2" value={`${outcomes.A.hits}/${outcomes.A.n}`} />
                  <MiniStat
                    label="Snitt-Brier"
                    value={cal?.avgBrier != null ? cal.avgBrier.toFixed(3) : "—"}
                  />
                </div>

                {/* Per confidence */}
                {Object.keys(lg.byConfidence).length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5">
                      Träff per confidence
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      {Object.entries(lg.byConfidence).map(([c, v]) => (
                        <span key={c} className="px-2 py-1 bg-secondary/60 rounded">
                          <span className="text-muted-foreground">{c}:</span>{" "}
                          <span className="font-medium tabular-nums">
                            {v.hits}/{v.n} ({Math.round((v.hits / v.n) * 100)}%)
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Vad gick fel */}
                {lg.worstMisses.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-destructive mb-1.5">
                      Värsta missarna (hög/medel conf)
                    </div>
                    <PredictionResultsTable
                      rows={lg.worstMisses as PredictionRow[]}
                      showBtts
                      dateFormat="date"
                      allowPending
                    />
                  </div>
                )}

                {/* Vad gick rätt */}
                {lg.bestHits.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-primary mb-1.5">
                      Bästa träffarna (hög/medel conf)
                    </div>
                    <PredictionResultsTable
                      rows={lg.bestHits as PredictionRow[]}
                      showBtts
                      dateFormat="date"
                      allowPending
                    />
                  </div>
                )}

                {/* Alla matcher för ligan */}
                {lg.allMatches.length > 0 && (
                  <details className="group">
                    <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground select-none">
                      Visa alla {lg.allMatches.length} matcher i denna liga
                    </summary>
                    <div className="mt-2">
                      <PredictionResultsTable
                        rows={lg.allMatches as PredictionRow[]}
                        showBtts
                        dateFormat="date"
                        allowPending
                      />
                    </div>
                  </details>
                )}

                {lg.total === 0 && (
                  <p className="text-xs text-muted-foreground italic">
                    Inga tips för denna liga än.
                  </p>
                )}
              </div>
            </details>
          </Card>
        );
      })}
    </div>
  );
}



function HistoryTab() {
  const q = useQuery({
    queryKey: ["history"],
    queryFn: () => getHistory(),
    refetchInterval: 5 * 60_000,
  });

  const [selectedLeague, setSelectedLeague] = useState<string>("all");

  if (q.isLoading) return <Skeleton className="h-64" />;
  const allLeagues = q.data?.leagues ?? [];
  // Sortera efter träffsäkerhet (bäst liga överst). Vid lika träff% — fler tips först.
  const leaguesWithData = allLeagues
    .filter((l) => l.total > 0)
    .slice()
    .sort((a, b) => {
      const ra = a.hits / a.total;
      const rb = b.hits / b.total;
      if (rb !== ra) return rb - ra;
      return b.total - a.total;
    });
  const anyData = leaguesWithData.length > 0;
  const leagues =
    selectedLeague === "all"
      ? leaguesWithData
      : leaguesWithData.filter((l) => l.leagueId === selectedLeague);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-display text-2xl flex items-center gap-2">
            <Trophy className="size-6 text-primary" /> Historik
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Alla ligor med avgjorda tips, sorterade efter träffsäkerhet (bäst
            liga överst). Inom varje liga: senaste omgången först.
          </p>
        </div>
        <LeagueSelect
          value={selectedLeague}
          onChange={setSelectedLeague}
          hideIfSingle
          options={leaguesWithData.map((l) => ({
            id: l.leagueId,
            label: `${l.leagueName} (${Math.round((l.hits / l.total) * 100)}% · ${l.hits}/${l.total})`,
          }))}
        />
      </div>

      {!anyData && (
        <EmptyState text="Inga avgjorda tips än. Kör 'Hämta facit' under Lärdomar när matcherna är spelade." />
      )}

      {leagues.map((lg, idx) => {
        if (lg.total === 0) return null;
        const confidentHits = (lg.byConfidence["medel"]?.hits ?? 0) +
          (lg.byConfidence["hög"]?.hits ?? 0);
        const confidentN = (lg.byConfidence["medel"]?.n ?? 0) +
          (lg.byConfidence["hög"]?.n ?? 0);
        const rank = selectedLeague === "all" ? idx + 1 : null;
        return (
          <section key={lg.leagueId} className="space-y-3">
            <details>
              <summary className="flex items-baseline gap-3 flex-wrap border-b border-border/60 pb-2 cursor-pointer select-none hover:opacity-90">
                {rank != null && (
                  <Badge variant="outline" className="font-display text-xs">
                    #{rank}
                  </Badge>
                )}
                <h3 className="font-display text-xl">{lg.leagueName}</h3>
                <Badge className="bg-primary/20 text-primary border-0 font-display">
                  Träff 1X2: {Math.round((lg.hits / lg.total) * 100)}% ({lg.hits}/{lg.total})
                </Badge>
                {confidentN > 0 && (
                  <Badge variant="outline" className="font-display">
                    Confidence-träff (medel/hög): {Math.round((confidentHits / confidentN) * 100)}% ({confidentHits}/{confidentN})
                  </Badge>
                )}
              </summary>

              <div className="space-y-3 mt-3">
                {lg.rounds.map((rd) => {
                  const ch = (rd.byConfidence["medel"]?.hits ?? 0) +
                    (rd.byConfidence["hög"]?.hits ?? 0);
                  const cn = (rd.byConfidence["medel"]?.n ?? 0) +
                    (rd.byConfidence["hög"]?.n ?? 0);
                  return (
                    <Card key={rd.key} className="p-0 overflow-hidden">
                      <div className="px-4 py-3 bg-secondary/40 border-b border-border/60 flex items-baseline gap-3 flex-wrap">
                        <span className="font-display text-sm uppercase tracking-widest text-primary">
                          {rd.label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {rd.total} tips
                        </span>
                        <span className="ml-auto flex items-center gap-2 text-xs">
                          <Badge
                            className={
                              rd.hits / rd.total >= 0.5
                                ? "bg-live/20 text-live border-0 font-display"
                                : "bg-destructive/20 text-destructive border-0 font-display"
                            }
                          >
                            Träff: {Math.round((rd.hits / rd.total) * 100)}% ({rd.hits}/{rd.total})
                          </Badge>
                          {cn > 0 && (
                            <Badge variant="outline" className="font-display text-[10px]">
                              Conf (m/h): {Math.round((ch / cn) * 100)}% ({ch}/{cn})
                            </Badge>
                          )}
                        </span>
                      </div>
                      <PredictionResultsTable
                        rows={rd.items as PredictionRow[]}
                        showBtts
                        dateFormat="date"
                      />
                    </Card>
                  );
                })}
              </div>
            </details>
          </section>
        );
      })}
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="font-display text-2xl mt-1 tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </Card>
  );
}


function TodayTipsTab() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["today-tips"],
    queryFn: () => getTodayTips(),
    refetchInterval: 60_000,
  });
  const [selectedLeague, setSelectedLeague] = useState<string>("all");
  const bulk = useMutation({
    mutationFn: () => generateTodayPredictions(),
    onSuccess: (r) => {
      if (r.generated === 0 && r.failed === 0)
        toast.info(`Alla ${r.total} matcher har redan en prognos.`);
      else
        toast.success(
          `Prognoser: ${r.generated} genererade/uppdaterade · ${r.total} matcher${
            r.failed ? ` · ${r.failed} fel` : ""
          }.`,
        );
      qc.invalidateQueries({ queryKey: ["today-tips"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const resolveM = useMutation({
    mutationFn: () => resolveResults(),
    onSuccess: (r) => {
      const promptsMsg = r.promptsUpdated > 0 ? ` · ${r.promptsUpdated} prompt(er) uppdaterade` : "";
      toast.success(`Uppdaterade ${r.resolved} av ${r.checked} tips med facit.${promptsMsg}`);
      qc.invalidateQueries({ queryKey: ["today-tips"] });
      qc.invalidateQueries({ queryKey: ["history"] });
      qc.invalidateQueries({ queryKey: ["learning-all"] });
      qc.invalidateQueries({ queryKey: ["league-prompts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const hideM = useMutation({
    mutationFn: () => hideResolvedFromToday(),
    onSuccess: (r) => {
      toast.success(`Flyttade ${r.moved} rättade tips till Historik.`);
      qc.invalidateQueries({ queryKey: ["today-tips"] });
      qc.invalidateQueries({ queryKey: ["history"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });



  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.isError) {
    return (
      <EmptyState
        text={`Kunde inte ladda dagens tips: ${q.error instanceof Error ? q.error.message : "Okänt fel"}. Försök ladda om sidan.`}
      />
    );
  }
  const items = q.data?.items ?? [];
  const supabaseAvailable = q.data?.supabaseAvailable !== false;
  const scoreboardCount = q.data?.scoreboardCount ?? 0;

  // Gruppera per liga, sedan per omgång (senaste först).
  type Item = (typeof items)[number];
  const byLeague = new Map<string, { leagueId: string; leagueName: string; items: Item[] }>();
  for (const r of items) {
    const lgName = LEAGUES.find((l) => l.id === r.league_id)?.name ?? r.league_id;
    const entry = byLeague.get(r.league_id) ?? { leagueId: r.league_id, leagueName: lgName, items: [] };
    entry.items.push(r);
    byLeague.set(r.league_id, entry);
  }
  // Inkludera ALLA ligor (även tomma), sorterat efter region → namn.
  for (const lg of LEAGUES) {
    if (!byLeague.has(lg.id)) {
      byLeague.set(lg.id, { leagueId: lg.id, leagueName: lg.name, items: [] });
    }
  }
  const allLeagueGroups = [...byLeague.values()].sort((a, b) => {
    // Sortera så ligor med matcher kommer först, sedan alfabetiskt.
    if ((a.items.length > 0) !== (b.items.length > 0)) return b.items.length - a.items.length;
    return a.leagueName.localeCompare(b.leagueName);
  });
  const leagueGroups =
    selectedLeague === "all"
      ? allLeagueGroups
      : allLeagueGroups.filter((g) => g.leagueId === selectedLeague);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-display text-2xl flex items-center gap-2">
            <Sparkles className="size-6 text-primary" /> Dagens tips
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Kommande matcher inom 24h + rättade tips i 24h efter facit ({q.data?.dateLabel}).
            Klicka "Flytta rättade till Historik" för att frigöra vyn manuellt.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => resolveM.mutate()}
            disabled={resolveM.isPending}
          >
            {resolveM.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            Hämta facit
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => hideM.mutate()}
            disabled={hideM.isPending}
          >
            {hideM.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trophy className="size-4" />}
            Flytta rättade till Historik
          </Button>
          <Button
            size="sm"
            onClick={() => bulk.mutate()}
            disabled={bulk.isPending}
          >
            <Sparkles className="size-4" />
            {bulk.isPending ? "Genererar…" : "AI-prognos alla matcher"}
          </Button>

          <LeagueSelect
            value={selectedLeague}
            onChange={setSelectedLeague}
            hideIfSingle
            options={allLeagueGroups.map((l) => ({
              id: l.leagueId,
              label: `${l.leagueName} (${l.items.length})`,
            }))}
          />

        </div>
      </div>

      {!supabaseAvailable && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
          Supabase är inte konfigurerad (saknar <code className="text-amber-100">SUPABASE_SERVICE_ROLE_KEY</code>).
          Matcher från ESPN visas, men sparade tips och AI-prognoser kräver nyckeln i .env eller deploy-miljön.
        </div>
      )}

      {items.length === 0 && (
        <EmptyState
          text={
            scoreboardCount === 0
              ? "Inga matcher inom 24h hittades i ESPN just nu."
              : "Inga tips för matcher inom 24h. Klicka 'AI-prognos alla matcher' för att generera."
          }
        />
      )}

      {leagueGroups.map((lg) => {
        // Gruppera per omgång, senaste först.
        const rounds = new Map<string, { key: string; label: string; round: number | null; items: Item[] }>();
        for (const r of lg.items) {
          const rkey = r.round != null ? `round-${r.round}` : "unknown";
          const rg = rounds.get(rkey) ?? {
            key: rkey,
            label: r.round != null ? `Omgång ${r.round}` : "Omgång (okänd)",
            round: r.round ?? null,
            items: [],
          };
          rg.items.push(r);
          rounds.set(rkey, rg);
        }
        const sortedRounds = [...rounds.values()].sort((a, b) => (b.round ?? -1) - (a.round ?? -1));
        return (
          <section key={lg.leagueId} className="space-y-3">
            <div className="flex items-baseline gap-3 flex-wrap border-b border-border/60 pb-2">
              <h3 className="font-display text-xl">{lg.leagueName}</h3>
              <span className="text-xs text-muted-foreground">
                {lg.items.length === 0 ? "Inga tips just nu" : `${lg.items.length} tips`}
              </span>
            </div>
            {lg.items.length === 0 ? (
              <p className="text-xs text-muted-foreground italic px-1">
                Inga orättade matcher inom 24h. Visas när AI genererat tips eller match väntar facit.
              </p>
            ) : (
              sortedRounds.map((rd) => (
                <Card key={rd.key} className="p-0 overflow-hidden">
                  <div className="px-4 py-3 bg-secondary/40 border-b border-border/60 flex items-baseline gap-3 flex-wrap">
                    <span className="font-display text-sm uppercase tracking-widest text-primary">
                      {rd.label}
                    </span>
                    <span className="text-xs text-muted-foreground">{rd.items.length} matcher</span>
                  </div>
                  <PredictionResultsTable
                    rows={rd.items as PredictionRow[]}
                    showBtts
                    dateFormat="time"
                    allowPending
                  />
                </Card>
              ))
            )}
          </section>
        );
      })}
    </div>
  );
}

function PromptTab() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["league-prompts"],
    queryFn: () => getLeaguePrompts(),
  });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const saveM = useMutation({
    mutationFn: (vars: { leagueId: string; promptText: string }) =>
      updateLeaguePrompt({ data: vars }),
    onSuccess: (_r, vars) => {
      toast.success(`Prompt sparad för ${vars.leagueId}`);
      qc.invalidateQueries({ queryKey: ["league-prompts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const analyzeM = useMutation({
    mutationFn: () => analyzeAndUpdateLeaguePrompts(),
    onSuccess: (r) => {
      toast.success(`Analys klar — ${r.updated} ligor uppdaterade, ${r.skipped} väntar på fler matcher.`);
      qc.invalidateQueries({ queryKey: ["league-prompts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading) return <Skeleton className="h-64" />;
  const items = q.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-2xl flex items-center gap-2">
            <Sparkles className="size-6 text-primary" /> Tränings-prompt per liga
          </h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            Varje liga har en egen tränings-prompt som AI:n läser INNAN den tippar
            matcher i ligan. Prompten uppdateras automatiskt när du klickar
            "Hämta facit" på Dagens tips — men endast om minst 20 nya matcher
            har rättats sedan senaste uppdateringen. Du kan också redigera
            manuellt här.
          </p>
        </div>
        <Button
          onClick={() => analyzeM.mutate()}
          disabled={analyzeM.isPending}
          className="gap-1.5"
        >
          {analyzeM.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Brain className="size-3.5" />
          )}
          Tvinga analys nu
        </Button>
      </div>

      <div className="space-y-3">
        {items.map((it) => {
          const current = edits[it.leagueId] ?? it.promptText;
          const dirty = edits[it.leagueId] != null && edits[it.leagueId] !== it.promptText;
          return (
            <Card key={it.leagueId} className="p-0 overflow-hidden">
              <details>
                <summary className="px-4 py-3 bg-secondary/40 border-b border-border/60 flex items-baseline justify-between flex-wrap gap-2 cursor-pointer select-none hover:bg-secondary/60">
                  <div className="flex items-baseline gap-3">
                    <h3 className="font-display text-lg">{it.leagueName}</h3>
                    <span className="text-xs text-muted-foreground">
                      {it.promptText ? `${it.promptText.length} tecken` : "ingen prompt än"}
                      {it.updatedAt && ` · uppdaterad ${new Date(it.updatedAt).toLocaleString("sv-SE")}`}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    räknare: {it.lastResolvedCount} resolverade vid senaste uppdatering
                  </span>
                </summary>
                <div className="p-4 space-y-2">
                  <Textarea
                    value={current}
                    onChange={(e) =>
                      setEdits((prev) => ({ ...prev, [it.leagueId]: e.target.value }))
                    }
                    rows={10}
                    className="font-mono text-xs"
                    placeholder="Skriv ligaspecifika regler här — eller låt AI:n generera dem via Hämta facit."
                  />
                  <div className="flex items-center justify-end gap-2">
                    {dirty && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setEdits((prev) => {
                            const { [it.leagueId]: _, ...rest } = prev;
                            return rest;
                          })
                        }
                      >
                        Återställ
                      </Button>
                    )}
                    <Button
                      size="sm"
                      disabled={!dirty || saveM.isPending}
                      onClick={() =>
                        saveM.mutate({ leagueId: it.leagueId, promptText: current })
                      }
                    >
                      Spara
                    </Button>
                  </div>
                </div>
              </details>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
