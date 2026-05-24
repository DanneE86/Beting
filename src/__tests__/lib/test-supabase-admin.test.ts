import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { isSupabaseAdminConfigured } from "@/lib/supabase-admin";

describe("supabase-admin", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
  });

  afterEach(() => {
    process.env = env;
    vi.restoreAllMocks();
  });

  it("isSupabaseAdminConfigured är false utan service role key", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(isSupabaseAdminConfigured()).toBe(false);
  });

  it("isSupabaseAdminConfigured är true med båda nycklar", () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "secret";
    expect(isSupabaseAdminConfigured()).toBe(true);
  });
});
