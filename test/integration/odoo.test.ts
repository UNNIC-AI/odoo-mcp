/**
 * Pruebas contra un Odoo real. Ver test/integration/README.md.
 *
 * Sin las variables de entorno de conexión, el conjunto entero se salta: así
 * `npm test` no depende de tener Docker levantado.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { OdooClient, AuthenticationError } from "../../src/odoo-client.js";
import { OPEN_POLICY } from "../../src/access.js";
import { handleSearchRecords } from "../../src/tools/search.js";
import { handleGetFields } from "../../src/tools/fields.js";
import { handleWhoami } from "../../src/tools/whoami.js";
import { handleSearchGrouped } from "../../src/tools/group.js";
import { handleNameSearch } from "../../src/tools/name-search.js";
import { handleSearchCalendar } from "../../src/tools/calendar.js";
import { payloadOf } from "../helpers/fake-client.js";

const configured =
  !!process.env.ODOO_URL &&
  !!process.env.ODOO_DB &&
  !!process.env.ODOO_USER &&
  !!(process.env.ODOO_API_KEY || process.env.ODOO_PASSWORD);

describe.runIf(configured)("integración con Odoo", () => {
  let client: OdooClient;

  beforeAll(async () => {
    client = new OdooClient(loadConfig());
    await client.connect();
  }, 60000);

  it("autentica y devuelve un uid", () => {
    expect(client.uid).toBeGreaterThan(0);
  });

  // Es el fallo que motivó el cambio de config: sin login, Odoo rechaza la
  // credencial aunque la API key sea correcta.
  it("rechaza la autenticación sin login", async () => {
    const sinUsuario = new OdooClient({ ...loadConfig(), user: "" });
    await expect(sinUsuario.connect()).rejects.toThrow(AuthenticationError);
  });

  it("whoami describe la conexión con los campos que espera el código", async () => {
    const payload = payloadOf(await handleWhoami(client, {}, OPEN_POLICY));
    expect(payload.uid).toBe(client.uid);
    expect(payload.login).toBeTruthy();
    expect(payload.server.version).toBeTruthy();
    // group_ids es el nombre moderno del campo; en Odoo <=17 era groups_id.
    expect(Array.isArray(payload.groups)).toBe(true);
  });

  it("busca contactos con un domain real", async () => {
    const payload = payloadOf(
      await handleSearchRecords(
        client,
        { model: "res.partner", domain: '[["is_company","=",true]]', fields: "name", limit: 5 },
        OPEN_POLICY
      )
    );
    expect(payload.records.length).toBeGreaterThan(0);
    expect(payload.records[0]).toHaveProperty("name");
  });

  // El truco de pedir limit+1 solo se puede comprobar si hay más registros que
  // el límite, así que derivamos el límite del total real de la instancia.
  it("la paginación con limit+1 no devuelve de más", async () => {
    const total = await client.count("res.partner", []);
    expect(total).toBeGreaterThan(1);
    const limit = total - 1;

    const payload = payloadOf(
      await handleSearchRecords(
        client,
        { model: "res.partner", fields: "name", limit },
        OPEN_POLICY
      )
    );

    expect(payload.records).toHaveLength(limit);
    expect(payload.count).toBe(limit);
    expect(payload.has_more).toBe(true);
  });

  it("lee las definiciones de campo de res.partner", async () => {
    const payload = payloadOf(
      await handleGetFields(client, { model: "res.partner", filter: "email" }, OPEN_POLICY)
    );
    expect(payload.fields).toHaveProperty("email");
    expect(payload.fields.email.type).toBe("char");
  });

  // read_group está en desuso en Odoo recientes: esta prueba avisa el día que
  // deje de existir en la versión que uséis.
  it("read_group sigue disponible y agrega", async () => {
    const payload = payloadOf(
      await handleSearchGrouped(
        client,
        { model: "res.partner", fields: "id", groupby: "is_company" },
        OPEN_POLICY
      )
    );
    expect(payload.group_count).toBeGreaterThan(0);
  });

  it("name_search devuelve pares id/nombre", async () => {
    const payload = payloadOf(
      await handleNameSearch(client, { model: "res.partner", limit: 3 }, OPEN_POLICY)
    );
    expect(payload.records[0]).toHaveProperty("display_name");
  });

  it("el filtro de calendario por usuario construye un domain válido", async () => {
    const payload = payloadOf(await handleSearchCalendar(client, { limit: 5 }, OPEN_POLICY));
    expect(payload.filter).toBe("authenticated user only");
    expect(Array.isArray(payload.records)).toBe(true);
  });

  it("un modelo inexistente produce un error legible", async () => {
    await expect(
      client.searchRead("no.existe.este.modelo", [], ["id"], 1)
    ).rejects.toThrow();
  });
});
