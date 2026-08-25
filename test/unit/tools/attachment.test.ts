import { describe, expect, it } from "vitest";
import {
  handleListAttachments,
  handleUploadAttachment,
  handleDownloadAttachment,
} from "../../../src/tools/attachment.js";
import { OPEN_POLICY, type AccessPolicy } from "../../../src/access.js";
import { fakeClient, payloadOf } from "../../helpers/fake-client.js";

const RESTRICTED: AccessPolicy = { readonly: false, allowedModels: ["sale.*"] };

describe("list_attachments", () => {
  it("filtra por modelo y registro", async () => {
    const { client, lastCall } = fakeClient({ searchRead: async () => [] });

    await handleListAttachments(
      client,
      { model: "sale.order", res_id: 3 },
      OPEN_POLICY
    );

    expect(lastCall("searchRead")!.args[1]).toEqual([
      ["res_model", "=", "sale.order"],
      ["res_id", "=", 3],
    ]);
  });

  it("acota el límite a 200", async () => {
    const { client, lastCall } = fakeClient({ searchRead: async () => [] });
    await handleListAttachments(client, { limit: 5000 }, OPEN_POLICY);
    expect(lastCall("searchRead")!.args[3]).toBe(200);
  });

  it("eleva el límite a 1 como mínimo", async () => {
    const { client, lastCall } = fakeClient({ searchRead: async () => [] });
    await handleListAttachments(client, { limit: 0 }, OPEN_POLICY);
    expect(lastCall("searchRead")!.args[3]).toBe(1);
  });

  it("con lista blanca exige model para no barrer todos los modelos", async () => {
    const { client, calls } = fakeClient();

    const result = await handleListAttachments(client, {}, RESTRICTED);

    expect(result.isError).toBe(true);
    expect(payloadOf(result).error).toMatch(/'model' is required/);
    expect(calls).toHaveLength(0);
  });

  it("sin lista blanca permite buscar en todos los modelos", async () => {
    const { client, calls } = fakeClient({ searchRead: async () => [] });
    const result = await handleListAttachments(client, {}, OPEN_POLICY);
    expect(result.isError).toBeUndefined();
    expect(calls).toHaveLength(1);
  });
});

describe("upload_attachment", () => {
  const valid = {
    model: "sale.order",
    res_id: 1,
    name: "informe.pdf",
    data: "SGVsbG8=",
  };

  it("crea el ir.attachment con el contenido normalizado", async () => {
    const { client, lastCall } = fakeClient({ create: async () => 99 });

    const payload = payloadOf(
      await handleUploadAttachment(
        client,
        { ...valid, data: "SGVs bG8=\n", mimetype: "application/pdf" },
        OPEN_POLICY
      )
    );

    expect(payload).toEqual({ success: true, attachment_id: 99, name: "informe.pdf" });
    const [model, values] = lastCall("create")!.args as [string, any];
    expect(model).toBe("ir.attachment");
    expect(values.datas).toBe("SGVsbG8=");
    expect(values.res_model).toBe("sale.order");
    expect(values.mimetype).toBe("application/pdf");
  });

  it("rechaza un nombre vacío", async () => {
    const { client } = fakeClient();
    const result = await handleUploadAttachment(
      client,
      { ...valid, name: "   " },
      OPEN_POLICY
    );
    expect(payloadOf(result).error).toMatch(/file name is empty/);
  });

  it.each(["../etc/passwd", "a/b.pdf", "a\\b.pdf", "x:y.pdf", "q?.pdf", 'a"b.pdf'])(
    "rechaza el nombre peligroso %s",
    async (name) => {
      const { client, calls } = fakeClient();
      const result = await handleUploadAttachment(client, { ...valid, name }, OPEN_POLICY);
      expect(result.isError).toBe(true);
      expect(calls).toHaveLength(0);
    }
  );

  it("rechaza base64 inválido", async () => {
    const { client } = fakeClient();
    const result = await handleUploadAttachment(
      client,
      { ...valid, data: "no-es-base64!!" },
      OPEN_POLICY
    );
    expect(payloadOf(result).error).toMatch(/not valid base64/);
  });

  it("rechaza ficheros de más de 25 MB", async () => {
    const { client, calls } = fakeClient();
    const data = "A".repeat(Math.ceil(25 * 1024 * 1024 * (4 / 3)) + 4);

    const result = await handleUploadAttachment(client, { ...valid, data }, OPEN_POLICY);

    expect(payloadOf(result).error).toMatch(/too large/);
    expect(calls).toHaveLength(0);
  });
});

describe("download_attachment", () => {
  const meta = (extra: Record<string, unknown> = {}) => ({
    name: "informe.pdf",
    mimetype: "application/pdf",
    file_size: 1024,
    res_model: "sale.order",
    ...extra,
  });

  it("devuelve el contenido en base64", async () => {
    let call = 0;
    const { client } = fakeClient({
      read: async () => {
        call += 1;
        return call === 1 ? [meta()] : [{ ...meta(), datas: "SGVsbG8=" }];
      },
    });

    const payload = payloadOf(await handleDownloadAttachment(client, { id: 1 }, OPEN_POLICY));

    expect(payload.data).toBe("SGVsbG8=");
    expect(payload.name).toBe("informe.pdf");
  });

  it("consulta primero solo los metadatos", async () => {
    const { client, callsTo } = fakeClient({
      read: async () => [{ ...meta(), file_size: 30 * 1024 * 1024 }],
    });

    await handleDownloadAttachment(client, { id: 1 }, OPEN_POLICY);

    // Un fichero demasiado grande se rechaza sin llegar a pedir `datas`.
    expect(callsTo("read")).toHaveLength(1);
    expect(callsTo("read")[0].args[2]).not.toContain("datas");
  });

  it("rechaza ficheros de más de 25 MB", async () => {
    const { client } = fakeClient({
      read: async () => [{ ...meta(), file_size: 30 * 1024 * 1024 }],
    });

    const result = await handleDownloadAttachment(client, { id: 1 }, OPEN_POLICY);

    expect(result.isError).toBe(true);
    expect(payloadOf(result).error).toMatch(/too large \(30\.0 MB\)/);
  });

  it("informa si el adjunto no existe", async () => {
    const { client } = fakeClient({ read: async () => [] });
    const result = await handleDownloadAttachment(client, { id: 404 }, OPEN_POLICY);
    expect(payloadOf(result).error).toMatch(/No attachment found with ID 404/);
  });

  // El id del adjunto no dice a qué modelo pertenece, así que la lista blanca
  // solo puede comprobarse después de leer los metadatos.
  it("bloquea un adjunto de un modelo no permitido", async () => {
    const { client, callsTo } = fakeClient({
      read: async () => [meta({ res_model: "hr.payslip" })],
    });

    const result = await handleDownloadAttachment(client, { id: 1 }, RESTRICTED);

    expect(result.isError).toBe(true);
    expect(payloadOf(result).error).toMatch(/'hr\.payslip'.*not allowed/);
    expect(callsTo("read")).toHaveLength(1);
  });

  it("permite un adjunto de un modelo sí permitido", async () => {
    let call = 0;
    const { client } = fakeClient({
      read: async () => {
        call += 1;
        return call === 1 ? [meta()] : [{ ...meta(), datas: "SGVsbG8=" }];
      },
    });

    const result = await handleDownloadAttachment(client, { id: 1 }, RESTRICTED);

    expect(result.isError).toBeUndefined();
  });
});
