import { z } from "zod";
import type { OdooClient } from "../odoo-client.js";
import type { ToolDefinition, ToolResult } from "./types.js";
import type { AccessPolicy } from "../access.js";

export const updateRecordTool: ToolDefinition = {
  name: "update_record",
  description: "Update one or more existing records in an Odoo model.",
  inputSchema: {
    model: z.string().describe("Odoo model name (e.g., 'res.partner')"),
    ids: z.string().describe('Comma-separated record IDs to update (e.g., "1,2,3")'),
    values: z
      .string()
      .describe('JSON object with field values to update (e.g., \'{"name":"Jane"}\')'),
  },
};

export async function handleUpdateRecord(
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
  let values: Record<string, unknown>;
  try {
    values = JSON.parse(args.values as string);
  } catch {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: "Could not parse 'values'. It must be valid JSON." }, null, 2) }],
      isError: true,
    };
  }



  const result = await client.update(model, ids, values);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ success: result, ids }, null, 2),
      },
    ],
  };
}

