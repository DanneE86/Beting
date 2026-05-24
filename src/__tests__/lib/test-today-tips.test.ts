import { describe, expect, it } from "vitest";
import {
  filterTodayTipsRows,
  getTodayTipsWindow,
  isTodayTipsRow,
  isWithinTodayTipsKickoff,
  mergeTodayTipsWithScoreboard,
  scoreboardToPlaceholder,
  type ScoreboardCandidate,
} from "@/lib/today-tips";

const NOW = new Date("2026-05-24T12:00:00Z");

describe("today-tips", () => {
  it("getTodayTipsWindow täcker 24h framåt med 30 min grace", () => {
    const w = getTodayTipsWindow(NOW);
    expect(w.windowStart.toISOString()).toBe("2026-05-24T11:30:00.000Z");
    expect(w.windowEnd.toISOString()).toBe("2026-05-25T12:00:00.000Z");
    expect(w.resolvedSince.toISOString()).toBe("2026-05-23T12:00:00.000Z");
  });

  it("inkluderar kommande match inom 24h", () => {
    const w = getTodayTipsWindow(NOW);
    expect(
      isTodayTipsRow(
        { event_date: "2026-05-25T11:00:00Z", actual_outcome: null },
        w,
        NOW,
      ),
    ).toBe(true);
  });

  it("exkluderar match längre fram än 24h", () => {
    const w = getTodayTipsWindow(NOW);
    expect(
      isTodayTipsRow(
        { event_date: "2026-05-26T13:00:00Z", actual_outcome: null },
        w,
        NOW,
      ),
    ).toBe(false);
  });

  it("inkluderar orättat tips som väntar facit", () => {
    const w = getTodayTipsWindow(NOW);
    expect(
      isTodayTipsRow(
        { event_date: "2026-05-23T15:00:00Z", actual_outcome: null },
        w,
        NOW,
      ),
    ).toBe(true);
  });

  it("inkluderar nyligen rättat tips även om matchen spelades tidigare", () => {
    const w = getTodayTipsWindow(NOW);
    expect(
      isTodayTipsRow(
        {
          event_date: "2026-05-20T18:00:00Z",
          actual_outcome: "H",
          resolved_at: "2026-05-24T10:00:00Z",
        },
        w,
        NOW,
      ),
    ).toBe(true);
  });

  it("exkluderar gammalt rättat tips", () => {
    const w = getTodayTipsWindow(NOW);
    expect(
      isTodayTipsRow(
        {
          event_date: "2026-05-20T18:00:00Z",
          actual_outcome: "H",
          resolved_at: "2026-05-20T20:00:00Z",
        },
        w,
        NOW,
      ),
    ).toBe(false);
  });

  it("isWithinTodayTipsKickoff kräver kickoff inom fönstret", () => {
    const w = getTodayTipsWindow(NOW);
    expect(isWithinTodayTipsKickoff("2026-05-24T18:00:00Z", w)).toBe(true);
    expect(isWithinTodayTipsKickoff("2026-05-26T13:00:00Z", w)).toBe(false);
  });

  it("filterTodayTipsRows filtrerar lista", () => {
    const w = getTodayTipsWindow(NOW);
    const rows = [
      { id: "a", event_date: "2026-05-25T11:00:00Z", actual_outcome: null },
      { id: "b", event_date: "2026-05-26T13:00:00Z", actual_outcome: null },
    ];
    const out = filterTodayTipsRows(rows, w, NOW);
    expect(out.map((r) => r.id)).toEqual(["a"]);
  });

  it("mergeTodayTipsWithScoreboard lägger till matcher utan prognos", () => {
    const predictions = [
      {
        id: "p1",
        league_id: "eng.1",
        home_id: "1",
        away_id: "2",
        home_name: "Burnley",
        away_name: "Wolves",
        event_date: "2026-05-24T17:00:00Z",
        actual_outcome: null,
        created_at: "2026-05-24T08:00:00Z",
      },
    ];
    const candidates: ScoreboardCandidate[] = [
      {
        leagueId: "eng.1",
        homeId: "3",
        awayId: "4",
        homeName: "Arsenal",
        awayName: "Chelsea",
        round: 38,
        utcTime: "2026-05-24T19:00:00Z",
      },
    ];
    const merged = mergeTodayTipsWithScoreboard(predictions, candidates);
    expect(merged).toHaveLength(2);
    expect(merged[1].home_name).toBe("Arsenal");
    expect(merged[1].predicted_outcome).toBeNull();
  });

  it("scoreboardToPlaceholder skapar väntande rad", () => {
    const row = scoreboardToPlaceholder({
      leagueId: "swe.1",
      homeId: "a",
      awayId: "b",
      homeName: "AIK",
      awayName: "DIF",
      round: 10,
      utcTime: "2026-05-24T18:00:00Z",
    });
    expect(row.id).toMatch(/^pending-/);
    expect(row.btts_call).toBeNull();
    expect(row.predicted_outcome).toBeNull();
  });
});
