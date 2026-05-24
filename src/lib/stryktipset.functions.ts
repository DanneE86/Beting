import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getStryktipset = createServerFn({ method: "GET" }).handler(
  async () => {
    const res = await fetch(
      "https://api.www.svenskaspel.se/draw/1/stryktipset/draws",
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) throw new Error(`Svenska Spel ${res.status}`);
    const json: any = await res.json();
    const draw = json?.draws?.[0];
    if (!draw) throw new Error("Ingen aktiv kupong");
    return {
      drawNumber: draw.drawNumber,
      regCloseTime: draw.regCloseTime,
      comment: draw.drawComment,
      events: (draw.drawEvents ?? []).map((e: any) => {
        const m = e.match ?? {};
        const home = m.participants?.find((p: any) => p.type === "home");
        const away = m.participants?.find((p: any) => p.type === "away");
        return {
          n: e.eventNumber,
          home: home?.name ?? "",
          away: away?.name ?? "",
          league: m.league?.name ?? "",
          startTime: m.matchStart,
          odds: {
            one: e.odds?.one,
            x: e.odds?.x,
            two: e.odds?.two,
          },
          folket: {
            one: Number(e.svenskaFolket?.one ?? 0),
            x: Number(e.svenskaFolket?.x ?? 0),
            two: Number(e.svenskaFolket?.two ?? 0),
          },
        };
      }),
    };
  },
);

export const analyzeStryktipsetMatch = createServerFn({ method: "POST" })
  .inputValidator((d: {
    home: string;
    away: string;
    league: string;
    odds: { one?: string; x?: string; two?: string };
    folket: { one: number; x: number; two: number };
  }) =>
    z
      .object({
        home: z.string(),
        away: z.string(),
        league: z.string(),
        odds: z.object({
          one: z.string().optional(),
          x: z.string().optional(),
          two: z.string().optional(),
        }),
        folket: z.object({ one: z.number(), x: z.number(), two: z.number() }),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY saknas");

    const sys = `Du är expert på Stryktipset-analys. Värdera matchen utifrån:
- Odds (lägre = favorit). Implicerad sannolikhet ≈ 1/odds, men oddsen innehåller marginal.
- Svenska folkets fördelning (%) — hög % = streckad, låg % = chansvärde
- Lagens form, ligaposition och hemmaplansfördel utifrån din kunskap
- Eventuella kända avstängningar, skador, eller toppspelare som riskerar bänken

Skatta egna sannolikheter homePct/drawPct/awayPct (måste summera till 100). Utgå från oddsen, korrigera för marginal och justera utifrån form/personal. Förklara kort i probReasoning vad som driver procenten — t.ex. "Newcastle hemma med klar formfördel, oddsen 2,07 motsvarar ~48% men jag justerar upp till 55% pga X". Identifiera värdetecken: när folket streckar fel jämfört med din sannolikhet.
Returnera ENDAST JSON enligt schemat.`;

    const userPrompt = `Match: ${data.home} - ${data.away} (${data.league})
Odds: 1=${data.odds.one} X=${data.odds.x} 2=${data.odds.two}
Svenska folket: 1=${data.folket.one}% X=${data.folket.x}% 2=${data.folket.two}%

Ge tipsanalys.`;

    const res = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: sys },
            { role: "user", content: userPrompt },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "submit_tip",
                description: "Tipsanalys",
                parameters: {
                  type: "object",
                  properties: {
                    homePct: {
                      type: "number",
                      description: "Sannolikhet 1 (hemmaseger) i %, 0-100",
                    },
                    drawPct: {
                      type: "number",
                      description: "Sannolikhet X (oavgjort) i %, 0-100",
                    },
                    awayPct: {
                      type: "number",
                      description: "Sannolikhet 2 (bortaseger) i %, 0-100",
                    },
                    probReasoning: {
                      type: "string",
                      description:
                        "1-2 meningar som förklarar varför procenten ser ut som den gör (form, hemmafördel, oddsavvikelse mot folket)",
                    },
                    tip: {
                      type: "string",
                      enum: ["1", "X", "2", "1X", "X2", "12", "1X2"],
                      description: "Rekommenderad teckning (kan gardera)",
                    },
                    valueSign: {
                      type: "string",
                      enum: ["spik", "halvgardering", "helgardering", "chans", "ingen"],
                    },
                    rationale: { type: "string", description: "2-3 meningar svenska" },
                    keyPlayers: {
                      type: "string",
                      description: "Kort om kända avstängningar/skador/lineup-osäkerhet, eller 'inga kända' om okänt",
                    },
                  },
                  required: [
                    "homePct",
                    "drawPct",
                    "awayPct",
                    "probReasoning",
                    "tip",
                    "valueSign",
                    "rationale",
                    "keyPlayers",
                  ],
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "submit_tip" } },
        }),
      },
    );

    if (res.status === 429) throw new Error("För många förfrågningar.");
    if (res.status === 402) throw new Error("AI-krediter slut.");
    if (!res.ok) throw new Error(`AI-fel: ${res.status}`);

    const json: any = await res.json();
    const args =
      json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) throw new Error("Ogiltigt AI-svar");
    return JSON.parse(args) as {
      homePct: number;
      drawPct: number;
      awayPct: number;
      probReasoning: string;
      tip: string;
      valueSign: string;
      rationale: string;
      keyPlayers: string;
    };
  });

