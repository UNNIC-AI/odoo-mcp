import { describe, expect, it } from "vitest";
import { handleSearchGrouped } from "../../../src/tools/group.js";
import { handleNameSearch } from "../../../src/tools/name-search.js";
import { handleGetFields } from "../../../src/tools/fields.js";
import { handleListModels } from "../../../src/tools/models.js";
import { handleGetMessages, handlePostMessage, stripHtml } from "../../../src/tools/message.js";
import { handleSearchCalendar } from "../../../src/tools/calendar.js";
import { handleWhoami } from "../../../src/tools/whoami.js";
import { OPEN_POLICY, type AccessPolicy } from "../../../src/access.js";
import { fakeClient, payloadOf } from "../../helpers/fake-client.js";

describe("search_grouped", () => {
  const base = { model: "sale.order", fields: "amount_total:sum", groupby: "state" };

  it("pasa campos y agrupaciones ya troceados", async () => {
    const { client, lastCall } = fakeClient({
      readGroup: async () => ({
        groups: [{ state: "sale", __count: 3 }],
        method: "read_group",
      }),
    });

    await handleSearchGrouped(
      client,
      { ...base, fields: " amount_total:sum , name ", groupby: " partner_id , state " },
      OPEN_POLICY
    );

    const [, , fields, groupby] = lastCall("readGroup")!.args;
    expect(fields).toEqual(["amount_total:sum", "name"]);
    expect(groupby).toEqual(["partner_id", "state"]);
  });

  it("anuncia dónde está el contador y qué método usó Odoo", async () => {
    const { client } = fakeClient({
      readGroup: async () => ({
        groups: [{ state: "sale", __count: 3 }],
        method: "read_group",
      }),
    });

    const payload = payloadOf(await handleSearchGrouped(client, base, OPEN_POLICY));

    expect(payload.count_field).toBe("__count");
    expect(payload.odoo_method).toBe("read_group");
    expect(payload.groups[0].__count).toBe(3);
  });

  it("avisa cuando no hay ningún grupo", async () => {
    const { client } = fakeClient({
      readGroup: async () => ({ groups: [], method: "read_group" }),
    });
    const payload = payloadOf(await handleSearchGrouped(client, base, OPEN_POLICY));
    expect(payload.group_count).toBe(0);
    expect(payload.message).toMatch(/No groups matched/);
  });

  it("rechaza fields vacío", async () => {
    const { client } = fakeClient();
    const result = await handleSearchGrouped(client, { ...base, fields: " , " }, OPEN_POLICY);
    expect(payloadOf(result).error).toMatch(/'fields' is empty/);
  });

  it("rechaza groupby vacío", async () => {
    const { client } = fakeClient();
    const result = await handleSearchGrouped(client, { ...base, groupby: "" }, OPEN_POLICY);
    expect(payloadOf(result).error).toMatch(/'groupby' is empty/);
  });

  it("rechaza un domain que no sea array", async () => {
    const { client } = fakeClient();
    const result = await handleSearchGrouped(
      client,
      { ...base, domain: '{"state":"sale"}' },
      OPEN_POLICY
    );
    expect(payloadOf(result).error).toMatch(/must be a JSON array/);
  });
});

describe("name_search", () => {
  it("convierte los pares [id, nombre] en objetos", async () => {
    const { client } = fakeClient({
      nameSearch: async () => [
        [1, "Ana Pérez"],
        [2, "Luis García"],
      ],
    });

    const payload = payloadOf(
      await handleNameSearch(client, { model: "res.partner", name: "a" }, OPEN_POLICY)
    );

    expect(payload.count).toBe(2);
    expect(payload.records[0]).toEqual({ id: 1, display_name: "Ana Pérez" });
  });

  it("usa ilike y límite 10 por defecto", async () => {
    const { client, lastCall } = fakeClient({ nameSearch: async () => [] });

    await handleNameSearch(client, { model: "res.partner" }, OPEN_POLICY);

    const [, name, , operator, limit] = lastCall("nameSearch")!.args;
    expect(name).toBe("");
    expect(operator).toBe("ilike");
    expect(limit).toBe(10);
  });

  it("detecta una respuesta con forma inesperada", async () => {
    const { client } = fakeClient({ nameSearch: async () => ({ oops: true }) });
    const result = await handleNameSearch(client, { model: "res.partner" }, OPEN_POLICY);
    expect(result.isError).toBe(true);
    expect(payloadOf(result).error).toMatch(/Unexpected response shape/);
  });
});

