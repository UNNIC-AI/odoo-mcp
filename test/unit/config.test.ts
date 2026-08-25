import { describe, expect, it } from "vitest";
import { ConfigError, describeConfig, loadConfig } from "../../src/config.js";

const BASE = {
  ODOO_URL: "https://odoo.test",
  ODOO_DB: "testdb",
  ODOO_USER: "bot@empresa.com",
  ODOO_API_KEY: "clave-secreta",
} as NodeJS.ProcessEnv;

describe("loadConfig — variables obligatorias", () => {
  it("acepta una configuración mínima válida", () => {
    const config = loadConfig(BASE);
    expect(config.url).toBe("https://odoo.test");
    expect(config.db).toBe("testdb");
    expect(config.user).toBe("bot@empresa.com");
    expect(config.secret).toBe("clave-secreta");
    expect(config.usingApiKey).toBe(true);
  });

  it("enumera todas las variables que faltan de una vez", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow(/ODOO_URL, ODOO_DB/);
  });

  // Regresión: la configuración documentada en el README original
  // (URL + DB + API key, sin usuario) llegaba hasta Odoo y fallaba allí con un
  // "Authentication failed" que no señalaba la causa real.
  it("rechaza ODOO_API_KEY sin ODOO_USER y explica por qué", () => {
    const { ODOO_USER, ...sinUsuario } = BASE;
    expect(() => loadConfig(sinUsuario)).toThrow(ConfigError);
    expect(() => loadConfig(sinUsuario)).toThrow(/ODOO_USER es obligatorio/);
  });

  it("exige alguna credencial", () => {
    const { ODOO_API_KEY, ...sinClave } = BASE;
    expect(() => loadConfig(sinClave)).toThrow(/ODOO_API_KEY.*ODOO_PASSWORD/s);
  });

  it("acepta usuario y contraseña", () => {
    const { ODOO_API_KEY, ...resto } = BASE;
    const config = loadConfig({ ...resto, ODOO_PASSWORD: "hunter2" });
    expect(config.secret).toBe("hunter2");
    expect(config.usingApiKey).toBe(false);
  });

  it("da prioridad a la API key sobre la contraseña", () => {
    const config = loadConfig({ ...BASE, ODOO_PASSWORD: "hunter2" });
    expect(config.secret).toBe("clave-secreta");
    expect(config.usingApiKey).toBe(true);
  });

  it("rechaza una URL malformada", () => {
    expect(() => loadConfig({ ...BASE, ODOO_URL: "odoo.test" })).toThrow(
      /no es una URL válida/
    );
  });

  it("ignora los espacios sobrantes", () => {
    const config = loadConfig({ ...BASE, ODOO_USER: "  bot@empresa.com  " });
    expect(config.user).toBe("bot@empresa.com");
  });
});

describe("loadConfig — ODOO_TIMEOUT", () => {
  it("usa 30 segundos por defecto", () => {
    expect(loadConfig(BASE).timeoutMs).toBe(30000);
  });

  it("convierte segundos a milisegundos", () => {
    expect(loadConfig({ ...BASE, ODOO_TIMEOUT: "45" }).timeoutMs).toBe(45000);
  });

  it.each(["0", "-1", "1.5", "abc"])("rechaza %s", (value) => {
    expect(() => loadConfig({ ...BASE, ODOO_TIMEOUT: value })).toThrow(
      /ODOO_TIMEOUT/
    );
  });
});

describe("loadConfig — ODOO_READONLY", () => {
  it("está desactivado por defecto", () => {
    expect(loadConfig(BASE).readonly).toBe(false);
  });

  it.each(["true", "TRUE", "1", "yes", "si", "sí"])("acepta %s", (value) => {
    expect(loadConfig({ ...BASE, ODOO_READONLY: value }).readonly).toBe(true);
  });

  it.each(["false", "0", "no"])("acepta %s como falso", (value) => {
    expect(loadConfig({ ...BASE, ODOO_READONLY: value }).readonly).toBe(false);
  });

  it("rechaza un valor que no sea booleano", () => {
    expect(() => loadConfig({ ...BASE, ODOO_READONLY: "quizás" })).toThrow(
      /ODOO_READONLY/
    );
  });
});

describe("loadConfig — ODOO_ALLOWED_MODELS", () => {
  it("sin definir significa todos los modelos", () => {
    expect(loadConfig(BASE).allowedModels).toBeNull();
  });

  it("separa por comas y limpia espacios", () => {
    const config = loadConfig({
      ...BASE,
      ODOO_ALLOWED_MODELS: " sale.* , res.partner ",
    });
    expect(config.allowedModels).toEqual(["sale.*", "res.partner"]);
  });

  it("rechaza una lista que solo contiene separadores", () => {
    expect(() =>
      loadConfig({ ...BASE, ODOO_ALLOWED_MODELS: " , , " })
    ).toThrow(/ODOO_ALLOWED_MODELS/);
  });
});

describe("describeConfig", () => {
  it("nunca incluye la credencial", () => {
    const summary = describeConfig(loadConfig(BASE));
    expect(summary).not.toContain("clave-secreta");
    expect(summary).toContain("API key");
  });

  it("avisa del modo solo lectura y de la lista de modelos", () => {
    const summary = describeConfig(
      loadConfig({ ...BASE, ODOO_READONLY: "true", ODOO_ALLOWED_MODELS: "sale.*" })
    );
    expect(summary).toMatch(/solo lectura ACTIVADO/);
    expect(summary).toContain("sale.*");
  });
});