const eventSchema = z.object({
  n: z.number(),
  home: z.string(),
  away: z.string(),
  league: z.string(),
  odds: z.object({
    one: z.string().optional(),
    x: z.string().optional(),
    two: z.string().optional(),
  }),
  folket: z.object({ one: z.number(), x: z.number(), two: z.number() }),
});

export const recommendSpikar = createServerFn({ method: "POST" })
  .inputValidator((d: { events: unknown }) =>
    z.object({ events: z.array(eventSchema).min(1) }).parse(d),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY saknas");

    const sys = `Du är expert på Stryktipset-strategi. Välj exakt 5 SPIKAR (singelteckningar) för hela kupongen. Reglerna är HÅRDA:
- 2 spikar ska vara SÄKRA: tydliga favoriter med låga odds OCH högt streckad av folket. Tecken oftast "1".
- 3 spikar ska vara SKRÄLLAR: matcher där du tror folket har streckat fel. Välj en utgång som folket har låg % på (helst <30%) men där oddsen och dina kunskaper antyder att utgången är möjlig (sannolikhet >25%). Det kan vara X eller 2 (eller 1 om bortalaget är streckat).
- Spikarna måste vara från OLIKA matcher. Använd matchnumret (eventNumber) för att referera.
- Förklara kort varje spik (2 meningar): varför du tror på det och varför det är säkert/skräll.
Returnera ENDAST JSON enligt schemat.`;

    const compact = data.events
      .map(
        (e) =>
          `#${e.n} ${e.home} - ${e.away} (${e.league}) | odds: 1=${e.odds.one} X=${e.odds.x} 2=${e.odds.two} | folket: 1=${e.folket.one}% X=${e.folket.x}% 2=${e.folket.two}%`,
      )
      .join("\n");

    const userPrompt = `Hela kupongen:\n${compact}\n\nVälj 5 spikar (2 säkra + 3 skräll).`;

    const res = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: sys },
            { role: "user", content: userPrompt },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "submit_spikar",
                description: "Lista över 5 spikar",
                parameters: {
                  type: "object",
                  properties: {
                    spikar: {
                      type: "array",
                      minItems: 5,
                      maxItems: 5,
                      items: {
                        type: "object",
                        properties: {
                          eventNumber: { type: "number" },
                          match: { type: "string", description: "Hemma - Borta" },
                          tecken: { type: "string", enum: ["1", "X", "2"] },
                          typ: {
                            type: "string",
                            enum: ["säker", "skräll"],
                          },
                          confidencePct: {
                            type: "number",
                            description: "Din skattade sannolikhet 0-100 för tecknet",
                          },
                          folketPct: {
                            type: "number",
                            description: "Folkets % på samma tecken",
                          },
                          motivering: {
                            type: "string",
                            description: "1-2 meningar svenska",
                          },
                        },
                        required: [
                          "eventNumber",
                          "match",
                          "tecken",
                          "typ",
                          "confidencePct",
                          "folketPct",
                          "motivering",
                        ],
                      },
                    },
                  },
                  required: ["spikar"],
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "submit_spikar" } },
        }),
      },
    );

    if (res.status === 429) throw new Error("För många förfrågningar.");
    if (res.status === 402) throw new Error("AI-krediter slut.");
    if (!res.ok) throw new Error(`AI-fel: ${res.status}`);

    const json: any = await res.json();
    const args =
      json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) throw new Error("Ogiltigt AI-svar");
    return JSON.parse(args) as {
      spikar: Array<{
        eventNumber: number;
        match: string;
        tecken: "1" | "X" | "2";
        typ: "säker" | "skräll";
        confidencePct: number;
        folketPct: number;
        motivering: string;
      }>;
    };
  });

