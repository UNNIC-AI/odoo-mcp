import { z } from "zod";
import type { OdooClient } from "../odoo-client.js";
import type { OdooDomain } from "../types.js";
import type { ToolDefinition, ToolResult } from "./types.js";
import type { AccessPolicy } from "../access.js";

export const countRecordsTool: ToolDefinition = {
  name: "count_records",
  description: "Count records in an Odoo model matching an optional domain filter.",
  inputSchema: {
    model: z.string().describe("Odoo model name (e.g., 'res.partner')"),
    domain: z
      .string()
      .optional()
      .describe(
        'Search domain as JSON array (e.g., \'[["is_company","=",true]]\'). Default: [] (all records)'
      ),
  },
};

export async function handleCountRecords(
  client: OdooClient,
  args: Record<string, unknown>,
  _policy?: AccessPolicy
): Promise<ToolResult> {
  const model = args.model as string;
  let domain: OdooDomain = [];
  if (args.domain) {
    try {
      domain = JSON.parse(args.domain as string);
    } catch {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "Could not parse 'domain'. It must be a valid JSON array." }, null, 2) }],
        isError: true,
      };
    }
  }



  const count = await client.count(model, domain);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ model, count }, null, 2),
      },
    ],
  };
}
