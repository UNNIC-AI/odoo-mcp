import type { OdooClient } from "../../src/odoo-client.js";

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
  readGroup: async () => [],
  nameSearch: async () => [],
  getFields: async () => ({}),
  executeMethod: async () => true,
  getVersion: async () => ({ server_version: "18.0" }),
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
export function payloadOf(result: { content: { text: string }[] }): any {
  return JSON.parse(result.content[0].text);
}