describe("get_fields", () => {
  it("pide un conjunto compacto de atributos por defecto", async () => {
    const { client, lastCall } = fakeClient({ getFields: async () => ({}) });

    await handleGetFields(client, { model: "res.partner" }, OPEN_POLICY);

    expect(lastCall("getFields")!.args[1]).toEqual([
      "string",
      "type",
      "required",
      "readonly",
      "relation",
    ]);
  });

  it("con all_attributes no limita los atributos", async () => {
    const { client, lastCall } = fakeClient({ getFields: async () => ({}) });
    await handleGetFields(client, { model: "res.partner", all_attributes: true }, OPEN_POLICY);
    expect(lastCall("getFields")!.args[1]).toBeUndefined();
  });

  it("filtra los campos por nombre sin distinguir mayúsculas", async () => {
    const { client } = fakeClient({
      getFields: async () => ({
        partner_id: { type: "many2one" },
        Partner_ref: { type: "char" },
        amount: { type: "float" },
      }),
    });

    const payload = payloadOf(
      await handleGetFields(client, { model: "sale.order", filter: "PARTNER" }, OPEN_POLICY)
    );

    expect(payload.field_count).toBe(2);
    expect(Object.keys(payload.fields).sort()).toEqual(["Partner_ref", "partner_id"]);
  });
});

describe("list_models", () => {
  it("excluye los modelos transitorios por defecto", async () => {
    const { client, lastCall } = fakeClient({ searchRead: async () => [] });
    await handleListModels(client, {}, OPEN_POLICY);
    expect(lastCall("searchRead")!.args[1]).toEqual([["transient", "=", false]]);
  });

  it("busca el filtro en nombre técnico y etiqueta", async () => {
    const { client, lastCall } = fakeClient({ searchRead: async () => [] });
    await handleListModels(client, { filter: "sale" }, OPEN_POLICY);
    expect(lastCall("searchRead")!.args[1]).toEqual([
      ["transient", "=", false],
      "|",
      ["model", "ilike", "sale"],
      ["name", "ilike", "sale"],
    ]);
  });

  it("no anuncia modelos que la lista blanca prohíbe", async () => {
    const { client } = fakeClient({
      searchRead: async () => [
        { model: "sale.order", name: "Pedido" },
        { model: "hr.payslip", name: "Nómina" },
      ],
    });
    const policy: AccessPolicy = { readonly: false, allowedModels: ["sale.*"] };

    const payload = payloadOf(await handleListModels(client, {}, policy));

    expect(payload.count).toBe(1);
    expect(payload.notice).toMatch(/Restricted to the models/);
  });
});

describe("get_messages / post_message", () => {
  it("filtra por registro y ordena por fecha descendente", async () => {
    const { client, lastCall } = fakeClient({ searchRead: async () => [] });

    await handleGetMessages(client, { model: "sale.order", res_id: 5 }, OPEN_POLICY);

    const [model, domain, , limit, , order] = lastCall("searchRead")!.args;
    expect(model).toBe("mail.message");
    expect(domain).toEqual([
      ["res_id", "=", 5],
      ["model", "=", "sale.order"],
    ]);
    expect(limit).toBe(20);
    expect(order).toBe("date desc");
  });

  it("convierte el HTML a texto plano si se pide", async () => {
    const { client } = fakeClient({
      searchRead: async () => [
        { body: "<p>Hola&nbsp;mundo</p><br/>Adi&oacute;s &amp; suerte" },
      ],
    });

    const payload = payloadOf(
      await handleGetMessages(
        client,
        { model: "sale.order", res_id: 5, strip_html: true },
        OPEN_POLICY
      )
    );

    // </p> y <br/> generan cada uno un salto, de ahí la línea en blanco.
    expect(payload.messages[0].body).toBe("Hola mundo\n\nAdiós & suerte");
  });

  // Antes solo se decodificaban seis entidades a mano y el resto se colaba
  // crudo hasta el modelo.
  it.each([
    ["&oacute;", "ó"],
    ["&eacute;", "é"],
    ["&ntilde;", "ñ"],
    ["&uuml;", "ü"],
    ["&#8212;", "—"],
    ["&#x2014;", "—"],
    ["&euro;", "€"],
    ["&hellip;", "…"],
    ["&laquo;", "«"],
  ])("decodifica la entidad %s", (entity, expected) => {
    expect(stripHtml(`<p>${entity}</p>`)).toBe(expected);
  });

  it("convierte listas y divs en saltos de línea", () => {
    expect(stripHtml("<ul><li>uno</li><li>dos</li></ul>")).toBe("uno\ndos");
  });

  it("no deja etiquetas ni espacios sobrantes", () => {
    expect(stripHtml('<div class="x">  Hola  </div>\n\n\n<p>Adiós</p>')).toBe(
      "Hola\n\nAdiós"
    );
  });

  it("deja el HTML intacto por defecto", async () => {
    const { client } = fakeClient({ searchRead: async () => [{ body: "<p>Hola</p>" }] });
    const payload = payloadOf(
      await handleGetMessages(client, { model: "sale.order", res_id: 5 }, OPEN_POLICY)
    );
    expect(payload.messages[0].body).toBe("<p>Hola</p>");
  });

  it("publica un comentario con el subtipo por defecto", async () => {
    const { client, lastCall } = fakeClient({ executeMethod: async () => 77 });

    await handlePostMessage(
      client,
      { model: "sale.order", res_id: 5, body: "Hola" },
      OPEN_POLICY
    );

    const [, method, ids, , kwargs] = lastCall("executeMethod")!.args as any[];
    expect(method).toBe("message_post");
    expect(ids).toEqual([5]);
    expect(kwargs.subtype_xmlid).toBe("mail.mt_comment");
    expect(kwargs.message_type).toBe("comment");
  });

  it("una notificación se publica como nota interna", async () => {
    const { client, lastCall } = fakeClient({ executeMethod: async () => 77 });

    await handlePostMessage(
      client,
      { model: "sale.order", res_id: 5, body: "Nota", message_type: "notification" },
      OPEN_POLICY
    );

    const kwargs = (lastCall("executeMethod")!.args as any[])[4];
    expect(kwargs.subtype_xmlid).toBe("mail.mt_note");
  });
});

