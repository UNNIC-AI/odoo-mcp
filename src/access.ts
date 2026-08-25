/**
 * Política de acceso: modo solo lectura y lista blanca de modelos.
 *
 * Los mensajes de este módulo se devuelven al modelo, así que están en inglés.
 * Los errores de configuración dirigidos a la persona viven en config.ts.
 *
 * Esto es una segunda barrera, no la principal. El límite real son los permisos
 * del usuario de Odoo con el que se conecta el servidor; la lista blanca solo
 * reduce lo que este proceso está dispuesto a pedir.
 */

import type { Config } from "./config.js";

export interface AccessPolicy {
  readonly: boolean;
  /** null = se permiten todos los modelos. */
  allowedModels: string[] | null;
}

export function policyFromConfig(config: Config): AccessPolicy {
  return { readonly: config.readonly, allowedModels: config.allowedModels };
}

/** Política sin restricciones — la de por defecto si no se configura nada. */
export const OPEN_POLICY: AccessPolicy = {
  readonly: false,
  allowedModels: null,
};

/**
 * Un patrón es un nombre exacto ("res.partner") o un prefijo terminado en "*"
 * ("sale.*", o "*" para todo).
 */
function matchesPattern(pattern: string, model: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) {
    return model.startsWith(pattern.slice(0, -1));
  }
  return pattern === model;
}

export function isModelAllowed(policy: AccessPolicy, model: string): boolean {
  if (!policy.allowedModels) return true;
  return policy.allowedModels.some((p) => matchesPattern(p, model));
}

/** Lanza un error con un mensaje sobre el que el modelo pueda actuar. */
export function assertModelAllowed(policy: AccessPolicy, model: string): void {
  if (isModelAllowed(policy, model)) return;
  throw new Error(
    `Model '${model}' is not allowed by this server's configuration. ` +
      `Allowed models: ${policy.allowedModels!.join(", ")}. ` +
      `This is a fixed server setting — do not retry with a different tool.`
  );
}
