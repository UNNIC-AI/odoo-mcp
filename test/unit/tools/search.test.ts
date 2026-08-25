import { describe, expect, it } from "vitest";
import { handleSearchRecords } from "../../../src/tools/search.js";
import { OPEN_POLICY } from "../../../src/access.js";
import { fakeClient, payloadOf } from "../../helpers/fake-client.js";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));

describe("search_records", () => {
  it("pide solo id/name/display_name si no se indican campos, y lo avisa", async () => {
    const { client, lastCall } = fakeClient({ searchRead: async () => rows(2) });

    const payload = payloadOf(
      await handleSearchRecords(client, { model: "res.partner" }, OPEN_POLICY)
    );

    expect(lastCall("searchRead")!.args[2]).toEqual(["id", "name", "display_name"]);
    expect(payload.notice).toMatch(/only id, name and display_name/);
  });

  it("no avisa cuando los campos son explícitos", async () => {
    const { client, lastCall } = fakeClient({ searchRead: async () => rows(1) });

    const payload = payloadOf(
      await handleSearchRecords(
        client,
        { model: "res.partner", fields: "name, email " },
        OPEN_POLICY
      )
    );

    expect(lastCall("searchRead")!.args[2]).toEqual(["name", "email"]);
    expect(payload.notice).toBeUndefined();
  });

  it("pide un registro de más para deducir has_more sin contar", async () => {
    const { client, lastCall, callsTo } = fakeClient({
      searchRead: async () => rows(81),
    });

    const payload = payloadOf(
      await handleSearchRecords(client, { model: "res.partner" }, OPEN_POLICY)
    );

    expect(lastCall("searchRead")!.args[3]).toBe(81);
    expect(payload.has_more).toBe(true);
    expect(payload.count).toBe(80);
    expect(payload.records).toHaveLength(80);
    expect(callsTo("count")).toHaveLength(0);
  });

  it("has_more es falso cuando la página no se llena", async () => {
    const { client } = fakeClient({ searchRead: async () => rows(3) });

    const payload = payloadOf(
      await handleSearchRecords(client, { model: "res.partner" }, OPEN_POLICY)
    );

    expect(payload.has_more).toBe(false);
    expect(payload.count).toBe(3);
  });

  it("con include_total añade el conteo exacto", async () => {
    const { client, callsTo } = fakeClient({
      searchRead: async () => rows(10),
      count: async () => 250,
    });

    const payload = payloadOf(
      await handleSearchRecords(
        client,
        { model: "res.partner", limit: 10, include_total: true },
        OPEN_POLICY
      )
    );

    expect(payload.total_count).toBe(250);
    expect(payload.has_more).toBe(true);
    expect(callsTo("count")).toHaveLength(1);
  });

  it("calcula has_more a partir del offset cuando cuenta el total", async () => {
    const { client } = fakeClient({
      searchRead: async () => rows(10),
      count: async () => 20,
    });

    const payload = payloadOf(
      await handleSearchRecords(
        client,
        { model: "res.partner", limit: 10, offset: 10, include_total: true },
        OPEN_POLICY
      )
    );

    expect(payload.has_more).toBe(false);
  });

  it("rechaza un domain que no es JSON", async () => {
    const { client, calls } = fakeClient();

    const result = await handleSearchRecords(
      client,
      { model: "res.partner", domain: "no soy json" },
      OPEN_POLICY
    );

    expect(result.isError).toBe(true);
    expect(payloadOf(result).error).toMatch(/Could not parse 'domain'/);
    expect(calls).toHaveLength(0);
  });

  it("pasa el domain, el orden y el offset a Odoo", async () => {
    const { client, lastCall } = fakeClient({ searchRead: async () => rows(1) });

    await handleSearchRecords(
      client,
      {
        model: "sale.order",
        domain: '[["state","=","sale"]]',
        order: "date_order desc",
        offset: 40,
        limit: 20,
      },
      OPEN_POLICY
    );

    const [model, domain, , limit, offset, order] = lastCall("searchRead")!.args;
    expect(model).toBe("sale.order");
    expect(domain).toEqual([["state", "=", "sale"]]);
    expect(limit).toBe(21);
    expect(offset).toBe(40);
    expect(order).toBe("date_order desc");
  });
});
