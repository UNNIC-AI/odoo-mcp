import { z } from "zod";
import type { OdooClient } from "../odoo-client.js";
import type { ToolDefinition, ToolResult } from "./types.js";
import type { AccessPolicy } from "../access.js";

export const deleteRecordTool: ToolDefinition = {
  name: "delete_record",
  description:
    "Delete one or more records from an Odoo model. Use with caution — this is permanent.",
  inputSchema: {
    model: z.string().describe("Odoo model name (e.g., 'res.partner')"),
    ids: z.string().describe('Comma-separated record IDs to delete (e.g., "1,2,3")'),
  },
};

export async function handleDeleteRecord(
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

  const result = await client.delete(model, ids);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ success: result, deleted_ids: ids }, null, 2),
      },
    ],
  };
}

