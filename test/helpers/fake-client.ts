import type { OdooClient } from "../../src/odoo-client.js";
import type { ToolResult } from "../../src/tools/types.js";

export interface RecordedCall {
  method: string;
  args: unknown[];
}

type Stub = (...args: any[]) => any;

const DEFAULTS: Record<string, Stub | unknown> = {
  searchRead: async () => [],
  read: async () => [],
  create: async () => 1,
  createBatch: async () => [1, 2],
  update: async () => true,
  delete: async () => true,
  count: async () => 0,
  readGroup: async () => ({ groups: [], method: "read_group" }),
  nameSearch: async () => [],
  getFields: async () => ({}),
  executeMethod: async () => true,
  getVersion: async () => ({
    server_version: "18.0",
    server_version_info: [18, 0, 0, "final", 0, ""],
  }),
  getServerMajorVersion: async () => 18,
  getFieldTypes: async () => ({}),
  getTimezone: async () => "UTC",
  // Paso a través por defecto: las pruebas que no van de zonas horarias siguen
  // comprobando los valores tal y como los devuelve Odoo.
  localizeRecords: async (_model: string, records: unknown[]) => records,
  getPartnerId: async () => 7,
  getUid: () => 2,
  getDatabase: () => "testdb",
  getUrl: () => "https://odoo.test",
  uid: 2,
};

/**
 * Doble de OdooClient que registra cada llamada. Los handlers solo usan la
 * superficie pública del cliente, así que basta con implementar esos métodos.
 */
export function fakeClient(overrides: Record<string, Stub | unknown> = {}) {
  const calls: RecordedCall[] = [];
  const impl = { ...DEFAULTS, ...overrides };
  const client: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(impl)) {
    if (typeof value === "function") {
      client[name] = (...args: unknown[]) => {
        calls.push({ method: name, args });
        return (value as Stub)(...args);
      };
    } else {
      client[name] = value;
    }
  }

  return {
    client: client as unknown as OdooClient,
    calls,
    callsTo(method: string) {
      return calls.filter((c) => c.method === method);
    },
    lastCall(method: string) {
      const matching = calls.filter((c) => c.method === method);
      return matching[matching.length - 1];
    },
  };
}

/** Extrae el payload JSON del primer bloque de texto de un ToolResult. */
export function payloadOf(result: ToolResult): any {
  const block = result.content.find((c) => c.type === "text");
  if (!block) throw new Error("El ToolResult no tiene ningún bloque de texto");
  return JSON.parse(block.text);
}

/** Bloques que no son texto: imagen o recurso incrustado. */
export function attachmentsOf(result: ToolResult) {
  return result.content.filter((c) => c.type !== "text");
}
