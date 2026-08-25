import { z } from "zod";
import { decodeHTML } from "entities";
import type { OdooClient } from "../odoo-client.js";
import type { OdooDomain } from "../types.js";
import type { ToolDefinition, ToolResult } from "./types.js";
import type { AccessPolicy } from "../access.js";
import { utcNaiveToIso } from "../datetime.js";

/**
 * Pasa el HTML del chatter a texto plano. La decodificación de entidades la
 * hace `entities`, con la tabla HTML5 completa: hacerlo a mano dejaba fuera
 * todo lo que no fueran las cinco o seis entidades más comunes.
 */
export function stripHtml(html: string): string {
  return decodeHTML(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    // El nbsp ya decodificado (U+00A0) pasa a espacio normal.
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Pares de columnas de mail.tracking.value. Odoo rellena solo el par que
 * corresponde al tipo del campo y deja el resto a false o 0.
 */
const TRACKING_PAIRS: Array<[string, string]> = [
  ["old_value_char", "new_value_char"],
  ["old_value_text", "new_value_text"],
  ["old_value_datetime", "new_value_datetime"],
  ["old_value_monetary", "new_value_monetary"],
  ["old_value_float", "new_value_float"],
  ["old_value_integer", "new_value_integer"],
];

/** Candidatos para la etiqueta del campo, según la versión de Odoo. */
const TRACKING_LABEL_FIELDS = ["field_id", "field_desc", "field"];

function isMeaningful(value: unknown): boolean {
  return value !== false && value !== null && value !== undefined && value !== "";
}

function trackingLabel(record: Record<string, unknown>): string {
  for (const key of TRACKING_LABEL_FIELDS) {
    const value = record[key];
    // field_id / field llegan como [id, "Etiqueta"].
    if (Array.isArray(value) && typeof value[1] === "string") return value[1];
    if (typeof value === "string" && value) return value;
  }
  return "unknown field";
}

export interface TrackingChange {
  field: string;
  old_value: unknown;
  new_value: unknown;
}

/**
 * Convierte los ids de tracking_value_ids en cambios legibles.
 *
 * Los nombres de columna cambian entre versiones (Odoo <=16 usaba `field` y
 * `field_desc`; 17+ usa `field_id`), así que preguntamos primero qué existe en
 * este servidor y pedimos solo eso.
 */
export async function resolveTrackingValues(
  client: OdooClient,
  ids: number[]
): Promise<Map<number, TrackingChange>> {
  const result = new Map<number, TrackingChange>();
  if (ids.length === 0) return result;

  const available = await client.getFieldTypes("mail.tracking.value");
  const has = (name: string) => name in available;

  const pairs = TRACKING_PAIRS.filter(([oldKey, newKey]) => has(oldKey) && has(newKey));
  const labels = TRACKING_LABEL_FIELDS.filter(has);
  const fields = [...labels, ...pairs.flat()];

  if (fields.length === 0) return result;

  let records: Record<string, unknown>[];
  try {
    records = (await client.read(
      "mail.tracking.value",
      ids,
      fields
    )) as Record<string, unknown>[];
  } catch {
    // Sin permiso de lectura sobre el modelo devolvemos el mapa vacío: los
    // mensajes se entregan igual, solo que sin los cambios resueltos.
    return result;
  }

  const timezone = await client.getTimezone();

  for (const record of records) {
    const id = record.id as number;
    // El par bueno es el que cambió. Mirar solo si hay valor no vale: Odoo deja
    // las columnas numéricas que no usa a 0, y un 0 es un valor legítimo.
    const pair = pairs.find(([oldKey, newKey]) => record[oldKey] !== record[newKey]);

    if (!pair) {
      result.set(id, { field: trackingLabel(record), old_value: null, new_value: null });
      continue;
    }

    const [oldKey, newKey] = pair;
    const isDatetime = oldKey.endsWith("_datetime");
    const present = (value: unknown) => {
      if (!isMeaningful(value)) return null;
      return isDatetime && typeof value === "string"
        ? utcNaiveToIso(value, timezone)
        : value;
    };

    result.set(id, {
      field: trackingLabel(record),
      old_value: present(record[oldKey]),
      new_value: present(record[newKey]),
    });
  }

  return result;
}

export const getMessagesTool: ToolDefinition = {
  name: "get_messages",
  description:
    "Get chatter messages and change history for a specific record. Returns comments, internal notes, and field-level tracked changes resolved to their old and new values.",
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

  const messages = (await client.localizeRecords(
    "mail.message",
    await client.searchRead(
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
    )
  )) as Record<string, unknown>[];

  // Una sola lectura para los cambios de todos los mensajes de la página.
  const trackingIds = messages.flatMap((msg) =>
    Array.isArray(msg.tracking_value_ids) ? (msg.tracking_value_ids as number[]) : []
  );
  const changes = await resolveTrackingValues(client, trackingIds);

  const processed = messages.map((msg) => {
    const ids = Array.isArray(msg.tracking_value_ids)
      ? (msg.tracking_value_ids as number[])
      : [];
    const resolved = ids
      .map((id) => changes.get(id))
      .filter((change): change is TrackingChange => change !== undefined);

    const { tracking_value_ids: _unresolvedIds, ...rest } = msg;

    return {
      ...rest,
      body:
        shouldStripHtml && typeof msg.body === "string"
          ? stripHtml(msg.body)
          : msg.body,
      ...(ids.length > 0 ? { tracking_values: resolved } : {}),
    };
  });

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
