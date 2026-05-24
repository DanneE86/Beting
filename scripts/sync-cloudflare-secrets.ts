/**
 * Laddar hemligheter från .env till Cloudflare Worker "beting".
 * Kör: npx wrangler login   (en gång)
 * Sedan: npm run sync:cloudflare-secrets
 */
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv } from "../src/lib/script-env";

const SECRET_KEYS = ["SUPABASE_SERVICE_ROLE_KEY", "LOVABLE_API_KEY"] as const;

loadEnv();

const secrets: Record<string, string> = {};
for (const key of SECRET_KEYS) {
  const value = process.env[key]?.trim();
  if (value) secrets[key] = value;
}

if (!secrets.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY saknas i .env");
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), "cf-secrets-"));
const file = join(dir, "secrets.json");
writeFileSync(file, JSON.stringify(secrets, null, 2));

try {
  execSync(`npx wrangler secret bulk "${file}"`, {
    stdio: "inherit",
    cwd: process.cwd(),
  });
  console.log(`Klart — ${Object.keys(secrets).join(", ")} uppladdade till Worker "beting".`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
