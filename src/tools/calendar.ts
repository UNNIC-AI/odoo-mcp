import { z } from "zod";
import type { OdooClient } from "../odoo-client.js";
import type { OdooDomain } from "../types.js";
import type { ToolDefinition, ToolResult } from "./types.js";
import type { AccessPolicy } from "../access.js";

const DEFAULT_FIELDS =
  "name,start,stop,allday,user_id,partner_ids,location,description";

export const searchCalendarTool: ToolDefinition = {
  name: "search_calendar",
  description:
    "Read calendar events. By default returns only events belonging to the authenticated user — those they organise plus those they attend. Set all_events to true to search every user's events.",
  inputSchema: {
    all_events: z
      .boolean()
      .optional()
      .describe(
        "If true, search events of all users instead of only the authenticated user's. Default: false"
      ),
    domain: z
      .string()
      .optional()
      .describe(
        'Extra filter as a JSON array, e.g. \'[["start",">=","2026-03-01"]]\'. It is ANDed with the default user filter'
      ),
    fields: z
      .string()
      .optional()
      .describe(
        `Comma-separated field names to return. Default: "${DEFAULT_FIELDS}"`
      ),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Maximum number of events to return. Default: 40"),
    order: z
      .string()
      .optional()
      .describe('Sort order. Default: "start asc"'),
  },
};

export async function handleSearchCalendar(
  client: OdooClient,
  args: Record<string, unknown>,
  _policy?: AccessPolicy
): Promise<ToolResult> {
  const allEvents = (args.all_events as boolean) ?? false;
  const fields = args.fields
    ? (args.fields as string).split(",").map((f) => f.trim())
    : DEFAULT_FIELDS.split(",");
  const limit = (args.limit as number) ?? 40;
  const order = (args.order as string) || "start asc";

  let extraDomain: OdooDomain = [];
  if (args.domain) {
    try {
      extraDomain = JSON.parse(args.domain as string);
    } catch {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { error: "Could not parse 'domain'. It must be a valid JSON array." },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }
  }

  const domain: OdooDomain = [...extraDomain];

  if (!allEvents) {
    const partnerId = await client.getPartnerId();
    const uid = client.uid;
    // Eventos donde soy organizador (user_id) o asistente (partner_ids).
    domain.push("|");
    domain.push(["user_id", "=", uid]);
    domain.push(["partner_ids", "in", [partnerId]]);
  }

  const records = await client.searchRead(
    "calendar.event",
    domain,
    fields,
    limit,
    undefined,
    order
  );

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            count: records.length,
            filter: allEvents ? "all users" : "authenticated user only",
            records,
          },
          null,
          2
        ),
      },
    ],
  };
}
