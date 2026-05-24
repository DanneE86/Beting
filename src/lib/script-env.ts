import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { resolve } from "path";

/** Läs .env från projektroten (CLI-skript). */
export function loadEnv(envPath = resolve(process.cwd(), ".env")): void {
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    process.env[k] ??= v;
  }
}

export function createScriptSupabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY krävs i .env");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
