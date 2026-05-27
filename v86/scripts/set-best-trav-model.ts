#!/usr/bin/env npx tsx
import { loadEnv } from "../../src/lib/script-env";
loadEnv();

import { updateModelPrompt } from "../../src/lib/model-prompts.server";

async function main() {
  const commit = process.env.BEST_TRAV_COMMIT ?? "unknown";
  const now = new Date().toISOString();
  const payload = {
    bestModel: {
      commit,
      markedAt: now,
      notes: "Pinned as best model (V85 uses yesterday core behavior; Regel 3/4 disabled).",
      enabledRules: ["rule1", "rule2"],
      disabledRules: ["rule3", "rule4"],
    },
  };

  await updateModelPrompt({
    scope: "trav:best",
    promptText: JSON.stringify(payload, null, 2),
    lastSampleCount: 0,
  });
  console.log("OK: saved trav:best");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

