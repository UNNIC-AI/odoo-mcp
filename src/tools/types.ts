import type { z } from "zod";
import type { OdooClient } from "../odoo-client.js";
import type { AccessPolicy } from "../access.js";

/**
 * Convenio de idiomas en este proyecto:
 *   - Comentarios y mensajes que lee una persona (stderr, README): español.
 *   - Todo lo que llega al modelo — nombres y descripciones de herramientas,
 *     y el contenido de ToolResult, incluidos los errores: inglés.
 */

export interface ToolTextContent {
  type: "text";
  text: string;
}

/** Imagen que el cliente MCP puede mostrar directamente. */
export interface ToolImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

/**
 * Recurso incrustado: `text` para lo que el modelo puede leer, `blob` (base64)
 * para lo binario. Es la forma correcta de devolver un fichero sin volcarlo
 * como texto en el contexto.
 */
export interface ToolResourceContent {
  type: "resource";
  resource:
    | { uri: string; mimeType?: string; text: string }
    | { uri: string; mimeType?: string; blob: string };
}

export type ToolContent =
  | ToolTextContent
  | ToolImageContent
  | ToolResourceContent;

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

/**
 * Los datetime salen convertidos a la zona del usuario, pero Odoo sigue
 * interpretando en UTC los que entran en un domain. Sin avisar, el modelo lee
 * una hora local y la reenvía como filtro, desfasada.
 */
export const UTC_DOMAIN_HINT =
  " Datetime values inside a domain must be in UTC ('YYYY-MM-DD HH:MM:SS'), even though returned datetimes are shown in the user's timezone with an explicit offset.";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodRawShape;
}

/**
 * Los handlers reciben la política como tercer argumento. La mayoría la
 * ignora; la necesitan los que resuelven el modelo en tiempo de ejecución
 * (adjuntos) o filtran su propia salida (list_models).
 */
export type ToolHandler = (
  client: OdooClient,
  args: Record<string, unknown>,
  policy: AccessPolicy
) => Promise<ToolResult>;
