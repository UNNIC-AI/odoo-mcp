import { describe, expect, it } from "vitest";
import {
  handleListAttachments,
  handleUploadAttachment,
  handleDownloadAttachment,
} from "../../../src/tools/attachment.js";
import { OPEN_POLICY, type AccessPolicy } from "../../../src/access.js";
import { attachmentsOf, fakeClient, payloadOf } from "../../helpers/fake-client.js";

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
    const { client, callsTo } = fakeClient({ searchRead: async () => [] });
    const result = await handleListAttachments(client, {}, OPEN_POLICY);
    expect(result.isError).toBeUndefined();
    expect(callsTo("searchRead")).toHaveLength(1);
    expect(callsTo("searchRead")[0].args[1]).toEqual([]);
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

  const twoStageRead = (extra: Record<string, unknown> = {}) => {
    let call = 0;
    return async () => {
      call += 1;
      const base = meta(extra);
      return call === 1 ? [base] : [{ ...base, datas: "SGVsbG8=" }];
    };
  };

  // Un binario ya no se vuelca como base64 dentro del JSON: va como recurso
  // incrustado, que es lo que el cliente MCP sabe manejar sin gastar contexto.
  it("devuelve un binario como recurso incrustado, no como base64 en el texto", async () => {
    const { client } = fakeClient({ read: twoStageRead() });

    const result = await handleDownloadAttachment(client, { id: 1 }, OPEN_POLICY);
    const payload = payloadOf(result);
    const [blocks] = attachmentsOf(result);

    expect(payload.name).toBe("informe.pdf");
    expect(payload.data).toBeUndefined();
    expect(blocks).toEqual({
      type: "resource",
      resource: {
        uri: "odoo://ir.attachment/1/informe.pdf",
        mimeType: "application/pdf",
        blob: "SGVsbG8=",
      },
    });
  });

  it("una imagen se devuelve como bloque de imagen", async () => {
    const { client } = fakeClient({
      read: twoStageRead({ name: "logo.png", mimetype: "image/png" }),
    });

    const result = await handleDownloadAttachment(client, { id: 1 }, OPEN_POLICY);

    expect(attachmentsOf(result)[0]).toEqual({
      type: "image",
      data: "SGVsbG8=",
      mimeType: "image/png",
    });
  });

  it("un fichero de texto se devuelve legible, no en base64", async () => {
    const { client } = fakeClient({
      read: twoStageRead({ name: "datos.csv", mimetype: "text/csv" }),
    });

    const result = await handleDownloadAttachment(client, { id: 1 }, OPEN_POLICY);
    const [block] = attachmentsOf(result);

    expect(block).toMatchObject({
      type: "resource",
      resource: { mimeType: "text/csv", text: "Hello" },
    });
  });

  it("un texto enorme no se decodifica al contexto", async () => {
    const { client } = fakeClient({
      read: twoStageRead({
        name: "enorme.csv",
        mimetype: "text/csv",
        file_size: 512 * 1024,
      }),
    });

    const result = await handleDownloadAttachment(client, { id: 1 }, OPEN_POLICY);
    const [block] = attachmentsOf(result);

    expect(block).toMatchObject({ type: "resource", resource: { blob: "SGVsbG8=" } });
  });

  it("sin mimetype cae en un binario genérico", async () => {
    const { client } = fakeClient({
      read: twoStageRead({ mimetype: false, name: "sin-tipo" }),
    });

    const result = await handleDownloadAttachment(client, { id: 1 }, OPEN_POLICY);

    expect(attachmentsOf(result)[0]).toMatchObject({
      resource: { mimeType: "application/octet-stream" },
    });
  });

  it("escapa el nombre en el URI del recurso", async () => {
    const { client } = fakeClient({
      read: twoStageRead({ name: "informe final (v2).pdf" }),
    });

    const result = await handleDownloadAttachment(client, { id: 9 }, OPEN_POLICY);
    const block = attachmentsOf(result)[0] as { resource: { uri: string } };

    expect(block.resource.uri).toBe(
      "odoo://ir.attachment/9/informe%20final%20(v2).pdf"
    );
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
    const { client } = fakeClient({ read: twoStageRead() });

    const result = await handleDownloadAttachment(client, { id: 1 }, RESTRICTED);

    expect(result.isError).toBeUndefined();
  });
});
