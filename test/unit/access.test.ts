import { describe, expect, it } from "vitest";
import {
  assertModelAllowed,
  isModelAllowed,
  OPEN_POLICY,
  policyFromConfig,
  type AccessPolicy,
} from "../../src/access.js";

const withModels = (allowedModels: string[] | null): AccessPolicy => ({
  readonly: false,
  allowedModels,
});

describe("isModelAllowed", () => {
  it("permite todo cuando no hay lista blanca", () => {
    expect(isModelAllowed(OPEN_POLICY, "res.partner")).toBe(true);
    expect(isModelAllowed(OPEN_POLICY, "ir.model")).toBe(true);
  });

  it("compara nombres exactos", () => {
    const policy = withModels(["res.partner"]);
    expect(isModelAllowed(policy, "res.partner")).toBe(true);
    expect(isModelAllowed(policy, "res.users")).toBe(false);
  });

  it("un nombre exacto no cubre los modelos hijos", () => {
    const policy = withModels(["sale.order"]);
    expect(isModelAllowed(policy, "sale.order.line")).toBe(false);
  });

  it("acepta comodines de prefijo", () => {
    const policy = withModels(["sale.*"]);
    expect(isModelAllowed(policy, "sale.order")).toBe(true);
    expect(isModelAllowed(policy, "sale.order.line")).toBe(true);
    expect(isModelAllowed(policy, "purchase.order")).toBe(false);
  });

  it("acepta el comodín total", () => {
    expect(isModelAllowed(withModels(["*"]), "cualquier.modelo")).toBe(true);
  });

  it("basta con que coincida un patrón de la lista", () => {
    const policy = withModels(["res.partner", "sale.*"]);
    expect(isModelAllowed(policy, "sale.order")).toBe(true);
    expect(isModelAllowed(policy, "res.partner")).toBe(true);
    expect(isModelAllowed(policy, "account.move")).toBe(false);
  });

  it("distingue mayúsculas, igual que los nombres de modelo de Odoo", () => {
    expect(isModelAllowed(withModels(["res.partner"]), "RES.PARTNER")).toBe(false);
  });
});

describe("assertModelAllowed", () => {
  it("no hace nada si el modelo está permitido", () => {
    expect(() => assertModelAllowed(withModels(["sale.*"]), "sale.order")).not.toThrow();
  });

  it("el mensaje de error nombra el modelo y la lista permitida", () => {
    const policy = withModels(["sale.*", "res.partner"]);
    expect(() => assertModelAllowed(policy, "account.move")).toThrow(
      /'account\.move' is not allowed/
    );
    expect(() => assertModelAllowed(policy, "account.move")).toThrow(
      /sale\.\*, res\.partner/
    );
  });
});

describe("policyFromConfig", () => {
  it("traslada solo lectura y lista blanca", () => {
    const policy = policyFromConfig({
      url: "https://odoo.test",
      db: "db",
      user: "u",
      secret: "s",
      usingApiKey: true,
      timeoutMs: 30000,
      readonly: true,
      allowedModels: ["sale.*"],
      timezone: null,
    });
    expect(policy).toEqual({ readonly: true, allowedModels: ["sale.*"] });
  });
});
