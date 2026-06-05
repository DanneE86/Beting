import type { ChecklistItemView, LegAnalysis, ScoredHorse } from "../../v86/src/types";

const EXCLUDED_IDS = new Set(["favorite_delivery"]);
const HORSE_W = 0.62;
const DRIVER_W = 0.38;

// ─── score helpers ────────────────────────────────────────────────────────────

function calcWeighted(items: ChecklistItemView[], exclude: Set<string>): number {
  const valid = items.filter((i) => i.available && i.weight > 0 && !exclude.has(i.id));
  if (!valid.length) return 0.5;
  const tw = valid.reduce((s, i) => s + i.weight, 0);
  return valid.reduce((s, i) => s + i.score * i.weight, 0) / tw;
}

function computeScores(horse: ScoredHorse) {
  const h = calcWeighted(horse.horseChecklist, EXCLUDED_IDS);
  const d = calcWeighted(horse.driverChecklist, EXCLUDED_IDS);
  return { h, d, combined: h * HORSE_W + d * DRIVER_W };
}

function getItem(horse: ScoredHorse, id: string, cat: "häst" | "kusk") {
  return (cat === "häst" ? horse.horseChecklist : horse.driverChecklist).find((i) => i.id === id);
}

// ─── colour helpers ───────────────────────────────────────────────────────────

function scoreColor(s: number) {
  if (s >= 0.75) return "#5ec98a";
  if (s >= 0.60) return "#88c8a4";
  if (s >= 0.50) return "#c8a840";
  return "#c86060";
}

function cellStyle(score: number, avail: boolean): string {
  if (!avail) return "bg-[#0d1810] text-[#2d4a38]";
  if (score >= 0.75) return "bg-[#0a3b1b] text-[#5ec98a]";
  if (score >= 0.60) return "bg-[#122a1c] text-[#88c8a4]";
  if (score >= 0.50) return "bg-[#2a2808] text-[#c8b040]";
  return "bg-[#2d1010] text-[#d07070]";
}

// ─── ScoreBar ─────────────────────────────────────────────────────────────────

function ScoreBar({ score, width = 52 }: { score: number; width?: number }) {
  const pct = Math.round(score * 100);
  const col = scoreColor(score);
  return (
    <span className="inline-flex items-center gap-1">
      <span className="relative inline-block h-1.5 rounded-full bg-[#1a2e22]" style={{ width }}>
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${Math.min(100, pct)}%`, backgroundColor: col }}
        />
      </span>
      <span className="w-8 text-right text-[11px] font-bold tabular-nums" style={{ color: col }}>
        {pct}%
      </span>
    </span>
  );
}

// ─── Badges ───────────────────────────────────────────────────────────────────

function FormBadge({ trend }: { trend: ScoredHorse["formTrend"] }) {
  const cfg = {
    stigande: { label: "↑ Stigande", cls: "bg-[#0a3b1b] text-[#5ec98a]" },
    toppad: { label: "→ Toppad", cls: "bg-[#162d1f] text-[#88c8a4]" },
    nedåtgående: { label: "↓ Sjunkande", cls: "bg-[#2d1010] text-[#d07070]" },
    okänd: { label: "? Okänd", cls: "bg-[#1a2e22] text-[#5a7a68]" },
  } as const;
  const c = cfg[trend] ?? cfg.okänd;
  return (
    <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${c.cls}`}>
      {c.label}
    </span>
  );
}

function GallopBadge({ level }: { level?: "låg" | "medel" | "hög" }) {
  if (!level || level === "låg") return null;
  const cfg = {
    medel: { label: "⚠ Galopp medel", cls: "bg-[#2d2a10] text-[#c8b040]" },
    hög: { label: "✖ Galopp hög", cls: "bg-[#2d1010] text-[#d07070]" },
  } as const;
  const c = cfg[level];
  return (
    <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${c.cls}`}>{c.label}</span>
  );
}

function TempoBadge({ style }: { style?: "front" | "closer" | "versatile" | "okänd" }) {
  if (!style || style === "okänd") return null;
  const cfg = {
    front: { label: "▶ Front", cls: "bg-[#162d1f] text-[#88c8a4]" },
    closer: { label: "◀ Closer", cls: "bg-[#162d1f] text-[#5ec98a]" },
    versatile: { label: "◈ Versatile", cls: "bg-[#1a2e22] text-[#88c8a4]" },
  } as const;
  const c = cfg[style];
  if (!c) return null;
  return (
    <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${c.cls}`}>{c.label}</span>
  );
}

