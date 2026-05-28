import { describe, expect, it } from "vitest";
import { TRAV_RULE_IDS, TRAV_RULE_IDS_WITH_ALL } from "@/lib/v86.functions";

describe("v86 rule-id validering", () => {
  it("tillåter rule5 i alla relevanta enum-listor", () => {
    expect(TRAV_RULE_IDS).toContain("rule5");
    expect(TRAV_RULE_IDS_WITH_ALL).toContain("rule5");
    expect(TRAV_RULE_IDS).toContain("rule6");
    expect(TRAV_RULE_IDS_WITH_ALL).toContain("rule6");
  });

  it("behåller all i history-filterlistan", () => {
    expect(TRAV_RULE_IDS_WITH_ALL).toContain("all");
  });
});
