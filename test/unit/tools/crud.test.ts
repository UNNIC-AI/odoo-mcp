import { describe, expect, it } from "vitest";
import { handleCreateRecord } from "../../../src/tools/create.js";
import { handleUpdateRecord } from "../../../src/tools/update.js";
import { handleDeleteRecord } from "../../../src/tools/delete.js";
import { handleReadRecord } from "../../../src/tools/read.js";
import { handleCountRecords } from "../../../src/tools/count.js";
import { OPEN_POLICY } from "../../../src/access.js";
import { fakeClient, payloadOf } from "../../helpers/fake-client.js";

describe("create_record", () => {
  it("crea un único registro con un objeto JSON", async () => {
    const { client, lastCall } = fakeClient({ create: async () => 42 });

    const payload = payloadOf(
      await handleCreateRecord(
        client,
        { model: "res.partner", values: '{"name":"Ana"}' },
        OPEN_POLICY
      )
    );

    expect(payload).toEqual({ success: true, id: 42 });
    expect(lastCall("create")!.args).toEqual(["res.partner", { name: "Ana" }]);
  });

  it("usa el create por lotes nativo con un array", async () => {
    const { client, lastCall, callsTo } = fakeClient({
      createBatch: async () => [7, 8],
    });

    const payload = payloadOf(
      await handleCreateRecord(
        client,
        { model: "res.partner", values: '[{"name":"Ana"},{"name":"Luis"}]' },
        OPEN_POLICY
      )
    );

    expect(payload).toEqual({ success: true, count: 2, ids: [7, 8] });
    expect(callsTo("create")).toHaveLength(0);
    expect(lastCall("createBatch")!.args[1]).toHaveLength(2);
  });

  it("rechaza un array vacío", async () => {
    const { client, calls } = fakeClient();
    const result = await handleCreateRecord(
      client,
      { model: "res.partner", values: "[]" },
      OPEN_POLICY
    );
    expect(result.isError).toBe(true);
    expect(payloadOf(result).error).toMatch(/empty array/);
    expect(calls).toHaveLength(0);
  });

  it("limita el lote a 100 registros", async () => {
    const { client, calls } = fakeClient();
    const values = JSON.stringify(Array.from({ length: 101 }, () => ({ name: "x" })));

    const result = await handleCreateRecord(
      client,
      { model: "res.partner", values },
      OPEN_POLICY
    );

    expect(result.isError).toBe(true);
    expect(payloadOf(result).error).toMatch(/limited to 100 records.*got 101/);
    expect(calls).toHaveLength(0);
  });

  it("acepta exactamente 100 registros", async () => {
    const { client } = fakeClient({ createBatch: async () => [] });
    const values = JSON.stringify(Array.from({ length: 100 }, () => ({ name: "x" })));

    const result = await handleCreateRecord(
      client,
      { model: "res.partner", values },
      OPEN_POLICY
    );

    expect(result.isError).toBeUndefined();
  });

  it("rechaza values que no sea JSON", async () => {
    const { client } = fakeClient();
    const result = await handleCreateRecord(
      client,
      { model: "res.partner", values: "{name: Ana}" },
      OPEN_POLICY
    );
    expect(result.isError).toBe(true);
    expect(payloadOf(result).error).toMatch(/Could not parse 'values'/);
  });
});

describe("update_record", () => {
  it("actualiza varios ids", async () => {
    const { client, lastCall } = fakeClient();

    const payload = payloadOf(
      await handleUpdateRecord(
        client,
        { model: "res.partner", ids: "1, 2,3", values: '{"active":false}' },
        OPEN_POLICY
      )
    );

    expect(payload).toEqual({ success: true, ids: [1, 2, 3] });
    expect(lastCall("update")!.args).toEqual([
      "res.partner",
      [1, 2, 3],
      { active: false },
    ]);
  });

  it("rechaza values que no sea JSON", async () => {
    const { client } = fakeClient();
    const result = await handleUpdateRecord(
      client,
      { model: "res.partner", ids: "1", values: "nope" },
      OPEN_POLICY
    );
    expect(payloadOf(result).error).toMatch(/Could not parse 'values'/);
  });
});

describe("validación de ids", () => {
  const cases: Array<[string, (c: any, a: any) => Promise<unknown>]> = [
    ["read_record", (c, a) => handleReadRecord(c, a, OPEN_POLICY)],
    ["delete_record", (c, a) => handleDeleteRecord(c, a, OPEN_POLICY)],
    [
      "update_record",
      (c, a) => handleUpdateRecord(c, { ...a, values: "{}" }, OPEN_POLICY),
    ],
  ];

  it.each(cases)("%s rechaza un id no numérico", async (_name, run) => {
    const { client } = fakeClient();
    await expect(run(client, { model: "res.partner", ids: "1,abc" })).rejects.toThrow(
      /Invalid record ID/
    );
  });

  it.each(cases)("%s rechaza un id negativo", async (_name, run) => {
    const { client } = fakeClient();
    await expect(run(client, { model: "res.partner", ids: "-3" })).rejects.toThrow(
      /Invalid record ID/
    );
  });

  it.each(cases)("%s rechaza el id cero", async (_name, run) => {
    const { client } = fakeClient();
    await expect(run(client, { model: "res.partner", ids: "0" })).rejects.toThrow(
      /Invalid record ID/
    );
  });
});

describe("read_record", () => {
  it("pide todos los campos si no se especifican", async () => {
    const { client, lastCall } = fakeClient({ read: async () => [{ id: 1 }] });

    await handleReadRecord(client, { model: "res.partner", ids: "1" }, OPEN_POLICY);

    expect(lastCall("read")!.args[2]).toBeUndefined();
  });

  it("recorta los espacios de la lista de campos", async () => {
    const { client, lastCall } = fakeClient({ read: async () => [{ id: 1 }] });

    await handleReadRecord(
      client,
      { model: "res.partner", ids: "1", fields: " name , email " },
      OPEN_POLICY
    );

    expect(lastCall("read")!.args[2]).toEqual(["name", "email"]);
  });
});

describe("delete_record", () => {
  it("devuelve los ids borrados", async () => {
    const { client } = fakeClient();
    const payload = payloadOf(
      await handleDeleteRecord(client, { model: "res.partner", ids: "4,5" }, OPEN_POLICY)
    );
    expect(payload).toEqual({ success: true, deleted_ids: [4, 5] });
  });
});

describe("count_records", () => {
  it("cuenta con un domain", async () => {
    const { client, lastCall } = fakeClient({ count: async () => 12 });

    const payload = payloadOf(
      await handleCountRecords(
        client,
        { model: "res.partner", domain: '[["is_company","=",true]]' },
        OPEN_POLICY
      )
    );

    expect(payload).toEqual({ model: "res.partner", count: 12 });
    expect(lastCall("count")!.args[1]).toEqual([["is_company", "=", true]]);
  });

  it("rechaza un domain inválido antes de llamar a Odoo", async () => {
    const { client, calls } = fakeClient();
    const result = await handleCountRecords(
      client,
      { model: "res.partner", domain: "[[" },
      OPEN_POLICY
    );
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
