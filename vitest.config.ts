import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/__tests__/**/*.test.{ts,tsx}"],
    globals: true,
    coverage: {
      provider: "v8",
      include: ["src/lib/**", "src/components/**"],
      exclude: ["src/components/ui/**"],
    },
  },
});
