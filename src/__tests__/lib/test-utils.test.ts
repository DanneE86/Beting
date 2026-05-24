import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("utils", () => {
  it("cn slår ihop klasser och tar bort konflikter", () => {
    expect(cn("px-2", "py-1")).toContain("px-2");
    expect(cn("px-2", "px-4")).toContain("px-4");
    expect(cn("px-2", false && "hidden", "block")).toContain("block");
  });
});
