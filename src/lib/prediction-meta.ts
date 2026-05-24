/** Ökas när prognosmodellen (BTTS, motivation m.m.) ändras — triggar uppdatering av öppna tips. */
export const PREDICTION_MODEL_VERSION = 3;

export type BttsCall = "ja" | "nej" | "osäker";

export type BttsFields = {
  btts_call?: string | null;
  btts_reason?: string | null;
  postmortem?: unknown;
};

/** Enhetlig läsning av BTTS — kolumner först, sedan postmortem (äldre tips). */
export function extractBtts(row: BttsFields): {
  call: BttsCall | null;
  reason: string | null;
} {
  const pm = row.postmortem as { bttsCall?: BttsCall; bttsReason?: string } | null | undefined;
  const call = (row.btts_call as BttsCall | null | undefined) ?? pm?.bttsCall ?? null;
  const reason = row.btts_reason ?? pm?.bttsReason ?? null;
  return { call, reason };
}

/** Preliminär postmortem — behåll full analys om den redan finns. */
export function mergePreliminaryPostmortem(
  existing: unknown,
  bttsCall?: BttsCall,
  bttsReason?: string,
): Record<string, unknown> | null {
  const ex = existing as { preliminary?: boolean; verdict?: string } | null | undefined;
  if (ex?.verdict && !ex?.preliminary) return ex as Record<string, unknown>;

  if (!bttsCall && !ex) return null;

  return {
    ...(ex && typeof ex === "object" ? ex : {}),
    ...(bttsCall
      ? { bttsCall, bttsReason: bttsReason ?? "", preliminary: true }
      : {}),
  };
}
