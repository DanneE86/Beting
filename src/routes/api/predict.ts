import "@tanstack/react-start";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { generateMatchPrediction } from "@/lib/predict.functions";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const PredictSchema = z.object({
  leagueId: z.string(),
  homeId: z.string(),
  awayId: z.string(),
  homeName: z.string(),
  awayName: z.string(),
  state: z.enum(["pre", "in", "post"]).optional(),
  round: z.number().int().nullable().optional(),
});

async function getLatestSaved(leagueId: string, homeId: string, awayId: string) {
  const { data } = await supabaseAdmin
    .from("predictions")
    .select(
      "home_win_pct, draw_pct, away_win_pct, predicted_score, confidence, betting_tip, key_factors, lineup_released",
    )
    .eq("league_id", leagueId)
    .eq("home_id", homeId)
    .eq("away_id", awayId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    homeWinPct: Number(data.home_win_pct),
    drawPct: Number(data.draw_pct),
    awayWinPct: Number(data.away_win_pct),
    predictedScore: data.predicted_score,
    confidence: data.confidence,
    keyFactors: (data.key_factors as string[] | null) ?? [],
    bettingTip: data.betting_tip ?? "",
    lineupNotes: "",
    lineupValueShift: "okänt" as const,
    lineupReleased: data.lineup_released ?? false,
    missingHome: [] as string[],
    missingAway: [] as string[],
    cached: true,
  };
}

export const Route = createFileRoute("/api/predict")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        try {
          const body = PredictSchema.parse(await request.json());

          // Återanvänd alltid senaste sparade tipset om matchen är igång eller slut —
          // vi vill inte skriva över tipset under spelets gång.
          if (body.state === "in" || body.state === "post") {
            const saved = await getLatestSaved(body.leagueId, body.homeId, body.awayId);
            if (saved) return Response.json(saved);
          }

          const prediction = await generateMatchPrediction(body);
          return Response.json(prediction);
        } catch (error) {
          const message =
            error instanceof z.ZodError
              ? "Ogiltig matchdata för AI-prognos."
              : error instanceof Error
                ? error.message
                : "Kunde inte hämta AI-prognos.";

          console.error("AI predict route failed", error);
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
