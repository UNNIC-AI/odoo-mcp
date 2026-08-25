/**
 * Registro de herramientas.
 *
 * Separado de index.ts para poder probar qué herramientas quedan registradas
 * bajo una AccessPolicy dada sin abrir ningún transporte.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OdooClient } from "./odoo-client.js";
import { assertModelAllowed, isModelAllowed, type AccessPolicy } from "./access.js";

import { searchRecordsTool, handleSearchRecords } from "./tools/search.js";
import { readRecordTool, handleReadRecord } from "./tools/read.js";
import { createRecordTool, handleCreateRecord } from "./tools/create.js";
import { updateRecordTool, handleUpdateRecord } from "./tools/update.js";
import { deleteRecordTool, handleDeleteRecord } from "./tools/delete.js";
import { countRecordsTool, handleCountRecords } from "./tools/count.js";
import { listModelsTool, handleListModels } from "./tools/models.js";
import { getFieldsTool, handleGetFields } from "./tools/fields.js";
import { searchGroupedTool, handleSearchGrouped } from "./tools/group.js";
import { executeMethodTool, handleExecuteMethod } from "./tools/execute.js";
import { nameSearchTool, handleNameSearch } from "./tools/name-search.js";
import { getMessagesTool, handleGetMessages, postMessageTool, handlePostMessage } from "./tools/message.js";
import {
  listAttachmentsTool, handleListAttachments,
  uploadAttachmentTool, handleUploadAttachment,
  downloadAttachmentTool, handleDownloadAttachment,
} from "./tools/attachment.js";
import { searchCalendarTool, handleSearchCalendar } from "./tools/calendar.js";
import { whoamiTool, handleWhoami } from "./tools/whoami.js";
import type { ToolDefinition, ToolHandler } from "./tools/types.js";

export interface ToolEntry {
  def: ToolDefinition;
  handler: ToolHandler;
  /** Escribe en Odoo. No se registra cuando ODOO_READONLY=true. */
  write: boolean;
  /**
   * Modelo sobre el que la herramienta opera siempre, cuando no lo elige quien
   * la llama. Sirve para ocultarla si la lista blanca excluye ese modelo.
   */
  fixedModel?: string;
  /**
   * Exenta de la lista blanca. Solo para herramientas que no leen más que los
   * metadatos de la propia conexión.
   */
  alwaysAvailable?: boolean;
}

export const TOOLS: ToolEntry[] = [
  { def: searchRecordsTool, handler: handleSearchRecords, write: false },
  { def: readRecordTool, handler: handleReadRecord, write: false },
  { def: createRecordTool, handler: handleCreateRecord, write: true },
  { def: updateRecordTool, handler: handleUpdateRecord, write: true },
  { def: deleteRecordTool, handler: handleDeleteRecord, write: true },
  { def: countRecordsTool, handler: handleCountRecords, write: false },
  { def: listModelsTool, handler: handleListModels, write: false, alwaysAvailable: true },
  { def: getFieldsTool, handler: handleGetFields, write: false },
  { def: searchGroupedTool, handler: handleSearchGrouped, write: false },
  { def: executeMethodTool, handler: handleExecuteMethod, write: true },
  { def: nameSearchTool, handler: handleNameSearch, write: false },
  { def: getMessagesTool, handler: handleGetMessages, write: false },
  { def: postMessageTool, handler: handlePostMessage, write: true },
  { def: listAttachmentsTool, handler: handleListAttachments, write: false },
  { def: uploadAttachmentTool, handler: handleUploadAttachment, write: true },
  { def: downloadAttachmentTool, handler: handleDownloadAttachment, write: false },
  { def: searchCalendarTool, handler: handleSearchCalendar, write: false, fixedModel: "calendar.event" },
  { def: whoamiTool, handler: handleWhoami, write: false, alwaysAvailable: true },
];

/** Las herramientas que sobreviven a una política, en orden de registro. */
export function selectTools(policy: AccessPolicy, tools: ToolEntry[] = TOOLS): ToolEntry[] {
  return tools.filter((entry) => {
    if (policy.readonly && entry.write) return false;
    if (entry.alwaysAvailable) return true;
    if (entry.fixedModel && !isModelAllowed(policy, entry.fixedModel)) return false;
    return true;
  });
}

function errorResult(message: string) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify({ error: message }, null, 2) },
    ],
    isError: true,
  };
}

/**
 * Envuelve un handler con lo que comparten todas las herramientas: comprobar
 * la lista blanca sobre el argumento `model` que envía quien llama, y convertir
 * las excepciones en resultados de herramienta en vez de fallos de transporte.
 */
export function wrapHandler(
  client: OdooClient,
  policy: AccessPolicy,
  entry: ToolEntry
) {
  return async (args: Record<string, unknown>) => {
    try {
      if (typeof args.model === "string" && args.model.trim() !== "") {
        assertModelAllowed(policy, args.model.trim());
      }
      if (entry.fixedModel) {
        assertModelAllowed(policy, entry.fixedModel);
      }
      return await entry.handler(client, args ?? {}, policy);
    } catch (err) {
      return errorResult((err as Error).message);
    }
  };
}

export function createServer(
  client: OdooClient,
  policy: AccessPolicy,
  version: string
): McpServer {
  const server = new McpServer({ name: "odoo-mcp", version });

  for (const entry of selectTools(policy)) {
    server.registerTool(
      entry.def.name,
      {
        description: entry.def.description,
        inputSchema: entry.def.inputSchema,
        annotations: {
          readOnlyHint: !entry.write,
          destructiveHint: entry.def.name === "delete_record",
        },
      },
      wrapHandler(client, policy, entry) as never
    );
  }

  return server;
}
