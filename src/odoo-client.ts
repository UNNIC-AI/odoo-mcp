import xmlrpc from "xmlrpc";
import type { Config } from "./config.js";
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

  async readGroup(
    model: string,
    domain: OdooDomain = [],
    fields: string[],
    groupby: string[],
    orderby?: string,
    limit?: number,
    lazy?: boolean
  ): Promise<unknown[]> {
    const kwargs: Record<string, unknown> = {};
    if (orderby) kwargs.orderby = orderby;
    if (limit !== undefined) kwargs.limit = limit;
    if (lazy !== undefined) kwargs.lazy = lazy;

    return (await this.execute(
      model,
      "read_group",
      [domain, fields, groupby],
      kwargs
    )) as unknown[];
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
}
