import { describe, expect, it } from "vitest";
import { selectTools, wrapHandler, TOOLS, type ToolEntry } from "../../src/server.js";
import { OPEN_POLICY, type AccessPolicy } from "../../src/access.js";
import { fakeClient, payloadOf } from "../helpers/fake-client.js";
import type { ToolResult } from "../../src/tools/types.js";

const names = (entries: ToolEntry[]) => entries.map((e) => e.def.name);

const WRITE_TOOLS = [
  "create_record",
  "update_record",
  "delete_record",
  "execute_method",
  "post_message",
  "upload_attachment",
];

describe("selectTools", () => {
  it("registra las 18 herramientas sin restricciones", () => {
    expect(selectTools(OPEN_POLICY)).toHaveLength(18);
  });

  it("cada herramienta declara nombre, descripción y esquema", () => {
    for (const entry of TOOLS) {
      expect(entry.def.name).toMatch(/^[a-z_]+$/);
      expect(entry.def.description.length).toBeGreaterThan(20);
      expect(entry.def.inputSchema).toBeTypeOf("object");
    }
  });

  it("no hay nombres de herramienta repetidos", () => {
    const all = names(TOOLS);
    expect(new Set(all).size).toBe(all.length);
  });

  it("marca como escritura exactamente las herramientas que mutan Odoo", () => {
    const writes = TOOLS.filter((t) => t.write).map((t) => t.def.name);
    expect(writes.sort()).toEqual([...WRITE_TOOLS].sort());
  });

  it("en solo lectura desaparecen las herramientas de escritura", () => {
    const selected = names(selectTools({ readonly: true, allowedModels: null }));
    for (const write of WRITE_TOOLS) {
      expect(selected).not.toContain(write);
    }
    expect(selected).toContain("search_records");
    expect(selected).toContain("download_attachment");
    expect(selected).toHaveLength(18 - WRITE_TOOLS.length);
  });

  it("oculta search_calendar si la lista blanca excluye calendar.event", () => {
    const policy: AccessPolicy = { readonly: false, allowedModels: ["sale.*"] };
    expect(names(selectTools(policy))).not.toContain("search_calendar");
  });

  it("mantiene search_calendar si calendar.event está permitido", () => {
    const policy: AccessPolicy = {
      readonly: false,
      allowedModels: ["calendar.event"],
    };
    expect(names(selectTools(policy))).toContain("search_calendar");
  });

  it("whoami y list_models sobreviven a cualquier lista blanca", () => {
    const policy: AccessPolicy = { readonly: false, allowedModels: ["nada.de.nada"] };
    const selected = names(selectTools(policy));
    expect(selected).toContain("whoami");
    expect(selected).toContain("list_models");
  });
});

describe("wrapHandler", () => {
  const entryFor = (name: string) => TOOLS.find((t) => t.def.name === name)!;

  it("rechaza un modelo fuera de la lista blanca antes de llamar a Odoo", async () => {
    const { client, calls } = fakeClient();
    const policy: AccessPolicy = { readonly: false, allowedModels: ["sale.*"] };
    const handler = wrapHandler(client, policy, entryFor("search_records"));

    const result = await handler({ model: "res.partner" });

    expect(result.isError).toBe(true);
    expect(payloadOf(result as ToolResult).error).toMatch(/not allowed/);
    expect(calls).toHaveLength(0);
  });

  it("deja pasar un modelo permitido", async () => {
    const { client, calls } = fakeClient();
    const policy: AccessPolicy = { readonly: false, allowedModels: ["sale.*"] };
    const handler = wrapHandler(client, policy, entryFor("search_records"));

    const result = await handler({ model: "sale.order" });

    expect(result.isError).toBeUndefined();
    expect(calls.some((c) => c.method === "searchRead")).toBe(true);
  });

  it("convierte una excepción del handler en un resultado de error", async () => {
    const { client } = fakeClient({
      searchRead: async () => {
        throw new Error("Odoo se ha caído");
      },
    });
    const handler = wrapHandler(client, OPEN_POLICY, entryFor("search_records"));

    const result = await handler({ model: "sale.order" });

    expect(result.isError).toBe(true);
    expect(payloadOf(result as ToolResult).error).toBe("Odoo se ha caído");
  });

  it("comprueba también el modelo fijo de la herramienta", async () => {
    const { client, calls } = fakeClient();
    const policy: AccessPolicy = { readonly: false, allowedModels: ["sale.*"] };
    const handler = wrapHandler(client, policy, entryFor("search_calendar"));

    const result = await handler({});

    expect(result.isError).toBe(true);
    expect(payloadOf(result as ToolResult).error).toMatch(/calendar\.event/);
    expect(calls).toHaveLength(0);
  });

  it("propaga la política al handler", async () => {
    const { client } = fakeClient({
      searchRead: async () => [{ model: "sale.order", name: "Pedido" }, { model: "res.partner", name: "Contacto" }],
    });
    const policy: AccessPolicy = { readonly: false, allowedModels: ["sale.*"] };
    const handler = wrapHandler(client, policy, entryFor("list_models"));

    const payload = payloadOf((await handler({})) as ToolResult);

    expect(payload.models).toHaveLength(1);
    expect(payload.models[0].model).toBe("sale.order");
  });

  it("ignora un model vacío en lugar de rechazarlo", async () => {
    const { client } = fakeClient();
    const policy: AccessPolicy = { readonly: false, allowedModels: ["sale.*"] };
    const handler = wrapHandler(client, policy, entryFor("list_attachments"));

    const result = await handler({ model: "   " });

    // Cae en la comprobación de list_attachments, no en la de lista blanca.
    expect(payloadOf(result as ToolResult).error).toMatch(/'model' is required/);
  });
});
