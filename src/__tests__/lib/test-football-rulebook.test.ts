import { describe, expect, it } from "vitest";
import {
  applyFootballRules,
  backtestRulebook,
  buildRulebookFromAnalyses,
  optimizeRulebook,
  type FootballRule,
} from "@/lib/football-rulebook";
import type { MatchOutcomeAnalysis } from "@/lib/football-match-analyzer";

function fakeAnalysis(overrides: Partial<MatchOutcomeAnalysis> = {}): MatchOutcomeAnalysis {
  return {
    summary: "test",
    why: ["a"],
    lessons: ["b"],
    signals: [],
    tags: ["even-teams"],
    baselinePick: "H",
    baselineProbs: { home: 40, draw: 30, away: 30 },
    actualOutcome: "D",
    baselineCorrect: false,
    totalGoals: 2,
    lowScoring: true,
    highScoring: false,
    homeForm: null,
    awayForm: null,
    ...overrides,
  };
}

describe("football-rulebook", () => {
  it("bygger mined-regler vid tillräckligt många missar", () => {
    const analyses = Array.from({ length: 12 }, () => ({
      leagueId: "eng.1",
      analysis: fakeAnalysis({
        tags: ["even-teams", "baseline-miss"],
        baselineCorrect: false,
      }),
    }));
    const rules = buildRulebookFromAnalyses(analyses);
    expect(rules.some((r) => r.id === "draw-even-teams")).toBe(true);
  });

  it("justerar sannolikheter när trigger matchar", () => {
    const rules: FootballRule[] = [
      {
        id: "t",
        description: "test",
        triggerTag: "draw",
        adjust: { draw: 5 },
        weight: 1,
        source: "manual",
      },
    ];
    const { probs, applied } = applyFootballRules(
      { homeWinPct: 40, drawPct: 28, awayWinPct: 32 },
      rules,
      { tags: ["draw"] },
    );
    expect(applied).toContain("t");
    expect(probs.drawPct).toBeGreaterThan(28);
  });

  it("backtest returnerar träffsäkerhet", () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({
      league_id: "eng.1",
      home_id: `h${i % 6}`,
      away_id: `a${(i + 1) % 6}`,
      home_score: i % 3 === 0 ? 2 : 1,
      away_score: i % 3 === 1 ? 2 : 0,
      outcome: i % 3 === 0 ? "1" : i % 3 === 1 ? "2" : "X",
      btts: true,
      event_date: new Date(Date.UTC(2025, 9, 1 + i)).toISOString(),
    }));
    const bt = backtestRulebook(rows, [], 2.5, 1.15, 0.25);
    expect(bt.matches).toBeGreaterThan(10);
    expect(bt.baselineHitRate).toBeGreaterThan(0);
  });

  it("optimizeRulebook returnerar inte sämre än baseline", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({
      league_id: "eng.1",
      home_id: `h${i % 10}`,
      away_id: `a${(i + 3) % 10}`,
      home_score: (i * 7) % 4,
      away_score: (i * 5) % 3,
      outcome: (i * 7) % 4 > (i * 5) % 3 ? "1" : (i * 7) % 4 < (i * 5) % 3 ? "2" : "X",
      btts: true,
      event_date: new Date(Date.UTC(2025, 9, 1 + i)).toISOString(),
    }));
    const { rules, backtest } = optimizeRulebook(rows);
    expect(backtest.rulebookHitRate).toBeGreaterThanOrEqual(backtest.baselineHitRate - 0.001);
    if (rules.length > 0) {
      expect(backtest.rulebookHitRate).toBeGreaterThan(backtest.baselineHitRate);
    }
  });
});
