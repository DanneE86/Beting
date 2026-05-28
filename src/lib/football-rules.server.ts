import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { applyFootballRules, buildRuleContext, type FootballRule } from "./football-rulebook";

let cachedRules: FootballRule[] | null = null;
let cachedAt = 0;
const TTL_MS = 5 * 60_000;

/** Laddar aktiv regelbok från DB eller opta_cache-fallback. */
export async function getActiveFootballRules(): Promise<FootballRule[]> {
  if (cachedRules && Date.now() - cachedAt < TTL_MS) return cachedRules;

  const { data: row, error } = await supabaseAdmin
    .from("football_rulebook")
    .select("rules")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!error && row?.rules && Array.isArray(row.rules)) {
    cachedRules = row.rules as FootballRule[];
    cachedAt = Date.now();
    return cachedRules;
  }

  const { data: cache } = await supabaseAdmin
    .from("opta_cache")
    .select("payload")
    .eq("cache_key", "football_rulebook_latest")
    .maybeSingle();

  const rules = (cache?.payload as { rules?: FootballRule[] } | null)?.rules;
  if (rules?.length) {
    cachedRules = rules;
    cachedAt = Date.now();
    return rules;
  }

  return [];
}

export function applyFootballRulebookToProbs(
  probs: { homeWinPct: number; drawPct: number; awayWinPct: number },
  rules: FootballRule[],
  ctx: {
    homePpg?: number;
    awayPpg?: number;
    leagueAvgGoals?: number;
    tags?: string[];
  },
) {
  if (!rules.length) return { probs, applied: [] as string[] };
  const leagueAvg = ctx.leagueAvgGoals ?? 2.55;
  if (ctx.homePpg != null && ctx.awayPpg != null) {
    const ruleCtx = buildRuleContext(
      { attack: 1.2, defense: 1.1, ppg: ctx.homePpg, n: 8 },
      { attack: 1.1, defense: 1.2, ppg: ctx.awayPpg, n: 8 },
      probs,
      leagueAvg,
    );
    if (ctx.tags?.length) ruleCtx.tags.push(...ctx.tags);
    return applyFootballRules(probs, rules, ruleCtx);
  }
  return applyFootballRules(probs, rules, { tags: ctx.tags ?? [] });
}