// Build a Stryktipset system whose total cost stays within budget (default 196 kr).
// Cost = product of signs per match. 1 sign = 1, halvgardering (2 signs) = 2, helgardering (1X2) = 3.
export const buildSystem = createServerFn({ method: "POST" })
  .inputValidator((d: { events: unknown; minPayout?: number; targetBudget?: number; maxBudget?: number; minBudget?: number }) =>
    z
      .object({
        events: z.array(eventSchema).min(1),
        minPayout: z.number().min(1000).max(1000000).default(50000),
        minBudget: z.number().min(50).max(2000).default(500),
        targetBudget: z.number().min(50).max(2000).default(648),
        maxBudget: z.number().min(100).max(2000).default(750),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY saknas");

    const sys = `Du är expert på Stryktipset-systemspel (gamblingcabin.se-stil reducering). Bygg en hel rad på 13 matcher.

KOSTNADSREGLER (HÅRDA):
- Spik (1 tecken) = 1 kr, halvgardering (2 tecken) = 2 kr, helgardering (1X2) = 3 kr.
- Total kostnad = produkten av kostnaderna för alla 13 matcher.
- Sikta på ${data.targetBudget} kr. INTERVALL: ${data.minBudget}–${data.maxBudget} kr (HÅRT).
- Vanliga radstorlekar i intervallet: 4 halv + 2 hel + 7 spik = 144… nej. Exempel: 6 halv × 1 hel = 192, 7 halv × 1 hel = 384, 5 halv × 2 hel = 288, 4 halv × 3 hel = 432, 3 halv × 4 hel = 648, 7 halv × 1 hel = 384.
- För att landa 500–750 kr använd typiskt: 3 helgarderingar + 4–5 halvgarderingar + resten spikar (3×16=48 baspris, ×2^halv).

RÖD GRUPP / SKRÄLLAR (gamblingcabin reducering):
- "Röd grupp" = skrälltecken där folket% < 25 på det tecknet.
- Räkna antalet skrälltecken som ingår i raden (om en halv-/helgardering innehåller ett tecken med folket<25% räknas det som 1 skräll).
- HÅRDA villkor: minst 1 och max 3 skrälltecken totalt i raden. Idealt 2.
- Sätt skrällarna på matcher där dina sannolikheter avviker tydligt mot folkets streck (värdespel).

UTDELNINGSREGLER (omsättning Stryktipset typiskt 20–30 milj kr/omgång):
- 13 rätt: snitt 400 000 kr. 12 rätt: snitt 4 000 kr. 11 rätt: snitt 120 kr.
- expectedPayout = P(13)×400000 + P(12)×4000 + P(11)×120.
- expectedPayout MÅSTE vara ≥ ${data.minPayout} kr. Lägg på fler garderingar (inom budget) tills villkoret håller.
- winProbability = produkten av sannolikheten för rätt tecken per match.

SPELRÅD:
- Spika tydliga favoriter (lågt odds, högt streckade, bra form/hemmaplan).
- Halvgardera oddsmatcher där folkets streck avviker från ditt confidence.
- Helgardera enbart rena lottmatcher.
- Returnera EXAKT 13 picks i ordning matchnummer 1–13.

Returnera ENDAST JSON enligt schemat.`;

    const compact = data.events
      .map(
        (e) =>
          `#${e.n} ${e.home} - ${e.away} (${e.league}) | odds: 1=${e.odds.one} X=${e.odds.x} 2=${e.odds.two} | folket: 1=${e.folket.one}% X=${e.folket.x}% 2=${e.folket.two}%`,
      )
      .join("\n");

    const userPrompt = `Hela kupongen:\n${compact}\n\nBygg system med expectedPayout ≥ ${data.minPayout} kr (max budget ${data.maxBudget} kr).`;

    const res = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: sys },
            { role: "user", content: userPrompt },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "submit_system",
                description: "13 picks + totalkostnad",
                parameters: {
                  type: "object",
                  properties: {
                    picks: {
                      type: "array",
                      minItems: 13,
                      maxItems: 13,
                      items: {
                        type: "object",
                        properties: {
                          eventNumber: { type: "number" },
                          tecken: {
                            type: "string",
                            enum: ["1", "X", "2", "1X", "X2", "12", "1X2"],
                          },
                          cost: {
                            type: "number",
                            description: "1 för spik, 2 för halv, 3 för hel",
                          },
                          motivering: {
                            type: "string",
                            description: "1 mening varför",
                          },
                        },
                        required: ["eventNumber", "tecken", "cost", "motivering"],
                      },
                    },
                    totalCost: {
                      type: "number",
                      description: `Produkten av cost per match — får INTE överskrida ${data.maxBudget} kr`,
                    },
                    winProbability: {
                      type: "number",
                      description: "Sannolikhet (0-1) att hela systemet ger 13 rätt",
                    },
                    expectedPayout: {
                      type: "number",
                      description: `Förväntad utdelning i kr — måste vara ≥ ${data.minPayout}`,
                    },
                    strategy: {
                      type: "string",
                      description: "1-2 meningar om systemvalet",
                    },
                  },
                  required: ["picks", "totalCost", "winProbability", "expectedPayout", "strategy"],
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "submit_system" } },
        }),
      },
    );

    if (res.status === 429) throw new Error("För många förfrågningar.");
    if (res.status === 402) throw new Error("AI-krediter slut.");
    if (!res.ok) throw new Error(`AI-fel: ${res.status}`);

    const json: any = await res.json();
    const args =
      json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) throw new Error("Ogiltigt AI-svar");
    const parsed = JSON.parse(args) as {
      picks: Array<{
        eventNumber: number;
        tecken: string;
        cost: number;
        motivering: string;
      }>;
      totalCost: number;
      winProbability: number;
      expectedPayout: number;
      strategy: string;
    };
    // Authoritative cost from picks. Deterministically adjust until totalCost
    // ligger inom [minBudget, maxBudget].
    const eventByN = new Map(data.events.map((e) => [e.n, e]));
    const costOf = (ps: typeof parsed.picks) =>
      ps.reduce((acc, p) => acc * (p.cost || 1), 1);
    const folketOf = (ev: any, sign: "1" | "X" | "2") =>
      sign === "1" ? ev.folket.one : sign === "X" ? ev.folket.x : ev.folket.two;
    const sortByFolket = (ev: any) =>
      (["1", "X", "2"] as Array<"1" | "X" | "2">).sort(
        (a, b) => folketOf(ev, b) - folketOf(ev, a),
      );

    // 1) Downgrade if over maxBudget — least confident first.
    let safety = 30;
    while (costOf(parsed.picks) > data.maxBudget && safety-- > 0) {
      const candidates = parsed.picks
        .map((p) => {
          const ev = eventByN.get(p.eventNumber);
          const maxF = ev ? Math.max(ev.folket.one, ev.folket.x, ev.folket.two) : 0;
          return { p, ev, maxF };
        })
        .filter((c) => c.p.cost > 1)
        .sort((a, b) => b.p.cost - a.p.cost || a.maxF - b.maxF);
      if (!candidates.length) break;
      const { p, ev } = candidates[0];
      if (!ev) break;
      const sorted = sortByFolket(ev);
      if (p.cost === 3) {
        p.tecken = `${sorted[0]}${sorted[1]}`;
        p.cost = 2;
      } else if (p.cost === 2) {
        p.tecken = sorted[0];
        p.cost = 1;
      }
    }

    // 2) Upgrade if below minBudget — pick spikar/halvgarderingar with the
    // lowest dominant folket% (most osäkra) and add a sign.
    safety = 30;
    while (costOf(parsed.picks) < data.minBudget && safety-- > 0) {
      const candidates = parsed.picks
        .map((p) => {
          const ev = eventByN.get(p.eventNumber);
          const maxF = ev ? Math.max(ev.folket.one, ev.folket.x, ev.folket.two) : 100;
          return { p, ev, maxF };
        })
        .filter((c) => c.p.cost < 3 && c.ev)
        .sort((a, b) => a.p.cost - b.p.cost || a.maxF - b.maxF);
      if (!candidates.length) break;
      const { p, ev } = candidates[0];
      const sorted = sortByFolket(ev);
      if (p.cost === 1) {
        p.tecken = `${sorted[0]}${sorted[1]}`;
        p.cost = 2;
      } else if (p.cost === 2) {
        p.tecken = "1X2";
        p.cost = 3;
      }
      if (costOf(parsed.picks) > data.maxBudget) {
        // overshot — revert and stop
        if (p.cost === 3) {
          p.tecken = `${sorted[0]}${sorted[1]}`;
          p.cost = 2;
        } else if (p.cost === 2) {
          p.tecken = sorted[0];
          p.cost = 1;
        }
        break;
      }
    }

    // 3) Räkna och justera skrälltecken (folket<25%) inom [1,3].
    const skrällThreshold = 25;
    const skrällCount = (ps: typeof parsed.picks) =>
      ps.reduce((n, p) => {
        const ev = eventByN.get(p.eventNumber);
        if (!ev) return n;
        const signs = p.tecken.split("") as Array<"1" | "X" | "2">;
        return n + (signs.some((s) => folketOf(ev, s) < skrällThreshold) ? 1 : 0);
      }, 0);

    const realCost = costOf(parsed.picks);
    return {
      ...parsed,
      totalCost: realCost,
      skrällCount: skrällCount(parsed.picks),
      minPayout: data.minPayout,
      minBudget: data.minBudget,
      targetBudget: data.targetBudget,
      maxBudget: data.maxBudget,
    };
  });
