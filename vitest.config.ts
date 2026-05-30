import { defineConfig } from "vitest/config";

// Unit tests for the pure `src/lib` helpers (validation, hashing). Node
// environment — no DOM needed, so no jsdom dependency.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