function RecommendationBadge({ rec }: { rec: "spik" | "gardering" | "bred" }) {
  const cfg = {
    spik: { label: "SPIK", cls: "bg-[#1a5c38] text-[#5ec98a] border-[#2d6b45]" },
    gardering: { label: "GARDERING", cls: "bg-[#2d2a10] text-[#c8b040] border-[#5a5020]" },
    bred: { label: "BRED", cls: "bg-[#2d1e10] text-[#c88840] border-[#5a3820]" },
  } as const;
  const c = cfg[rec] ?? cfg.gardering;
  return (
    <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${c.cls}`}>
      {c.label}
    </span>
  );
}

function ConfidenceBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const col = score >= 0.68 ? "#5ec98a" : score >= 0.48 ? "#c8a840" : "#c86060";
  const label = score >= 0.68 ? "Klar favorit" : score >= 0.48 ? "Trolig vinnare" : "Öppet lopp";
  return (
    <span className="flex items-center gap-1.5">
      <span className="relative inline-block h-2 w-20 rounded-full bg-[#1a2e22]">
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, backgroundColor: col }} />
      </span>
      <span className="text-[10px] font-medium" style={{ color: col }}>{label}</span>
    </span>
  );
}

// ─── Winner Spotlight ─────────────────────────────────────────────────────────

function WinnerSpotlight({ horse, scores }: { horse: ScoredHorse; scores: ReturnType<typeof computeScores> }) {
  return (
    <div className="border-b border-[#1e3d2a] bg-[#0d2818] px-4 py-3">
      {/* Name row */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-lg text-[#5ec98a]">★</span>
        <span className="font-mono text-base font-bold text-[#5ec98a]">{horse.number}.</span>
        <span className="text-base font-semibold text-[#d4f5e2]">{horse.name}</span>
        <span className="text-sm text-[#7fa892]">({horse.driver})</span>
        <FormBadge trend={horse.formTrend} />
        <GallopBadge level={horse.gallopRiskLevel} />
        <TempoBadge style={horse.tempoTripStyle} />
      </div>

      {/* Score bars */}
      <div className="flex flex-wrap gap-5 mb-2">
        <div>
          <div className="text-[9px] text-[#5a7a68] mb-0.5">Häst (62%)</div>
          <ScoreBar score={scores.h} width={64} />
        </div>
        <div>
          <div className="text-[9px] text-[#5a7a68] mb-0.5">Kusk (38%)</div>
          <ScoreBar score={scores.d} width={64} />
        </div>
        <div>
          <div className="text-[9px] text-[#5a7a68] mb-0.5">Totalpoäng</div>
          <ScoreBar score={scores.combined} width={80} />
        </div>
        {horse.estimatedWinPct != null && (
          <div>
            <div className="text-[9px] text-[#5a7a68] mb-0.5">Modell-vinstchans</div>
            <span className="text-sm font-bold" style={{ color: scoreColor(horse.estimatedWinPct) }}>
              {Math.round(horse.estimatedWinPct * 100)}%
            </span>
            <span className="text-[10px] text-[#5a7a68] ml-1">
              (marknad {Math.round(horse.winPct * 100)}%)
            </span>
          </div>
        )}
      </div>

      {/* Km-times */}
      {horse.recentKmTimes && horse.recentKmTimes.length > 0 && (
        <div className="mb-2">
          <span className="text-[9px] text-[#5a7a68] mr-2">Senaste km-tider:</span>
          {horse.recentKmTimes.slice(0, 5).map((t, i) => (
            <span key={i} className="mr-2 font-mono text-[11px] text-[#88c8a4]">{t}</span>
          ))}
        </div>
      )}

      {/* Highlights — alla */}
      {horse.highlights.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {horse.highlights.map((h, i) => (
            <span key={i} className="rounded bg-[#122a1c] px-2 py-0.5 text-[10px] text-[#7fa892]">
              {h}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Horse Rank Row ───────────────────────────────────────────────────────────

function HorseRankRow({
  horse,
  rank,
  isTop,
  scores,
}: {
  horse: ScoredHorse;
  rank: number;
  isTop: boolean;
  scores: ReturnType<typeof computeScores>;
}) {
  const bg = isTop
    ? "bg-[#0d2818] border-l-2 border-[#2d6b45]"
    : rank <= 3
      ? "bg-[#0c1a13]"
      : "";

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded px-3 py-2 ${bg}`}>
      {/* Rank */}
      <div className="w-5 shrink-0 text-center">
        {isTop
          ? <span className="text-sm font-bold text-[#5ec98a]">★</span>
          : <span className="text-xs font-semibold text-[#5a7a68]">{rank}</span>}
      </div>

      {/* Number + Name + Driver */}
      <div className="min-w-[130px] flex-1">
        <div className="flex items-baseline gap-1">
          <span className={`font-mono text-sm font-bold ${isTop ? "text-[#5ec98a]" : "text-[#b8f0d0]"}`}>
            {horse.number}.
          </span>
          <span className={`text-sm font-medium ${isTop ? "text-[#d4f5e2]" : "text-[#c8ddd2]"}`}>
            {horse.name}
          </span>
        </div>
        <div className="text-[10px] text-[#5a7a68]">{horse.driver}</div>
      </div>

      {/* Km-tid */}
      <div className="min-w-[60px]">
        <div className="text-[9px] text-[#5a7a68]">Km-tid</div>
        <span className="font-mono text-[11px] text-[#88c8a4]">
          {horse.recentKmTimes?.[0] ?? "—"}
        </span>
      </div>

      {/* Odds + streckning */}
      <div className="min-w-[70px]">
        <div className="text-[9px] text-[#5a7a68]">Odds / Streck</div>
        <span className="text-[11px] text-[#b8f0d0]">
          {horse.winOdds != null ? horse.winOdds.toFixed(1) : "—"}
          <span className="text-[#5a7a68]"> / {horse.betDistribution.toFixed(0)}%</span>
        </span>
      </div>

      {/* Score bars */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
        <div>
          <div className="text-[9px] text-[#5a7a68]">Häst</div>
          <ScoreBar score={scores.h} width={44} />
        </div>
        <div>
          <div className="text-[9px] text-[#5a7a68]">Kusk</div>
          <ScoreBar score={scores.d} width={44} />
        </div>
        <div>
          <div className="text-[9px] text-[#5a7a68]">Totalt</div>
          <ScoreBar score={scores.combined} width={60} />
        </div>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-1">
        <FormBadge trend={horse.formTrend} />
        <GallopBadge level={horse.gallopRiskLevel} />
        <TempoBadge style={horse.tempoTripStyle} />
      </div>
    </div>
  );
}

