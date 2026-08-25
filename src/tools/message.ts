import { z } from "zod";
import type { OdooClient } from "../odoo-client.js";
import type { OdooDomain } from "../types.js";
import type { ToolDefinition, ToolResult } from "./types.js";
import type { AccessPolicy } from "../access.js";

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const getMessagesTool: ToolDefinition = {
  name: "get_messages",
  description:
    "Get chatter messages and change history for a specific record. Returns comments, internal notes, and tracking changes.",
  inputSchema: {
    model: z
      .string()
      .describe("Odoo model name (e.g., 'sale.order', 'res.partner')"),
    res_id: z.number().int().positive().describe("Record ID to get messages for"),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Maximum number of messages to return. Default: 20"),
    message_type: z
      .string()
      .optional()
      .describe(
        "Filter by message type: 'comment', 'notification', 'email', 'user_notification'. Default: all"
      ),
    strip_html: z
      .boolean()
      .optional()
      .describe(
        "If true, strip HTML tags from message body and return plain text. Default: false"
      ),
  },
};

export async function handleGetMessages(
  client: OdooClient,
  args: Record<string, unknown>,
  _policy?: AccessPolicy
): Promise<ToolResult> {
  const model = args.model as string;
  const resId = args.res_id as number;
  const limit = (args.limit as number) ?? 20;
  const messageType = args.message_type as string | undefined;

  const domain: OdooDomain = [
    ["res_id", "=", resId],
    ["model", "=", model],
  ];

  if (messageType) {
    domain.push(["message_type", "=", messageType]);
  }

  const shouldStripHtml = (args.strip_html as boolean) ?? false;

  const messages = await client.searchRead(
    "mail.message",
    domain,
    [
      "date",
      "body",
      "author_id",
      "message_type",
      "subtype_id",
      "tracking_value_ids",
    ],
    limit,
    undefined,
    "date desc"
  );

  const processed = shouldStripHtml
    ? (messages as Record<string, unknown>[]).map((msg) => ({
        ...msg,
        body: typeof msg.body === "string" ? stripHtml(msg.body) : msg.body,
      }))
    : messages;

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          { model, res_id: resId, count: processed.length, messages: processed },
          null,
          2
        ),
      },
    ],
  };
}

export const postMessageTool: ToolDefinition = {
  name: "post_message",
  description:
    "Post a message or internal note on an Odoo record's chatter. Uses the message_post method.",
  inputSchema: {
    model: z
      .string()
      .describe("Odoo model name (e.g., 'sale.order', 'res.partner')"),
    res_id: z.number().int().positive().describe("Record ID to post the message on"),
    body: z.string().describe("Message body (HTML supported)"),
    message_type: z
      .string()
      .optional()
      .describe(
        "Message type: 'comment' (visible to followers) or 'notification' (internal note). Default: 'comment'"
      ),
    subtype_xmlid: z
      .string()
      .optional()
      .describe(
        "Subtype XML ID: 'mail.mt_comment' for comment, 'mail.mt_note' for internal note. Default: 'mail.mt_comment'"
      ),
  },
};

export async function handlePostMessage(
  client: OdooClient,
  args: Record<string, unknown>,
  _policy?: AccessPolicy
): Promise<ToolResult> {
  const model = args.model as string;
  const resId = args.res_id as number;
  const body = args.body as string;
  const messageType = (args.message_type as string) || "comment";
  const subtypeXmlid =
    (args.subtype_xmlid as string) ||
    (messageType === "notification" ? "mail.mt_note" : "mail.mt_comment");

  const result = await client.executeMethod(model, "message_post", [resId], [], {
    body,
    message_type: messageType,
    subtype_xmlid: subtypeXmlid,
  });

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          { success: true, model, res_id: resId, message_id: result },
          null,
          2
        ),
      },
    ],
  };
}
