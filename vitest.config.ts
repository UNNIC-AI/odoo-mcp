import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const { version } = JSON.parse(readFileSync("./package.json", "utf8")) as {
  version: string;
};

export default defineConfig({
  // Misma inyección que en tsup, para que las pruebas vean la versión real.
  define: {
    __PACKAGE_VERSION__: JSON.stringify(version),
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Las pruebas de integración necesitan un Odoo real y se ejecutan aparte
    // con `npm run test:integration`.
    exclude: ["node_modules/**", "dist/**"],
  },
});
