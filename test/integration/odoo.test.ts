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
import { handleGetMessages } from "../../src/tools/message.js";
import { handleDownloadAttachment } from "../../src/tools/attachment.js";
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

  // La agrupación cambia de método según la versión (read_group hasta Odoo 18,
  // formatted_read_group a partir de 19). Sea cual sea, la salida que ve el
  // modelo debe ser la misma y el conteo debe venir en __count.
  it("agrupa y normaliza el conteo a __count", async () => {
    const payload = payloadOf(
      await handleSearchGrouped(
        client,
        { model: "res.partner", fields: "id", groupby: "is_company" },
        OPEN_POLICY
      )
    );

    expect(payload.group_count).toBeGreaterThan(0);
    expect(payload.count_field).toBe("__count");
    expect(payload.odoo_method).toMatch(/^(read_group|formatted_read_group)$/);

    for (const group of payload.groups) {
      expect(typeof group.__count).toBe("number");
      // El nombre viejo del contador no debe filtrarse a la salida.
      expect(group.is_company_count).toBeUndefined();
      expect(group.__domain).toBeUndefined();
    }
  });

  it("el método elegido concuerda con la versión del servidor", async () => {
    const major = await client.getServerMajorVersion();
    const payload = payloadOf(
      await handleSearchGrouped(
        client,
        { model: "res.partner", fields: "id", groupby: "is_company" },
        OPEN_POLICY
      )
    );

    expect(major).toBeGreaterThan(0);
    if (major < 19) expect(payload.odoo_method).toBe("read_group");
  });

  it("los datetime salen con desfase explícito, no como UTC ambiguo", async () => {
    const payload = payloadOf(
      await handleSearchRecords(
        client,
        { model: "res.partner", fields: "name,create_date", limit: 1 },
        OPEN_POLICY
      )
    );

    const createDate = payload.records[0].create_date;
    expect(createDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });

  it("un campo date se queda sin hora ni zona", async () => {
    const types = await client.getFieldTypes("res.partner");
    const dateField = Object.entries(types).find(([, type]) => type === "date")?.[0];
    if (!dateField) return;

    const payload = payloadOf(
      await handleSearchRecords(
        client,
        { model: "res.partner", fields: `name,${dateField}`, limit: 5 },
        OPEN_POLICY
      )
    );

    for (const record of payload.records) {
      const value = record[dateField];
      if (typeof value === "string") expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("getFieldTypes reconoce los tipos que usa la conversión", async () => {
    const types = await client.getFieldTypes("res.partner");
    expect(types.create_date).toBe("datetime");
    expect(types.name).toBe("char");
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

  // Los nombres de columna de mail.tracking.value cambiaron en Odoo 17. Esta
  // prueba provoca un cambio real y comprueba que se resuelve en esta versión.
  it("resuelve los cambios de seguimiento del chatter", async () => {
    const [partnerId] = (await client.searchRead(
      "res.partner",
      [["is_company", "=", true]],
      ["id"],
      1
    )) as Array<{ id: number }>;

    const marca = `Prueba ${process.pid}`;
    await client.update("res.partner", [partnerId.id], { phone: marca });

    const payload = payloadOf(
      await handleGetMessages(
        client,
        { model: "res.partner", res_id: partnerId.id, limit: 10 },
        OPEN_POLICY
      )
    );

    const conCambios = payload.messages.filter((m: any) => m.tracking_values?.length);
    expect(conCambios.length).toBeGreaterThan(0);

    const cambio = conCambios[0].tracking_values[0];
    expect(typeof cambio.field).toBe("string");
    expect(cambio.field).not.toBe("unknown field");
    expect(cambio).toHaveProperty("old_value");
    expect(cambio).toHaveProperty("new_value");
    // Los ids en crudo ya no llegan al modelo.
    expect(conCambios[0].tracking_value_ids).toBeUndefined();
  });

  it("descarga un adjunto de texto como texto legible", async () => {
    const contenido = "columna_a,columna_b\n1,2\n";
    const attachmentId = await client.create("ir.attachment", {
      name: "prueba-integracion.csv",
      mimetype: "text/csv",
      type: "binary",
      datas: Buffer.from(contenido, "utf8").toString("base64"),
    });

    try {
      const result = await handleDownloadAttachment(
        client,
        { id: attachmentId },
        OPEN_POLICY
      );

      const bloque = result.content.find((c) => c.type === "resource");
      expect(bloque).toBeDefined();
      expect((bloque as any).resource.text).toBe(contenido);
      // El base64 ya no viaja dentro del bloque de texto.
      expect(payloadOf(result).data).toBeUndefined();
    } finally {
      await client.delete("ir.attachment", [attachmentId]);
    }
  });
});
