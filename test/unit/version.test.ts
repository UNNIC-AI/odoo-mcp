import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VERSION } from "../../src/version.js";
import { TOOLS } from "../../src/server.js";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
};

describe("VERSION", () => {
  // Antes la versión estaba escrita a mano en index.ts y podía quedarse atrás
  // respecto a package.json sin que nada avisara.
  it("coincide con la de package.json", () => {
    expect(VERSION).toBe(pkg.version);
  });

  it("no es el valor de reserva", () => {
    expect(VERSION).not.toBe("0.0.0-dev");
  });
});

describe("registro de herramientas", () => {
  it("las descripciones de domain avisan de que los datetime van en UTC", () => {
    const withDomain = TOOLS.filter((t) => "domain" in t.def.inputSchema);
    expect(withDomain.length).toBeGreaterThan(0);

    for (const tool of withDomain) {
      const schema = tool.def.inputSchema.domain as { description?: string };
      expect(
        schema.description,
        `${tool.def.name} no avisa del UTC en su domain`
      ).toMatch(/UTC/);
    }
  });
});
