import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Las pruebas de integración necesitan un Odoo real y se ejecutan aparte
    // con `npm run test:integration`.
    exclude: ["node_modules/**", "dist/**"],
  },
});
