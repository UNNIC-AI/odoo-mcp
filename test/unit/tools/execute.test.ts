import { describe, expect, it } from "vitest";
import { handleExecuteMethod } from "../../../src/tools/execute.js";
import { OPEN_POLICY } from "../../../src/access.js";
import { fakeClient, payloadOf } from "../../helpers/fake-client.js";

const run = (client: any, args: Record<string, unknown>) =>
  handleExecuteMethod(client, args, OPEN_POLICY);

describe("execute_method", () => {
  it("llama al método con ids, args y kwargs", async () => {
    const { client, lastCall } = fakeClient({ executeMethod: async () => "ok" });

    const payload = payloadOf(
      await run(client, {
        model: "sale.order",
        method: "action_confirm",
        ids: "1,2",
        args: '["extra"]',
        kwargs: '{"context":{"lang":"es_ES"}}',
      })
    );

    expect(payload.result).toBe("ok");
    expect(lastCall("executeMethod")!.args).toEqual([
      "sale.order",
      "action_confirm",
      [1, 2],
      ["extra"],
      { context: { lang: "es_ES" } },
    ]);
  });

  it.each(["create", "write", "unlink", "copy", "name_create", "web_save"])(
    "bloquea %s y redirige a la herramienta dedicada",
    async (method) => {
      const { client, calls } = fakeClient();

      const result = await run(client, { model: "sale.order", method, ids: "1" });

      expect(result.isError).toBe(true);
      expect(payloadOf(result).error).toMatch(/cannot be called through execute_method/);
      expect(calls).toHaveLength(0);
    }
  );

  it("exige model", async () => {
    const { client } = fakeClient();
    const result = await run(client, { model: "  ", method: "x", ids: "1" });
    expect(payloadOf(result).error).toMatch(/'model' is required/);
  });

  it("exige method", async () => {
    const { client } = fakeClient();
    const result = await run(client, { model: "sale.order", method: " ", ids: "1" });
    expect(payloadOf(result).error).toMatch(/'method' is required/);
  });

  it("rechaza una lista de ids vacía", async () => {
    const { client } = fakeClient();
    const result = await run(client, { model: "sale.order", method: "x", ids: " , " });
    expect(payloadOf(result).error).toMatch(/'ids' is empty/);
  });

  it("rechaza un id inválido", async () => {
    const { client } = fakeClient();
    await expect(
      run(client, { model: "sale.order", method: "x", ids: "1,dos" })
    ).rejects.toThrow(/Invalid record ID/);
  });

  it("rechaza args que no sea un array JSON", async () => {
    const { client } = fakeClient();
    const result = await run(client, {
      model: "sale.order",
      method: "x",
      ids: "1",
      args: '{"a":1}',
    });
    expect(payloadOf(result).error).toMatch(/must be a JSON array/);
  });

  it("rechaza kwargs que no sea un objeto JSON", async () => {
    const { client } = fakeClient();
    const result = await run(client, {
      model: "sale.order",
      method: "x",
      ids: "1",
      kwargs: "[1,2]",
    });
    expect(payloadOf(result).error).toMatch(/must be a JSON object/);
  });

  it.each(['{"a":', "["])("rechaza JSON malformado (%s)", async (bad) => {
    const { client } = fakeClient();
    const result = await run(client, {
      model: "sale.order",
      method: "x",
      ids: "1",
      kwargs: bad,
    });
    expect(result.isError).toBe(true);
  });

  // Los métodos de Odoo que devuelven None hacen fallar el marshalling XML-RPC
  // aunque la acción se haya ejecutado. No debe presentarse como un error.
  it("trata 'cannot marshal None' como éxito", async () => {
    const { client } = fakeClient({
      executeMethod: async () => {
        throw new Error("Fault: cannot marshal None unless allow_none is enabled");
      },
    });

    const result = await run(client, {
      model: "account.move",
      method: "action_post",
      ids: "5",
    });

    expect(result.isError).toBeUndefined();
    const payload = payloadOf(result);
    expect(payload.result).toBeNull();
    expect(payload.note).toMatch(/returned None/);
  });

  it("deja escapar cualquier otro error de Odoo", async () => {
    const { client } = fakeClient({
      executeMethod: async () => {
        throw new Error("AccessError: no tienes permiso");
      },
    });

    await expect(
      run(client, { model: "account.move", method: "action_post", ids: "5" })
    ).rejects.toThrow(/AccessError/);
  });
});
