import type { AndelsShareTip } from "./types";

const SHARES_API =
  "https://www.atg.se/services/tokenized-proxy/shopshare/api/v1/shares";

interface ShopShareResponse {
  totalNumberOfHits: number;
  shares: {
    name: string;
    cost: number;
    sharesForSale?: number;
    isCouponPublic?: boolean;
    couponId?: string;
    initiator?: { name?: string };
    shop?: { name?: string };
    description?: string;
  }[];
}

export async function fetchAndelShares(
  gameId: string,
  limit = 15,
): Promise<AndelsShareTip[]> {
  const url = `${SHARES_API}?gameId=${encodeURIComponent(gameId)}&page=0&limit=${limit}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Andelsspel API ${res.status}`);
  const json = (await res.json()) as ShopShareResponse;
  return (json.shares ?? []).map((s) => ({
    name: s.name,
    costKr: Math.round((s.cost ?? 0) / 100),
    sharesLeft: s.sharesForSale,
    expert: [s.initiator?.name, s.shop?.name].filter(Boolean).join(" · "),
    marks: s.isCouponPublic ? `Publik kupong (${s.couponId?.slice(0, 8)}…)` : "Dold kupong",
    url: `https://www.atg.se/andelsspel?gameId=${gameId}`,
  }));
}
