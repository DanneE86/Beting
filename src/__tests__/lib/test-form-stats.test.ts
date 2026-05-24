import { describe, expect, it } from "vitest";
import {
  buildH2H,
  computeGoalStats,
  daysSinceLast,
  goalStatsForVenue,
  homeAwaySplitForm,
  matchWeight,
  type ScheduleMatchRow,
} from "@/lib/form-stats";

const sample: ScheduleMatchRow[] = [
  {
    result: "W",
    score: "2-1",
    opponent: "A",
    homeAway: "home",
    usScore: 2,
    themScore: 1,
    date: "2025-01-01T00:00:00Z",
    opponentId: "opp-1",
  },
  {
    result: "D",
    score: "1-1",
    opponent: "B",
    homeAway: "away",
    usScore: 1,
    themScore: 1,
    date: "2025-01-08T00:00:00Z",
    opponentId: "opp-2",
  },
  {
    result: "L",
    score: "0-2",
    opponent: "C",
    homeAway: "home",
    usScore: 0,
    themScore: 2,
    date: "2025-01-15T00:00:00Z",
    opponentId: "opp-1",
  },
];

describe("form-stats", () => {
  it("matchWeight är högre för nyare matcher", () => {
    const recent = matchWeight(new Date().toISOString());
    const old = matchWeight("2020-01-01T00:00:00Z");
    expect(recent).toBeGreaterThan(old);
  });

  it("computeGoalStats räknar BTTS och sample", () => {
    const stats = computeGoalStats(sample);
    expect(stats?.sample).toBe(3);
    expect(stats?.bttsPct).toBeGreaterThan(0);
    expect(stats?.failedToScore).toBeGreaterThanOrEqual(0);
  });

  it("goalStatsForVenue filtrerar hemma/borta", () => {
    const home = goalStatsForVenue(sample, "home");
    expect(home?.avgGoalsFor).toBeGreaterThan(0);
    expect(goalStatsForVenue([], "away")).toBeNull();
  });

  it("homeAwaySplitForm returnerar senaste fem", () => {
    const form = homeAwaySplitForm(sample, "home");
    expect(form.length).toBeGreaterThan(0);
    expect(form[0]).toHaveProperty("result");
  });

  it("buildH2H hittar möten mot motståndare", () => {
    const h2h = buildH2H(sample, "opp-1");
    expect(h2h).toHaveLength(2);
  });

  it("daysSinceLast från senaste match", () => {
    expect(daysSinceLast([])).toBeNull();
    expect(daysSinceLast(sample)).toBeGreaterThanOrEqual(0);
  });
});