describe("search_calendar", () => {
  it("filtra por el usuario autenticado y sus asistencias", async () => {
    const { client, lastCall } = fakeClient({ searchRead: async () => [] });

    const payload = payloadOf(await handleSearchCalendar(client, {}, OPEN_POLICY));

    expect(lastCall("searchRead")!.args[1]).toEqual([
      "|",
      ["user_id", "=", 2],
      ["partner_ids", "in", [7]],
    ]);
    expect(payload.filter).toBe("authenticated user only");
  });

  it("combina el filtro propio con un domain extra", async () => {
    const { client, lastCall } = fakeClient({ searchRead: async () => [] });

    await handleSearchCalendar(
      client,
      { domain: '[["start",">=","2026-03-01"]]' },
      OPEN_POLICY
    );

    expect(lastCall("searchRead")!.args[1]).toEqual([
      ["start", ">=", "2026-03-01"],
      "|",
      ["user_id", "=", 2],
      ["partner_ids", "in", [7]],
    ]);
  });

  it("con all_events no añade ningún filtro de usuario", async () => {
    const { client, lastCall, callsTo } = fakeClient({ searchRead: async () => [] });

    const payload = payloadOf(
      await handleSearchCalendar(client, { all_events: true }, OPEN_POLICY)
    );

    expect(lastCall("searchRead")!.args[1]).toEqual([]);
    expect(callsTo("getPartnerId")).toHaveLength(0);
    expect(payload.filter).toBe("all users");
  });

  it("rechaza un domain inválido", async () => {
    const { client, calls } = fakeClient();
    const result = await handleSearchCalendar(client, { domain: "{" }, OPEN_POLICY);
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("whoami", () => {
  const userRow = (groupsField: string) => ({
    name: "Bot",
    login: "bot@empresa.com",
    partner_id: [7, "Bot"],
    company_id: [1, "Mi Empresa"],
    [groupsField]: [1, 2],
    lang: "es_ES",
    tz: "Europe/Madrid",
  });

  const clientWith = (groupsField: string | null) =>
    fakeClient({
      getFields: async () =>
        groupsField ? { [groupsField]: { type: "many2many" } } : {},
      searchRead: async (model: string) => {
        if (model === "res.users") return [userRow(groupsField ?? "none")];
        return [
          { full_name: "Ventas / Usuario" },
          { full_name: "base.group_no_one" },
        ];
      },
    });

  it("resume la conexión y filtra los grupos técnicos", async () => {
    const { client } = clientWith("group_ids");

    const payload = payloadOf(await handleWhoami(client, {}, OPEN_POLICY));

    expect(payload.uid).toBe(2);
    expect(payload.login).toBe("bot@empresa.com");
    expect(payload.database).toBe("testdb");
    expect(payload.server.version).toBe("18.0");
    expect(payload.groups).toEqual(["Ventas / Usuario"]);
  });

  // Regresión: pedir el campo que no existe en esa versión hacía fallar la
  // llamada entera con "Invalid field 'group_ids' on model 'res.users'".
  it("usa groups_id en las versiones que no tienen group_ids", async () => {
    const { client, callsTo } = clientWith("groups_id");

    const payload = payloadOf(await handleWhoami(client, {}, OPEN_POLICY));

    // La primera lectura es la de res.users; la segunda, la de res.groups.
    const requestedFields = callsTo("searchRead")[0].args[2] as string[];
    expect(requestedFields).toContain("groups_id");
    expect(requestedFields).not.toContain("group_ids");
    expect(payload.groups).toEqual(["Ventas / Usuario"]);
  });

  it("sigue funcionando si no encuentra ningún campo de grupos", async () => {
    const { client } = clientWith(null);

    const payload = payloadOf(await handleWhoami(client, {}, OPEN_POLICY));

    expect(payload.groups).toEqual([]);
    expect(payload.login).toBe("bot@empresa.com");
  });

  it("informa si no puede leer el usuario", async () => {
    const { client } = fakeClient({
      getFields: async () => ({ group_ids: {} }),
      searchRead: async () => [],
    });
    const result = await handleWhoami(client, {}, OPEN_POLICY);
    expect(result.isError).toBe(true);
  });
});
