import xmlrpc from "xmlrpc";
import type { Config } from "./config.js";
import { isValidTimeZone, localizeRecords } from "./datetime.js";
import type { OdooConfig, OdooDomain } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30000;

function createClient(url: string, path: string) {
  const parsed = new URL(path, url);
  const isSecure = parsed.protocol === "https:";
  const options = {
    host: parsed.hostname,
    port: parsed.port
      ? parseInt(parsed.port)
      : isSecure
        ? 443
        : 80,
    path: parsed.pathname,
  };
  return isSecure
    ? xmlrpc.createSecureClient(options)
    : xmlrpc.createClient(options);
}

function call(
  client: xmlrpc.Client,
  method: string,
  params: unknown[],
  timeoutMs?: number
): Promise<unknown> {
  const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`XML-RPC request timed out after ${timeout}ms`));
    }, timeout);

    client.methodCall(method, params, (err: any, value: any) => {
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value);
    });
  });
}

/**
 * Error de autenticación. Su mensaje lo lee el usuario al arrancar el
 * servidor, por eso está en español.
 */
export class AuthenticationError extends Error {}

export class OdooClient {
  private config: OdooConfig | null = null;
  private params: Config;
  private timeoutMs: number;
  private objectClient: xmlrpc.Client | null = null;
  private commonClient: xmlrpc.Client | null = null;
  private _partnerId: number | null = null;
  private _serverMajor: number | null = null;
  private _timezone: string | null = null;
  private _fieldTypes = new Map<string, Record<string, string>>();

