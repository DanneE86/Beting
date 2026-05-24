/** Kanonisk ligalista — används i app, backfill och träning. */
export const LEAGUES = [
  { id: "eng.1", name: "England", country: "England", region: "Europa" },
  { id: "esp.1", name: "Spanien", country: "Spain", region: "Europa" },
  { id: "ger.1", name: "Tyskland", country: "Germany", region: "Europa" },
  { id: "ger.2", name: "Tyskland 2", country: "Germany", region: "Europa" },
  { id: "ita.1", name: "Italien", country: "Italy", region: "Europa" },
  { id: "fra.1", name: "Frankrike", country: "France", region: "Europa" },
  { id: "uefa.champions", name: "Champions League", country: "UEFA", region: "Europa" },
  { id: "uefa.europa", name: "Europa League", country: "UEFA", region: "Europa" },
  { id: "uefa.europa.conf", name: "Conference League", country: "UEFA", region: "Europa" },
  { id: "pol.1", name: "Polen", country: "Poland", region: "Europa" },
  { id: "nor.1", name: "Norge", country: "Norway", region: "Europa" },
  { id: "den.1", name: "Danmark", country: "Denmark", region: "Europa" },
  { id: "swe.1", name: "Sverige", country: "Sweden", region: "Europa" },
  { id: "swe.2", name: "Sverige 2", country: "Sweden", region: "Europa" },
  { id: "bel.1", name: "Belgien", country: "Belgium", region: "Europa" },
  { id: "sco.1", name: "Skottland", country: "Scotland", region: "Europa" },
  { id: "bra.1", name: "Brasilien", country: "Brazil", region: "Sydamerika" },
  { id: "arg.1", name: "Argentina", country: "Argentina", region: "Sydamerika" },
  { id: "chi.1", name: "Chile", country: "Chile", region: "Sydamerika" },
  { id: "conmebol.libertadores", name: "Copa Libertadores", country: "CONMEBOL", region: "Sydamerika" },
  { id: "conmebol.sudamericana", name: "Copa Sudamericana", country: "CONMEBOL", region: "Sydamerika" },
  { id: "jpn.1", name: "Japan J.League", country: "Japan", region: "Asien" },
  { id: "kor.1", name: "Sydkorea K League 1", country: "South Korea", region: "Asien" },
  { id: "ksa.1", name: "Saudiarabien Pro League", country: "Saudi Arabia", region: "Asien" },
  { id: "aus.1", name: "Australien A-League", country: "Australia", region: "Australien" },
  { id: "usa.1", name: "USA MLS", country: "USA", region: "Nordamerika" },
  { id: "mex.1", name: "Mexiko Liga MX", country: "Mexico", region: "Nordamerika" },
  { id: "can.1", name: "Kanada Premier League", country: "Canada", region: "Nordamerika" },
  { id: "fifa.world", name: "Fotbolls-VM", country: "FIFA", region: "Internationellt" },
] as const;

export type LeagueId = (typeof LEAGUES)[number]["id"];

export const LEAGUE_IDS: LeagueId[] = LEAGUES.map((l) => l.id);
