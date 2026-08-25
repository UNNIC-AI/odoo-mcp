import { describe, expect, it } from "vitest";
import { resolveTrackingValues } from "../../../src/tools/message.js";
import { handleGetMessages } from "../../../src/tools/message.js";
import { OPEN_POLICY } from "../../../src/access.js";
import { fakeClient, payloadOf } from "../../helpers/fake-client.js";

/** Nombres de columna de Odoo 17+ (comprobados contra un Odoo 18 real). */
const MODERN_FIELDS = {
  field_id: "many2one",
  old_value_char: "char",
  new_value_char: "char",
  old_value_text: "text",
  new_value_text: "text",
  old_value_integer: "integer",
  new_value_integer: "integer",
  old_value_float: "float",
  new_value_float: "float",
  old_value_datetime: "datetime",
  new_value_datetime: "datetime",
};

/** Odoo <=16 usaba `field` y `field_desc`, y no tenía `field_id`. */
const LEGACY_FIELDS = {
  field: "many2one",
  field_desc: "char",
  old_value_char: "char",
  new_value_char: "char",
  old_value_integer: "integer",
  new_value_integer: "integer",
};

describe("resolveTrackingValues", () => {
  it("resuelve un cambio de texto con su etiqueta", async () => {
    const { client } = fakeClient({
      getFieldTypes: async () => MODERN_FIELDS,
      read: async () => [
        {
          id: 91,
          field_id: [939, "Phone (Contact)"],
          old_value_char: "(603)-996-3829",
          new_value_char: "+34 600 000 000",
          old_value_integer: 0,
          new_value_integer: 0,
        },
      ],
    });

    const changes = await resolveTrackingValues(client, [91]);

    expect(changes.get(91)).toEqual({
      field: "Phone (Contact)",
      old_value: "(603)-996-3829",
      new_value: "+34 600 000 000",
    });
  });

  it("elige el par numérico cuando el cambio es numérico", async () => {
    const { client } = fakeClient({
      getFieldTypes: async () => MODERN_FIELDS,
      read: async () => [
        {
          id: 1,
          field_id: [1, "Quantity"],
          old_value_char: false,
          new_value_char: false,
          old_value_integer: 3,
          new_value_integer: 7,
        },
      ],
    });

    expect((await resolveTrackingValues(client, [1])).get(1)).toEqual({
      field: "Quantity",
      old_value: 3,
      new_value: 7,
    });
  });

  // Un valor que pasa a cero sigue siendo un cambio: el lado antiguo lo delata.
  it("no se pierde un cambio a cero", async () => {
    const { client } = fakeClient({
      getFieldTypes: async () => MODERN_FIELDS,
      read: async () => [
        {
          id: 1,
          field_id: [1, "Quantity"],
          old_value_char: false,
          new_value_char: false,
          old_value_integer: 5,
          new_value_integer: 0,
        },
      ],
    });

    expect((await resolveTrackingValues(client, [1])).get(1)).toEqual({
      field: "Quantity",
      old_value: 5,
      new_value: 0,
    });
  });

  // Odoo deja a 0 las columnas numéricas que no corresponden al tipo del campo.
  // Si eligiéramos el par "que tenga algo" en vez del "que haya cambiado",
  // esas columnas ganarían y reportaríamos un falso 0 → 0.
  it("ignora las columnas numéricas que Odoo deja a cero", async () => {
    const { client } = fakeClient({
      getFieldTypes: async () => MODERN_FIELDS,
      read: async () => [
        {
          id: 1,
          field_id: [1, "Nota"],
          old_value_char: false,
          new_value_char: "texto nuevo",
          old_value_integer: 0,
          new_value_integer: 0,
          old_value_float: 0,
          new_value_float: 0,
        },
      ],
    });

    expect((await resolveTrackingValues(client, [1])).get(1)).toEqual({
      field: "Nota",
      old_value: null,
      new_value: "texto nuevo",
    });
  });

  it("convierte a la zona del usuario los valores de tipo datetime", async () => {
    const { client } = fakeClient({
      getFieldTypes: async () => MODERN_FIELDS,
      getTimezone: async () => "Europe/Madrid",
      read: async () => [
        {
          id: 1,
          field_id: [1, "Deadline"],
          old_value_char: false,
          new_value_char: false,
          old_value_datetime: "2026-08-25 08:00:00",
          new_value_datetime: "2026-08-26 09:30:00",
        },
      ],
    });

    expect((await resolveTrackingValues(client, [1])).get(1)).toEqual({
      field: "Deadline",
      old_value: "2026-08-25T10:00:00+02:00",
      new_value: "2026-08-26T11:30:00+02:00",
    });
  });

  // Regresión de compatibilidad: pedir field_id en un Odoo antiguo reventaba
  // la llamada entera con "Invalid field".
  it("usa field_desc en las versiones que no tienen field_id", async () => {
    const { client, lastCall } = fakeClient({
      getFieldTypes: async () => LEGACY_FIELDS,
      read: async () => [
        {
          id: 4,
          field: [12, "Teléfono"],
          field_desc: "Teléfono",
          old_value_char: "a",
          new_value_char: "b",
        },
      ],
    });

    const changes = await resolveTrackingValues(client, [4]);

    const requested = lastCall("read")!.args[2] as string[];
    expect(requested).not.toContain("field_id");
    expect(requested).not.toContain("old_value_datetime");
    expect(changes.get(4)!.field).toBe("Teléfono");
  });

  it("no llama a Odoo si no hay ids", async () => {
    const { client, calls } = fakeClient();
    expect((await resolveTrackingValues(client, [])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("sin permisos sobre mail.tracking.value devuelve un mapa vacío", async () => {
    const { client } = fakeClient({
      getFieldTypes: async () => MODERN_FIELDS,
      read: async () => {
        throw new Error("AccessError");
      },
    });

    expect((await resolveTrackingValues(client, [1])).size).toBe(0);
  });

  it("un registro sin ningún par relleno se marca como sin valores", async () => {
    const { client } = fakeClient({
      getFieldTypes: async () => MODERN_FIELDS,
      read: async () => [
        { id: 1, field_id: [1, "Algo"], old_value_char: false, new_value_char: false },
      ],
    });

    expect((await resolveTrackingValues(client, [1])).get(1)).toEqual({
      field: "Algo",
      old_value: null,
      new_value: null,
    });
  });
});

describe("get_messages con cambios de seguimiento", () => {
  const message = {
    id: 278,
    date: "2026-08-25 08:31:55",
    body: "<p>x</p>",
    message_type: "notification",
    tracking_value_ids: [91],
  };

  it("sustituye los ids por los cambios resueltos", async () => {
    const { client } = fakeClient({
      searchRead: async () => [message],
      getFieldTypes: async () => MODERN_FIELDS,
      read: async () => [
        {
          id: 91,
          field_id: [939, "Phone"],
          old_value_char: "viejo",
          new_value_char: "nuevo",
        },
      ],
    });

    const payload = payloadOf(
      await handleGetMessages(client, { model: "res.partner", res_id: 1 }, OPEN_POLICY)
    );

    const msg = payload.messages[0];
    expect(msg.tracking_value_ids).toBeUndefined();
    expect(msg.tracking_values).toEqual([
      { field: "Phone", old_value: "viejo", new_value: "nuevo" },
    ]);
  });

  it("resuelve los cambios de todos los mensajes en una sola lectura", async () => {
    const { client, callsTo } = fakeClient({
      searchRead: async () => [
        { ...message, id: 1, tracking_value_ids: [10, 11] },
        { ...message, id: 2, tracking_value_ids: [12] },
      ],
      getFieldTypes: async () => MODERN_FIELDS,
      read: async () =>
        [10, 11, 12].map((id) => ({
          id,
          field_id: [id, `Campo ${id}`],
          old_value_char: "a",
          new_value_char: "b",
        })),
    });

    await handleGetMessages(client, { model: "res.partner", res_id: 1 }, OPEN_POLICY);

    expect(callsTo("read")).toHaveLength(1);
    expect(callsTo("read")[0].args[1]).toEqual([10, 11, 12]);
  });

  it("un mensaje sin cambios no lleva el campo tracking_values", async () => {
    const { client, callsTo } = fakeClient({
      searchRead: async () => [{ ...message, tracking_value_ids: [] }],
    });

    const payload = payloadOf(
      await handleGetMessages(client, { model: "res.partner", res_id: 1 }, OPEN_POLICY)
    );

    expect(payload.messages[0].tracking_values).toBeUndefined();
    expect(callsTo("read")).toHaveLength(0);
  });
});