  constructor(params: Config) {
    this.params = params;
    this.timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get uid(): number {
    if (!this.config) throw new Error("Not connected. Call connect() first.");
    return this.config.uid;
  }

  async getPartnerId(): Promise<number> {
    if (this._partnerId) return this._partnerId;
    const users = (await this.read("res.users", [this.uid], ["partner_id"])) as Record<string, unknown>[];
    if (users.length > 0 && Array.isArray(users[0].partner_id)) {
      this._partnerId = users[0].partner_id[0] as number;
    } else {
      throw new Error("Could not read partner_id for the current user.");
    }
    return this._partnerId;
  }

  async connect(): Promise<void> {
    const { url, db, user, secret, usingApiKey } = this.params;

    // Reutilizamos el cliente "common" entre reconexiones.
    if (!this.commonClient) {
      this.commonClient = createClient(url, "/xmlrpc/2/common");
    }

    // Odoo espera el login en el segundo argumento y la credencial en el
    // tercero, sea contraseña o API key. Nunca se autentica sin login.
    const uid = (await call(this.commonClient, "authenticate", [
      db,
      user,
      secret,
      {},
    ], this.timeoutMs)) as number | false;

    if (!uid) {
      const credentialVar = usingApiKey ? "ODOO_API_KEY" : "ODOO_PASSWORD";
      throw new AuthenticationError(
        `Odoo ha rechazado las credenciales del usuario "${user}" en la base de datos "${db}". ` +
          `Revisa ODOO_URL, ODOO_DB, ODOO_USER y ${credentialVar}. ` +
          "ODOO_USER debe ser el login del usuario (normalmente su email), no su nombre visible."
      );
    }

    this.config = { url, db, uid, password: secret };
  }

  getUid(): number {
    return this.uid;
  }

  getDatabase(): string {
    if (!this.config) throw new Error("Not connected. Call connect() first.");
    return this.config.db;
  }

  getUrl(): string {
    return this.params.url;
  }

  private getCommonClient() {
    if (!this.commonClient) {
      this.commonClient = createClient(this.params.url, "/xmlrpc/2/common");
    }
    return this.commonClient;
  }

  async getVersion(): Promise<Record<string, unknown>> {
    return (await call(this.getCommonClient(), "version", [])) as Record<string, unknown>;
  }

  private getObjectClient() {
    if (!this.config) throw new Error("Not connected. Call connect() first.");
    if (!this.objectClient) {
      this.objectClient = createClient(this.config.url, "/xmlrpc/2/object");
    }
    return this.objectClient;
  }

  private async execute(
    model: string,
    method: string,
    args: unknown[],
    kwargs: Record<string, unknown> = {}
  ): Promise<unknown> {
    if (!this.config) throw new Error("Not connected. Call connect() first.");
    const client = this.getObjectClient();
    return call(client, "execute_kw", [
      this.config.db,
      this.config.uid,
      this.config.password,
      model,
      method,
      args,
      kwargs,
    ], this.timeoutMs);
  }

  async executeMethod(
    model: string,
    method: string,
    ids: number[],
    args: unknown[] = [],
    kwargs: Record<string, unknown> = {}
  ): Promise<unknown> {
    return this.execute(model, method, [ids, ...args], kwargs);
  }

  async searchRead(
    model: string,
    domain: OdooDomain = [],
    fields?: string[],
    limit?: number,
    offset?: number,
    order?: string
  ): Promise<unknown[]> {
    const kwargs: Record<string, unknown> = {};
    if (fields && fields.length > 0) kwargs.fields = fields;
    if (limit !== undefined) kwargs.limit = limit;
    if (offset !== undefined) kwargs.offset = offset;
    if (order) kwargs.order = order;

    return (await this.execute(
      model,
      "search_read",
      [domain],
      kwargs
    )) as unknown[];
  }

  async read(
    model: string,
    ids: number[],
    fields?: string[]
  ): Promise<unknown[]> {
    const kwargs: Record<string, unknown> = {};
    if (fields && fields.length > 0) kwargs.fields = fields;

    return (await this.execute(model, "read", [ids], kwargs)) as unknown[];
  }

  async create(
    model: string,
    values: Record<string, unknown>
  ): Promise<number> {
    return (await this.execute(model, "create", [values])) as number;
  }

  async createBatch(
    model: string,
    valuesList: Record<string, unknown>[]
  ): Promise<number[]> {
    return (await this.execute(model, "create", [valuesList])) as number[];
  }

  async update(
    model: string,
    ids: number[],
    values: Record<string, unknown>
  ): Promise<boolean> {
    return (await this.execute(model, "write", [ids, values])) as boolean;
  }

  async delete(model: string, ids: number[]): Promise<boolean> {
    return (await this.execute(model, "unlink", [ids])) as boolean;
  }

  async count(model: string, domain: OdooDomain = []): Promise<number> {
    return (await this.execute(
      model,
      "search_count",
      [domain]
    )) as number;
  }

  async listModels(): Promise<unknown[]> {
    return this.searchRead(
      "ir.model",
      [],
      ["model", "name", "state", "transient"],
      undefined,
      undefined,
      "model"
    );
  }

  /**
   * Agrupación tolerante a la versión de Odoo.
   *
   * Hasta Odoo 18 el método público es `read_group`. Odoo 19 lo sustituye por
   * `formatted_read_group`, con otra firma y otra forma de salida. Elegimos por
   * versión de servidor y, si el método nuevo no responde, reintentamos con el
   * viejo. Ambas salidas se normalizan a la misma forma: los valores de
   * agrupación y agregación tal cual, más `__count` con el número de registros.
   */
  async readGroup(
    model: string,
    domain: OdooDomain = [],
    fields: string[],
    groupby: string[],
    orderby?: string,
    limit?: number,
    lazy?: boolean
  ): Promise<{ groups: unknown[]; method: string }> {
    const major = await this.getServerMajorVersion();

    if (major >= 19) {
      try {
        const kwargs: Record<string, unknown> = {
          groupby,
          aggregates: fields,
        };
        if (orderby) kwargs.order = orderby;
        if (limit !== undefined) kwargs.limit = limit;

        const raw = (await this.execute(
          model,
          "formatted_read_group",
          [domain],
          kwargs
        )) as Record<string, unknown>[];

        return { groups: raw, method: "formatted_read_group" };
      } catch {
        // Odoo 19 temprano o un modelo que aún no lo implementa: seguimos abajo.
      }
    }

    const kwargs: Record<string, unknown> = {};
    if (orderby) kwargs.orderby = orderby;
    if (limit !== undefined) kwargs.limit = limit;
    if (lazy !== undefined) kwargs.lazy = lazy;

    const raw = (await this.execute(
      model,
      "read_group",
      [domain, fields, groupby],
      kwargs
    )) as Record<string, unknown>[];

    return { groups: normalizeReadGroup(raw, groupby), method: "read_group" };
  }

  async nameSearch(
    model: string,
    name: string = "",
    domain: unknown[] = [],
    operator: string = "ilike",
    limit: number = 10
  ): Promise<unknown> {
    return this.execute(model, "name_search", [], {
      name,
      args: domain,
      operator,
      limit,
    });
  }

  async getFields(
    model: string,
    attributes?: string[]
  ): Promise<unknown> {
    const kwargs: Record<string, unknown> = {};
    if (attributes && attributes.length > 0) kwargs.attributes = attributes;

    return this.execute(model, "fields_get", [], kwargs);
  }

  /** Mayor de la versión del servidor (18 para "18.0"), cacheado. */
  async getServerMajorVersion(): Promise<number> {
    if (this._serverMajor !== null) return this._serverMajor;
    try {
      const version = await this.getVersion();
      const info = version.server_version_info;
      this._serverMajor = Array.isArray(info) ? Number(info[0]) || 0 : 0;
    } catch {
      this._serverMajor = 0;
    }
    return this._serverMajor;
  }

  /** Mapa campo → tipo de un modelo, cacheado mientras viva el proceso. */
  async getFieldTypes(model: string): Promise<Record<string, string>> {
    const cached = this._fieldTypes.get(model);
    if (cached) return cached;

    let types: Record<string, string> = {};
    try {
      const fields = (await this.getFields(model, ["type"])) as Record<
        string,
        { type?: string }
      >;
      types = Object.fromEntries(
        Object.entries(fields).map(([name, def]) => [name, def?.type ?? ""])
      );
    } catch {
      // Sin permisos sobre fields_get seguimos: solo perdemos la conversión.
      types = {};
    }

    this._fieldTypes.set(model, types);
    return types;
  }

  /**
   * Zona horaria con la que se presentan los datetime: ODOO_TIMEZONE si está
   * definida, si no la del usuario en Odoo, y UTC como último recurso.
   */
  async getTimezone(): Promise<string> {
    if (this._timezone) return this._timezone;

    if (this.params.timezone) {
      this._timezone = this.params.timezone;
      return this._timezone;
    }

    try {
      const users = (await this.read("res.users", [this.uid], [
        "tz",
      ])) as Record<string, unknown>[];
      const tz = users[0]?.tz;
      this._timezone =
        typeof tz === "string" && tz && isValidTimeZone(tz) ? tz : "UTC";
    } catch {
      this._timezone = "UTC";
    }

    return this._timezone;
  }

  /**
   * Pasa los campos datetime de unos registros a la zona del usuario. Es lo
   * que usan las herramientas antes de devolver registros al modelo.
   */
  async localizeRecords(model: string, records: unknown[]): Promise<unknown[]> {
    if (records.length === 0) return records;
    const [fieldTypes, timezone] = await Promise.all([
      this.getFieldTypes(model),
      this.getTimezone(),
    ]);
    return localizeRecords(records, fieldTypes, timezone);
  }
}

/**
 * read_group devuelve el conteo en `<primer_groupby>_count` y añade `__domain`.
 * Lo pasamos a `__count` para que la salida no dependa de por qué campo se
 * agrupe ni de la versión de Odoo.
 */
function normalizeReadGroup(
  groups: Record<string, unknown>[],
  groupby: string[]
): Record<string, unknown>[] {
  // El nombre del contador usa el campo sin el sufijo de granularidad
  // ("date_order:month" cuenta en "date_order_count").
  const first = (groupby[0] ?? "").split(":")[0];
  const counter = first ? `${first}_count` : "";

  return groups.map((group) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(group)) {
      if (key === "__domain" || key === "__range" || key === "__fold") continue;
      if (counter && key === counter) {
        out.__count = value;
        continue;
      }
      out[key] = value;
    }
    if (!("__count" in out) && typeof group.__count === "number") {
      out.__count = group.__count;
    }
    return out;
  });
}
