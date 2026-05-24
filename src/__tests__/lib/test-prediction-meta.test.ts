import { describe, expect, it } from "vitest";
import {
  extractBtts,
  mergePreliminaryPostmortem,
  PREDICTION_MODEL_VERSION,
} from "@/lib/prediction-meta";

describe("prediction-meta", () => {
  it("PREDICTION_MODEL_VERSION är positiv", () => {
    expect(PREDICTION_MODEL_VERSION).toBeGreaterThan(0);
  });

  it("extractBtts läser kolumner före postmortem", () => {
    expect(
      extractBtts({
        btts_call: "ja",
        btts_reason: "kolumn",
        postmortem: { bttsCall: "nej", bttsReason: "gammalt" },
      }),
    ).toEqual({ call: "ja", reason: "kolumn" });
  });

  it("extractBtts faller tillbaka på postmortem", () => {
    expect(
      extractBtts({
        postmortem: { bttsCall: "osäker", bttsReason: "legacy" },
      }),
    ).toEqual({ call: "osäker", reason: "legacy" });
  });

  it("mergePreliminaryPostmortem behåller färdig analys", () => {
    const existing = { verdict: "träff", preliminary: false, foo: 1 };
    expect(mergePreliminaryPostmortem(existing, "ja", "ny")).toEqual(existing);
  });

  it("mergePreliminaryPostmortem skapar preliminär BTTS", () => {
    expect(mergePreliminaryPostmortem(null, "nej", "test")).toEqual({
      bttsCall: "nej",
      bttsReason: "test",
      preliminary: true,
    });
  });
});