// ─── Parameter Detail Table ───────────────────────────────────────────────────

function ParameterTable({ leg }: { leg: LegAnalysis }) {
  const horses = leg.horses;
  if (!horses.length) return null;

  const sorted = [...horses].sort((a, b) => computeScores(b).combined - computeScores(a).combined);

  function collectParams(cat: "häst" | "kusk") {
    const seen = new Set<string>();
    const list: { id: string; label: string; weight: number }[] = [];
    for (const h of horses) {
      const items = cat === "häst" ? h.horseChecklist : h.driverChecklist;
      for (const item of items) {
        if (!seen.has(item.id) && !EXCLUDED_IDS.has(item.id)) {
          seen.add(item.id);
          list.push({ id: item.id, label: item.label, weight: item.weight });
        }
      }
    }
    list.sort((a, b) => b.weight - a.weight);
    return list;
  }

  const horseParams = collectParams("häst");
  const driverParams = collectParams("kusk");
  const sticky = "sticky left-0 z-10 border-r border-[#1e3d2a] bg-[#0f1c14]";

  return (
    <div className="overflow-x-auto rounded border border-[#1e3d2a]">
      <table className="min-w-full border-collapse text-[11px]">
        <thead>
          <tr className="border-b-2 border-[#2d6b45] bg-[#0c1410]">
            <th className={`${sticky} w-[200px] min-w-[200px] bg-[#0c1410] px-3 py-2 text-left text-[10px] font-medium text-[#5ec98a]`}>
              Parameter / Data
            </th>
            {sorted.map((h, i) => {
              const s = computeScores(h);
              return (
                <th
                  key={h.number}
                  className={`min-w-[100px] border-r border-[#1e3d2a] px-2 py-1.5 text-center ${i === 0 ? "bg-[#0d2818]" : ""}`}
                >
                  <div className={`font-mono font-bold ${i === 0 ? "text-[#5ec98a]" : "text-[#b8f0d0]"}`}>
                    {i === 0 ? "★ " : ""}{h.number}
                  </div>
                  <div className="max-w-[88px] truncate text-[9px] text-[#5a7a68]">{h.name}</div>
                  <div className="mt-0.5 text-[10px] font-bold" style={{ color: scoreColor(s.combined) }}>
                    {Math.round(s.combined * 100)}%
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {/* ── Häst section ── */}
          <tr className="bg-[#13261c]">
            <td
              colSpan={sorted.length + 1}
              className="sticky left-0 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-[#5ec98a]"
            >
              Häst-parametrar — väger 62% av totalpoängen
            </td>
          </tr>
          {horseParams.map((p) => (
            <tr key={p.id} className="border-b border-[#0a1810] hover:bg-[#111c16]">
              <td className={`${sticky} w-[200px] min-w-[200px] px-3 py-2`}>
                <div className="text-[11px] font-medium text-[#c8ddd2]">{p.label}</div>
                <div className="mt-0.5 inline-block rounded bg-[#1a2e22] px-1 py-0 text-[8px] font-semibold text-[#5a7a68]">
                  vikt {p.weight}
                </div>
              </td>
              {sorted.map((h, i) => {
                const item = getItem(h, p.id, "häst");
                const avail = item?.available ?? false;
                const score = item?.score ?? 0;
                const note = item?.note ?? "";
                return (
                  <td
                    key={h.number}
                    className={`border-r border-[#0a1810] px-2 py-2 text-center align-top ${i === 0 ? "border-l border-[#2d6b45] " : ""}${cellStyle(score, avail)}`}
                  >
                    {avail ? (
                      <>
                        <div className="text-[12px] font-bold tabular-nums">{Math.round(score * 100)}%</div>
                        <div className="mt-0.5 max-w-[90px] text-left text-[9px] leading-tight opacity-70 break-words">
                          {note}
                        </div>
                      </>
                    ) : (
                      <span className="text-[#3d5a48]">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}

          {/* ── Kusk section ── */}
          <tr className="bg-[#13261c]">
            <td
              colSpan={sorted.length + 1}
              className="sticky left-0 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-[#5ec98a]"
            >
              Kusk-parametrar — väger 38% av totalpoängen
            </td>
          </tr>
          {driverParams.map((p) => (
            <tr key={p.id} className="border-b border-[#0a1810] hover:bg-[#111c16]">
              <td className={`${sticky} w-[200px] min-w-[200px] px-3 py-2`}>
                <div className="text-[11px] font-medium text-[#c8ddd2]">{p.label}</div>
                <div className="mt-0.5 inline-block rounded bg-[#1a2e22] px-1 py-0 text-[8px] font-semibold text-[#5a7a68]">
                  vikt {p.weight}
                </div>
              </td>
              {sorted.map((h, i) => {
                const item = getItem(h, p.id, "kusk");
                const avail = item?.available ?? false;
                const score = item?.score ?? 0;
                const note = item?.note ?? "";
                return (
                  <td
                    key={h.number}
                    className={`border-r border-[#0a1810] px-2 py-2 text-center align-top ${i === 0 ? "border-l border-[#2d6b45] " : ""}${cellStyle(score, avail)}`}
                  >
                    {avail ? (
                      <>
                        <div className="text-[12px] font-bold tabular-nums">{Math.round(score * 100)}%</div>
                        <div className="mt-0.5 max-w-[90px] text-left text-[9px] leading-tight opacity-70 break-words">
                          {note}
                        </div>
                      </>
                    ) : (
                      <span className="text-[#3d5a48]">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}

          {/* ── Totalpoäng ── */}
          <tr className="border-t-2 border-[#2d6b45]">
            <td className={`${sticky} bg-[#0c1410] px-3 py-2.5 font-bold text-[#d4f5e2]`}>
              Totalpoäng
              <div className="text-[8px] font-normal text-[#5a7a68]">häst×62% + kusk×38%</div>
            </td>
            {sorted.map((h, i) => {
              const s = computeScores(h);
              return (
                <td
                  key={h.number}
                  className={`border-r border-[#1e3d2a] px-2 py-2.5 text-center font-bold tabular-nums ${i === 0 ? "bg-[#1a5c38] text-[#5ec98a]" : cellStyle(s.combined, true)}`}
                >
                  <div className="text-[14px]">{Math.round(s.combined * 100)}%</div>
                  <div className="text-[9px] font-normal opacity-70">
                    H:{Math.round(s.h * 100)} K:{Math.round(s.d * 100)}
                  </div>
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── LegScoreCard ─────────────────────────────────────────────────────────────

function LegScoreCard({ leg }: { leg: LegAnalysis }) {
  const ranked = [...leg.horses]
    .map((h) => ({ horse: h, scores: computeScores(h) }))
    .sort((a, b) => b.scores.combined - a.scores.combined);

  if (!ranked.length) return null;

  const top = ranked[0];
  const second = ranked[1];
  const gap = second ? top.scores.combined - second.scores.combined : 1;
  const confidence = Math.min(1, Math.max(0.2, 0.5 + gap * 3));

  return (
    <div className="overflow-hidden rounded-lg border border-[#1e3d2a] bg-[#0f1c14]">
      {/* ── Race header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e3d2a] bg-[#111c16] px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="text-base font-bold text-[#d4f5e2]">Avd {leg.leg}</span>
          {leg.raceName && <span className="text-sm text-[#7fa892]">— {leg.raceName}</span>}
          {leg.track && <span className="text-xs text-[#5a7a68]">· {leg.track}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <RecommendationBadge rec={leg.recommendation} />
          <ConfidenceBar score={confidence} />
        </div>
      </div>

      {/* ── Winner spotlight ── */}
      <WinnerSpotlight horse={top.horse} scores={top.scores} />

      {/* ── All horses ranked ── */}
      <div className="divide-y divide-[#0c1410] py-1">
        {ranked.map(({ horse, scores }, idx) => (
          <HorseRankRow
            key={horse.number}
            horse={horse}
            rank={idx + 1}
            isTop={idx === 0}
            scores={scores}
          />
        ))}
      </div>

      {/* ── Parameter table — always visible ── */}
      <div className="border-t border-[#1e3d2a] p-4">
        <div className="mb-2 text-[9px] font-bold uppercase tracking-widest text-[#5a7a68]">
          Alla parametrar med underlagsdata — sorterade efter totalpoäng
        </div>
        <ParameterTable leg={leg} />
      </div>
    </div>
  );
}

// ─── Public export ────────────────────────────────────────────────────────────

export function HorseScoreMatrix({ legs }: { legs: LegAnalysis[] }) {
  return (
    <div className="space-y-6">
      {legs.map((leg) => (
        <LegScoreCard key={leg.leg} leg={leg} />
      ))}
    </div>
  );
}
