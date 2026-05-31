/**
 * Seeder för ligaspecifika tränings-prompts.
 * Skriver kunskapsbaserade kalibrerings-regler för alla 31 ligor.
 *
 *   npx tsx scripts/seed-league-prompts.ts
 *   npx tsx scripts/seed-league-prompts.ts --dry   (visa utan spara)
 *   npx tsx scripts/seed-league-prompts.ts --league=bra.1  (en liga)
 *
 * Befintliga prompts skrivs INTE över om --force inte används.
 *   npx tsx scripts/seed-league-prompts.ts --force
 */

import { loadEnv, createScriptSupabase } from "../src/lib/script-env";

loadEnv();

const PROMPTS: Record<string, string> = {
  "eng.1": `Premier League (England) — kalibrering:
Hög paritet i mid-table (positioner 7–17): sänk confidence till låg för dessa möten.
Top-6 (Arsenal, Chelsea, Liverpool, City, United, Spurs) är säkra favoriter mot bottenlaget hemma men inte borta mot mid-table — undvik hög confidence i bortamatcher för top-6.
Hemmaplansfördel måttlig (~52% hemmasegrupp).
BTTS: ~55% (europeisk standard, behåll).
Oavgjort vanligare i möten mid-table vs mid-table (~26–28%).
Undvik alltid hög confidence på derby-matcher (Merseyside, Manchester, London-derbyn).`,

  "esp.1": `La Liga (Spanien) — kalibrering:
Real Madrid och Barcelona är pålitliga favoriter hemma och mot bottenlag borta — hög confidence tillåten.
Resten av ligan (Atlético, Sevilla, Villarreal vs varandra): sänk confidence ett steg, paritet är hög.
Taktisk ligakultur: fler mål under 2.5 (~48%) jämfört med PL.
BTTS: ~52%, använd standardvärdet.
Undvik hög confidence om favoritlaget spelar CL mid-week (rotation förekommer).
Hemmaplansfördel normal (~54%).`,

  "ger.1": `Bundesliga (Tyskland) — kalibrering:
Bundesliga är den mest målrika toppligan: snitt ~3.1 mål/match. Vikta up over-2.5 och BTTS.
BTTS: ~60% — sätt alltid "ja" som default för match med offensiva lag.
Bayern München borta mot mid-table: pålitlig favorit (hög confidence tillåten).
RB Leipzig, Leverkusen, Dortmund: säkra favoriter hemma men kan tappa borta mot motiverade lag.
Bottenlag hemma kan hota med snabba kontringar mot toplag — undvik hög confidence på borta-toplag.`,

  "ger.2": `2. Bundesliga (Tyskland) — kalibrering:
Extremt jämn liga, hög varians. Sänk alltid confidence ett steg vs Bundesliga.
Nypromoverade lag slår ofta bakut under säsongens första 10 omgångar.
Hemmaplansfördel starkare (~56%) pga passionerade fans i mindre städer.
BTTS: ~55%, men data är tunnare — var försiktig med BTTS hög confidence.
Favoritlaget bestraffas inte alltid av tabellposition — form är viktigare.`,

  "ita.1": `Serie A (Italien) — kalibrering:
Defensiv ligakultur: ~52% under-2.5 mål. Sänk over-2.5 och BTTS-"ja"-sannolikhet.
BTTS: ~47% — standard är "nej" om inte båda lagen har offensiv form.
Senar mål är vanliga (70–90 min) — faktorn förändrar inte 1X2 men påverkar live.
Inter, Juventus, Napoli, Roma, Milan — pålitliga favoriter hemma. Borta: sänk ett steg.
Mindre lag i södra Italien (Lecce, Frosinone, Salernitana) kämpar hårt hemma — undvik hög confidence på bortafavorit.`,

  "fra.1": `Ligue 1 (Frankrike) — kalibrering:
PSG är den klara favoriten i nästan alla matcher — hög confidence mot alla utom Marseille hemma.
Resten av ligan (Lyon, Monaco, Lille, Lens vs varandra): hög paritet, sänk confidence.
Hemmaplansfördel lite starkare än PL (~55%) pga supporterkultur.
BTTS: ~52%, standard.
Ligue 1 har fler röda kort och dramatiska vändningar — vikta upp varians för lång confidence.
Marseille hemma (Vélodrome) är en av Europas starkaste hemmaplanar — aldrig hög confidence på bortalag.`,

  "uefa.champions": `Champions League — kalibrering:
Hemmalag favoriseras tydligt i gruppspel (~56% hemmavinst).
First-leg i knockout: försiktigare matcher, fler 0–0 och 1–0. Sänk BTTS till "osäker".
Topfavoriter (Real Madrid, City, Bayern, PSG, Arsenal) är pålitliga mot lag utanför top-15 Europa.
Rotation förekommer när lagen redan gått vidare i gruppspelet — sänk confidence för sista gruppmatchen.
Sensationer är vanliga i knockout (underbelly-effekt): undvik hög confidence mot "underskor".`,

  "uefa.europa": `Europa League — kalibrering:
Starka PL/Serie A-lag dominerar men roterar ofta i tidigt skede — sänk confidence i gruppspelsmatcher.
Turkiska, portugisiska, holländska lag (Fener, Benfica, Ajax) är farliga hemma.
Hemmaplansfördel viktig i knockout.
BTTS: ~54%, lite högre än CL pga mer offensivt spel.
Undvik hög confidence mot lag som spelar sin enda chans till Europa (livräddningsinsats).`,

  "uefa.europa.conf": `Conference League — kalibrering:
Lägst nivå av UEFA-cuperna — kvalitetsskillnader är stora.
Nordiska, östeuropeiska och israeliska lag kan överraska mot rikare ligor.
Hemmaplansfördel exceptionellt viktig (lång resa för bortalagets fans, atmosfär).
Sänk alltid confidence för möten där lagen är från ligor med tunn historikdata.
BTTS: ~52%, standard.`,

  "pol.1": `Ekstraklasa (Polen) — kalibrering:
Legia Warszawa, Lech Poznań, Raków Częstochowa dominerar — pålitliga favoriter hemma.
Ligan är taktisk och mer sluten än skandinaviska ligor: BTTS ~45%.
Hemmaplansfördel stark (~57%), speciellt för Legia (Warszawa-atmosfär).
Bottenlag kämpar stenhårt hemma — undvik hög confidence borta mot lag i botten.
Statistikdata är tunnare än top-5-ligor — sänk ett confidence-steg generellt.`,

  "nor.1": `Eliteserien (Norge) — kalibrering:
Bodø/Glimt spelar innanför Polarcirkeln — hemma i Bodø (altitude + kyla) är signifikant fördel. Aldrig hög confidence på bortalag mot Bodø hemma.
Molde och Rosenborg är traditionsstarka men Bodø/Glimt dominerar nu (Europa-kaliber).
Säsong april–november: tidig säsong (april–maj) kan ha sämre banor pga kyla.
BTTS: ~50%, standard.
Hemmaplansfördel måttlig (~53%) utom Bodø.`,

  "den.1": `Superligaen (Danmark) — kalibrering:
FC København (FCK) dominerar med stor marginal — hög confidence tillåten för FCK hemma och mot bottenlag.
Brøndby är enda stabila utmanaren — matcherna FCK vs Brøndby är oförutsägbara.
Resten: paritet hög, sänk confidence.
Danskt spel: taktiskt och organiserat, lägre mål (~2.6/match).
BTTS: ~48%, lite lägre än snitt.`,

  "swe.1": `Allsvenskan (Sverige) — kalibrering:
Malmö FF är den klaraste favoriten totalt sett (CL-kaliber i Skandinavien).
Djurgårdens IF, AIK, IFK Göteborg, Hammarby — starka hemmalag med passionerade supportrar.
Hemmaplansfördel stark (~55%) pga intensiv supporterkultur.
Säsong april–november: beakta underbara matcher i oktober-november (kyla, trött trupp).
BTTS: ~50%, standard.
Bottenlag i Allsvenskan är ibland nykomlingar — undvik hög confidence mot dem borta.`,

  "swe.2": `Superettan (Sverige) — kalibrering:
Hög paritet genomgående — sänk alltid confidence ett steg vs Allsvenskan.
Nypromoverade/degraderade lag är svåra att modellera.
Hemmaplansfördel viktig (~56%).
Statistikdata är tunnare — undvik hög confidence generellt.
BTTS: ~48%, lite lägre.`,

  "bel.1": `First Division A (Belgien) — kalibrering:
Club Brugge och Anderlecht är favoriter men Gent, Union SG och Genk ger motstånd.
Belgisk liga: mer öppen och målrik än fransk (~2.9 mål/match).
BTTS: ~55% — vikta upp något.
Hemmaplansfördel normal (~53%).
Playoff-system i Belgien (Championship Play-offs, relegation play-offs) — tabellposition kan vara missvisande.`,

  "sco.1": `Scottish Premiership (Skottland) — kalibrering:
Celtic är säker favorit i nästan alla matcher — hög confidence tillåten mot alla utom Rangers hemma.
Rangers är enda konkurrenten: Old Firm-möten är oförutsägbara, aldrig hög confidence.
Utanför Celtic/Rangers: hög paritet, sänk confidence.
Celtic hemma (Celtic Park, 60 000) är en av Europas starkaste hemmaplanar — bortalag tappar.
BTTS: ~52%, standard.`,

  "bra.1": `Brasileirao Série A (Brasilien) — kalibrering:
HÖG VARIANS: träffsäkerhet ~47% 1X2 mot europeiska ~55%. Sänk alltid confidence ett steg.
BTTS: ~62% — vikta alltid upp "ja" jämfört med europeisk standard.
Hemmaplansfördel real men kompenseras av flygresor — kalibrera ner något vs Europa.
Nypromoverade lag (från Série B) saknar A-seriehistorik — extra låg confidence.
Santos FC: tillbaka i A 2025 efter Série B 2024. Defensiv instabilitet tidigt i säsongen.
Rotation är norm (Copa do Brasil, Libertadores/Sudamericana parallellt) — tolka inte svag startelva som svagt lag.
Copa-veckor (midvecka): toplag roterar — sänk confidence för helgmatch om de spelade Copa midvecka.`,

  "arg.1": `Primera División (Argentina) — kalibrering:
EXTREMT HÖG VARIANS: starkare hemmaplansfördel än Brasilien (~58% hemmasegrupp).
Boca Juniors och River Plate hemma: aldrig hög confidence på bortalag mot dessa.
Superclásico (Boca vs River): helt oförutsägbar, sätt alltid låg confidence.
BTTS: ~55% — vikta upp.
Argentinsk fotboll: emotionell, volatil, sent mål vanliga.
Rotation vanlig (Libertadores parallellt).
Sänk alltid confidence ett steg vs europeiska ligor.`,

  "chi.1": `Primera División (Chile) — kalibrering:
Colo-Colo dominerar men Universidad de Chile och U. Católica är konkurrenter.
Chilenskt fotboll: öppnare än Argentina, mer taktiskt stabil.
BTTS: ~54%, lite över standard.
Hemmaplansfördel ~55%.
Data-kvalitet lägre än toppligor — sänk ett confidence-steg generellt.
Colo-Colo hemma (Estadio Monumental, Santiago): stark hemmafördel.`,

  "conmebol.libertadores": `Copa Libertadores — kalibrering:
Brasilianska och argentinska lag dominerar (Flamengo, River Plate, Boca, Atlético MG).
Hemmaplansfördel exceptionellt stark i SA-miljö — bortalag räknar med att förlora first-leg.
Altitude påverkar kraftigt: La Paz (Bolivia, 3 600 m), Quito, Bogotá — hemmalag har STOR fördel.
First-leg i knockout: kalkylerat spel, sänk BTTS ("nej" är vanligare).
Ecuadorianska, colombianska och uruguayanska lag underskattas ofta — var försiktig.
Sänk alltid confidence ett steg pga hög varians i SA-kontext.`,

  "conmebol.sudamericana": `Copa Sudamericana — kalibrering:
Lägre nivå än Libertadores, större kvalitetsskillnader.
Colombianska (Atletico Nacional), ecuadorianska, uruguayanska lag vanliga finalister.
Hemmaplansfördel mycket stark, speciellt i Colombia och Ecuador.
Sänk alltid confidence ett steg — tunn historikdata för många deltagande lag.
BTTS: ~54%, lite ökat pga mer offensivt spel.`,

  "jpn.1": `J.League (Japan) — kalibrering:
Japansk fotboll: taktisk, organiserad, lägre individuell varians än europeisk.
Vissel Kobe, Yokohama F. Marinos, Urawa Reds, Gamba Osaka — toplag.
Hemmaplansfördel normal (~53%).
BTTS: ~52%, standard.
J.League data är rimlig men statistik kan vara tunn för nykomlingar.
Säsong februari–december — beakta sommarperiod (extrem hetta i Japan, kan påverka form).`,

  "kor.1": `K League 1 (Sydkorea) — kalibrering:
Jeonbuk Hyundai Motors, Ulsan Hyundai, Suwon FC — toplag.
Koreansk liga: intensiv, fysisk, direktspel.
Hemmaplansfördel stark (~56%).
BTTS: ~53%, lite över standard.
Säsong mars–november.
Data-kvalitet lägre än europeiska ligor — sänk ett confidence-steg.`,

  "ksa.1": `Saudi Pro League (Saudiarabien) — kalibrering:
STOR kvalitetsskillnad: Al-Hilal är i en annan division.
Al-Hilal hemma och borta mot alla utom Al-Nassr/Al-Ahli/Al-Ittihad: hög confidence tillåten.
Al-Nassr (Ronaldo), Al-Ahli, Al-Ittihad — jämna mot varandra, sänk confidence.
Bottenlag i saudisk liga är markant sämre än europeisk botten — toplag är pålitliga.
BTTS: ~45% — lägre pga defensiv taktik i saudisk liga, toplag stänger av.
Klimat (hetta) kan påverka bortalag mer. Säsong september–maj.`,

  "aus.1": `A-League (Australien) — kalibrering:
Australisk fotboll: öppnare spel, fler mål (~3.0/match).
BTTS: ~58% — vikta alltid upp "ja".
Melbourne City, Sydney FC, Western United — pålitliga favoriter.
Säsong oktober–maj (södra halvklotet).
Data kan vara tunn — sänk ett confidence-steg generellt.
Playoff-format → sista omgångar i tablell kan ha låg insats (rotation).`,

  "usa.1": `MLS (USA) — kalibrering:
Hög paritet: MLS är designad att vara jämn (salary cap, draft).
Konferensystem (Öst/Väst) — möten mellan konferenser sker sällan.
LAFC, LA Galaxy, Atlanta United, Columbus Crew, Seattle Sounders — starka lag.
Hemmaplansfördel viktig men inte avgörande (~53%).
BTTS: ~53%, standard.
Playoff-format: tabellposition viktigt under regular season, men undvik hög confidence sent.
Säsong mars–oktober.`,

  "mex.1": `Liga MX (Mexiko) — kalibrering:
Club América, Chivas, Cruz Azul, Tigres UANL, Monterrey — toplag.
Apertura (juli–dec) och Clausura (jan–maj): två mini-säsonger per år.
Altitude påverkar kraftigt i Mexico City (~2 240 m) — Cruz Azul och América hemma har fördel mot lägre liggande lag.
BTTS: ~55%, lite över standard.
Hemmaplansfördel stark (~56%).
Rotation förekommer (Concacaf Champions Cup parallellt) — sänk confidence om laget spelar Cup midvecka.`,

  "can.1": `Canadian Premier League — kalibrering:
Liten liga med tunn data — sänk alltid confidence till låg.
Forge FC (Hamilton) dominerar kraftigt, är nästan alltid favorit.
Övriga lag (Pacific FC, Cavalry FC, Valour) är relativt jämna.
BTTS: osäkert pga tunn data — sätt alltid "osäker".
Säsong april–oktober.`,

  "fifa.world": `FIFA World Cup — kalibrering:
Knockout-format med enstaka matcher: extremt hög varians, underbelly-effekt.
Gruppspel: sista omgången kan ha låg insats om lagen redan kvalificerat sig — sänk confidence.
Stora nationer (Brasilien, Frankrike, England, Argentina, Spanien, Tyskland) favoriseras i knockout.
Sensationer är vanliga (Saudiarabien vs Argentina 2022, Japan vs Tyskland 2022) — aldrig hög confidence mot antagna "underlag".
Altitude och klimat spelar större roll i VM än i ligaspel.
BTTS: ~50% i knockout (defensivt spel vanligare).`,
};

