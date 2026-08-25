import type { z } from "zod";
import type { OdooClient } from "../odoo-client.js";
import type { AccessPolicy } from "../access.js";

/**
 * Convenio de idiomas en este proyecto:
 *   - Comentarios y mensajes que lee una persona (stderr, README): español.
 *   - Todo lo que llega al modelo — nombres y descripciones de herramientas,
 *     y el contenido de ToolResult, incluidos los errores: inglés.
 */

/** Un elemento de salida de herramienta. Hoy solo se usa texto. */
export interface ToolTextContent {
  type: "text";
  text: string;
}

export interface ToolResult {
  content: ToolTextContent[];
  isError?: boolean;
}

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
