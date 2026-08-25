import { z } from "zod";
import type { OdooClient } from "../odoo-client.js";
import type { ToolDefinition, ToolResult } from "./types.js";
import type { AccessPolicy } from "../access.js";

export const readRecordTool: ToolDefinition = {
  name: "read_record",
  description: "Read one or more records by their IDs from an Odoo model.",
  inputSchema: {
    model: z.string().describe("Odoo model name (e.g., 'res.partner')"),
    ids: z.string().describe('Comma-separated record IDs (e.g., "1,2,3")'),
    fields: z
      .string()
      .optional()
      .describe('Comma-separated field names to return (e.g., "name,email"). Default: all fields'),
  },
};

export async function handleReadRecord(
  client: OdooClient,
  args: Record<string, unknown>,
  _policy?: AccessPolicy
): Promise<ToolResult> {
  const model = args.model as string;
  const rawIds = (args.ids as string).split(",").map((id) => id.trim());
  const ids = rawIds.map((id) => {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`Invalid record ID: "${id}". IDs must be positive integers.`);
    }
    return n;
  });
  const fields = args.fields
    ? (args.fields as string).split(",").map((f) => f.trim())
    : undefined;

  const records = await client.localizeRecords(
    model,
    await client.read(model, ids, fields)
  );
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ count: records.length, records }, null, 2),
      },
    ],
  };
}