async function main() {
  const dry = process.argv.includes("--dry");
  const force = process.argv.includes("--force");
  const leagueArg = process.argv.find((a) => a.startsWith("--league="))?.split("=")[1];

  const db = createScriptSupabase();

  const { data: existing } = await db
    .from("league_prompts")
    .select("league_id, prompt_text");
  const existingMap = new Map(
    (existing ?? []).map((r) => [r.league_id, (r.prompt_text ?? "").trim()]),
  );

  const entries = Object.entries(PROMPTS).filter(
    ([id]) => !leagueArg || id === leagueArg,
  );

  let saved = 0;
  let skipped = 0;

  for (const [leagueId, prompt] of entries) {
    const current = existingMap.get(leagueId) ?? "";
    if (current.length > 0 && !force) {
      console.log(`SKIP  ${leagueId} — har redan prompt (${current.length} tecken). Använd --force för att skriva över.`);
      skipped++;
      continue;
    }
    if (dry) {
      console.log(`DRY   ${leagueId} — skulle spara ${prompt.length} tecken`);
      saved++;
      continue;
    }
    const { error } = await db.from("league_prompts").upsert(
      {
        league_id: leagueId,
        prompt_text: prompt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "league_id" },
    );
    if (error) {
      console.error(`FEL   ${leagueId}: ${error.message}`);
    } else {
      console.log(`OK    ${leagueId} — sparade ${prompt.length} tecken`);
      saved++;
    }
  }

  console.log(`\nKlart: ${saved} sparade / ${skipped} hoppade över.`);
}

main().catch(console.error);
