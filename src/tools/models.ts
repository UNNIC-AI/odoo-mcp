import { z } from "zod";
import type { OdooClient } from "../odoo-client.js";
import type { OdooDomain } from "../types.js";
import type { ToolDefinition, ToolResult } from "./types.js";
import { isModelAllowed, OPEN_POLICY, type AccessPolicy } from "../access.js";

export const listModelsTool: ToolDefinition = {
  name: "list_models",
  description:
    "List available Odoo models. By default excludes transient (wizard) models. Use filter to narrow results.",
  inputSchema: {
    filter: z
      .string()
      .optional()
      .describe(
        'Text filter to match model name or technical name (e.g., "sale", "partner"). Strongly recommended to reduce response size'
      ),
    include_transient: z
      .boolean()
      .optional()
      .describe(
        "Include transient (wizard) models. Default: false"
      ),
  },
};

export async function handleListModels(
  client: OdooClient,
  args: Record<string, unknown>,
  policy: AccessPolicy = OPEN_POLICY
): Promise<ToolResult> {
  const filter = args.filter as string | undefined;
  const includeTransient = (args.include_transient as boolean) ?? false;

  // Construimos el domain para que Odoo filtre en servidor.
  const domain: OdooDomain = [];
  if (!includeTransient) {
    domain.push(["transient", "=", false]);
  }
  if (filter) {
    domain.push("|");
    domain.push(["model", "ilike", filter]);
    domain.push(["name", "ilike", filter]);
  }

  const records = (await client.searchRead(
    "ir.model",
    domain,
    ["model", "name", "state", "transient"],
    undefined,
    undefined,
    "model"
  )) as Array<Record<string, unknown>>;

  // Nunca anunciamos modelos que la lista blanca no permite tocar: si el
  // modelo no puede usarlos, verlos aquí solo provoca llamadas fallidas.
  const models = records
    .filter((r) => isModelAllowed(policy, r.model as string))
    .map((r) => ({
      model: r.model,
      name: r.name,
      state: r.state,
      transient: r.transient,
    }));

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            count: models.length,
            ...(policy.allowedModels
              ? { notice: "Restricted to the models this server is configured to allow." }
              : {}),
            models,
          },
          null,
          2
        ),
      },
    ],
  };
}
