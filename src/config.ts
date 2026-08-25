/**
 * Configuración leída del entorno.
 *
 * Los mensajes de este módulo los lee una persona (aparecen en stderr y en los
 * logs del cliente MCP), por eso están en español. Todo lo que viaja hacia el
 * modelo — descripciones de herramientas y resultados — está en inglés.
 */

import { isValidTimeZone } from "./datetime.js";

const DEFAULT_TIMEOUT_MS = 30000;

export interface Config {
  url: string;
  db: string;
  user: string;
  /** API key o contraseña: Odoo acepta ambas en el mismo campo. */
  secret: string;
  /** true si se autenticó con ODOO_API_KEY (solo informativo). */
  usingApiKey: boolean;
  timeoutMs: number;
  readonly: boolean;
  /** null = sin restricción. Lista de patrones, p. ej. ["sale.*", "res.partner"]. */
  allowedModels: string[] | null;
  /** null = usar la zona horaria del usuario en Odoo. */
  timezone: string | null;
}

/** Error de configuración: su mensaje está en español y va dirigido al usuario. */
export class ConfigError extends Error {}

function parseTimeout(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_TIMEOUT_MS;
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigError(
      `ODOO_TIMEOUT debe ser un número entero positivo de segundos. Valor recibido: "${raw}"`
    );
  }
  return parsed * 1000;
}

function parseBoolean(raw: string | undefined, varName: string): boolean {
  if (raw === undefined || raw.trim() === "") return false;
  const value = raw.trim().toLowerCase();
  if (["1", "true", "yes", "si", "sí"].includes(value)) return true;
  if (["0", "false", "no"].includes(value)) return false;
  throw new ConfigError(
    `${varName} debe ser "true" o "false". Valor recibido: "${raw}"`
  );
}

function parseAllowedModels(raw: string | undefined): string[] | null {
  if (raw === undefined || raw.trim() === "") return null;
  const patterns = raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (patterns.length === 0) {
    throw new ConfigError(
      "ODOO_ALLOWED_MODELS no contiene ningún modelo. Déjalo sin definir para permitir todos los modelos."
    );
  }
  return patterns;
}

function parseTimezone(raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === "") return null;
  const timezone = raw.trim();
  if (!isValidTimeZone(timezone)) {
    throw new ConfigError(
      `ODOO_TIMEZONE no es una zona horaria conocida: "${timezone}". ` +
        'Usa un identificador IANA, por ejemplo "Europe/Madrid" o "UTC".'
    );
  }
  return timezone;
}

/**
 * Valida el entorno y devuelve la configuración.
 * Lanza ConfigError con un mensaje accionable si algo falta o es inválido.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const url = env.ODOO_URL?.trim();
  const db = env.ODOO_DB?.trim();
  const user = env.ODOO_USER?.trim();
  const apiKey = env.ODOO_API_KEY?.trim();
  const password = env.ODOO_PASSWORD;

  const missing: string[] = [];
  if (!url) missing.push("ODOO_URL");
  if (!db) missing.push("ODOO_DB");
  if (missing.length > 0) {
    throw new ConfigError(
      `Faltan variables de entorno obligatorias: ${missing.join(", ")}.`
    );
  }

  // Odoo exige un login incluso cuando la credencial es una API key: la clave
  // viaja en el campo de contraseña, no sustituye al usuario.
  if (!user) {
    throw new ConfigError(
      "ODOO_USER es obligatorio: debe ser el login (email) del usuario de Odoo. " +
        "Odoo lo exige también cuando te autenticas con ODOO_API_KEY, porque la " +
        "clave ocupa el lugar de la contraseña pero no el del usuario."
    );
  }

  if (!apiKey && !password) {
    throw new ConfigError(
      "Debes definir ODOO_API_KEY (recomendado) o ODOO_PASSWORD."
    );
  }

  try {
    new URL(url!);
  } catch {
    throw new ConfigError(
      `ODOO_URL no es una URL válida: "${url}". Ejemplo: https://miempresa.odoo.com`
    );
  }

  return {
    url: url!,
    db: db!,
    user,
    secret: apiKey || password!,
    usingApiKey: !!apiKey,
    timeoutMs: parseTimeout(env.ODOO_TIMEOUT),
    readonly: parseBoolean(env.ODOO_READONLY, "ODOO_READONLY"),
    allowedModels: parseAllowedModels(env.ODOO_ALLOWED_MODELS),
    timezone: parseTimezone(env.ODOO_TIMEZONE),
  };
}

/** Resumen de la configuración activa, para mostrar en stderr al arrancar. */
export function describeConfig(config: Config): string {
  const lines = [
    `Odoo: ${config.url} (base de datos: ${config.db})`,
    `Usuario: ${config.user} — autenticación por ${config.usingApiKey ? "API key" : "contraseña"}`,
  ];
  if (config.readonly) {
    lines.push("Modo solo lectura ACTIVADO: las herramientas de escritura no se registran.");
  }
  if (config.allowedModels) {
    lines.push(`Modelos permitidos: ${config.allowedModels.join(", ")}`);
  }
  lines.push(
    config.timezone
      ? `Zona horaria: ${config.timezone} (fijada por ODOO_TIMEZONE)`
      : "Zona horaria: la del usuario en Odoo"
  );
  return lines.join("\n");
}
