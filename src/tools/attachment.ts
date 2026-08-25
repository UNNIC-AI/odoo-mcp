import { z } from "zod";
import type { OdooClient } from "../odoo-client.js";
import type { OdooDomain } from "../types.js";
import type { ToolDefinition, ToolResult } from "./types.js";
import { isModelAllowed, OPEN_POLICY, type AccessPolicy } from "../access.js";

export const listAttachmentsTool: ToolDefinition = {
  name: "list_attachments",
  description:
    "List file attachments on a specific Odoo record or search all attachments.",
  inputSchema: {
    model: z
      .string()
      .optional()
      .describe(
        "Odoo model name to filter by (e.g., 'sale.order'). If omitted, searches all attachments"
      ),
    res_id: z
      .number()
      .optional()
      .describe("Record ID to filter by. Used together with model"),
    domain: z
      .string()
      .optional()
      .describe(
        'Additional domain filter as JSON array. Default: []'
      ),
    limit: z
      .number()
      .optional()
      .describe("Maximum number of attachments to return. Default: 20, max: 200"),
  },
};

export async function handleListAttachments(
  client: OdooClient,
  args: Record<string, unknown>,
  policy: AccessPolicy = OPEN_POLICY
): Promise<ToolResult> {
  // Un `model` en blanco equivale a no haberlo pasado; si no lo normalizamos
  // aquí serviría para esquivar la comprobación de la lista blanca.
  const model = (args.model as string | undefined)?.trim() || undefined;
  const resId = args.res_id as number | undefined;
  const rawLimit = (args.limit as number) ?? 20;
  const limit = Math.min(Math.max(1, rawLimit), 200);

  // Sin `model` la búsqueda abarcaría adjuntos de cualquier modelo, lo que
  // saltaría la lista blanca. Con lista blanca activa, `model` es obligatorio.
  if (policy.allowedModels && !model) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              error:
                "'model' is required: this server restricts which models can be accessed, so attachments cannot be listed across all models.",
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }

  let extraDomain: OdooDomain = [];
  if (args.domain) {
    try {
      const parsed = JSON.parse(args.domain as string);
      if (!Array.isArray(parsed)) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: "'domain' must be a JSON array." }, null, 2) }],
          isError: true,
        };
      }
      extraDomain = parsed as OdooDomain;
    } catch {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: "Could not parse 'domain'. It must be a valid JSON array." }, null, 2) }],
        isError: true,
      };
    }
  }

  const domain: OdooDomain = [...extraDomain];
  if (model) domain.push(["res_model", "=", model]);
  if (resId !== undefined) domain.push(["res_id", "=", resId]);

  const attachments = await client.searchRead(
    "ir.attachment",
    domain,
    [
      "name",
      "mimetype",
      "file_size",
      "res_model",
      "res_id",
      "create_date",
      "type",
      "url",
    ],
    limit,
    undefined,
    "create_date desc"
  );

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          { count: attachments.length, attachments },
          null,
          2
        ),
      },
    ],
  };
}

export const uploadAttachmentTool: ToolDefinition = {
  name: "upload_attachment",
  description:
    "Upload a file attachment to an Odoo record. File content must be base64-encoded.",
  inputSchema: {
    name: z.string().describe("File name (e.g., 'report.pdf')"),
    model: z
      .string()
      .describe("Odoo model to attach to (e.g., 'res.partner')"),
    res_id: z.number().describe("Record ID to attach the file to"),
    data: z.string().describe("Base64-encoded file content"),
    mimetype: z
      .string()
      .optional()
      .describe(
        "MIME type (e.g., 'application/pdf', 'image/png'). Auto-detected if not provided"
      ),
    description: z.string().optional().describe("Optional file description"),
  },
};

// Solo caracteres base64 (tras quitar espacios); como mucho 2 de relleno.
const BASE64_REGEX = /^[A-Za-z0-9+/]*={0,2}$/;

// Tamaño máximo de subida: 25 MB (~33,8 MB ya codificados en base64).
const MAX_UPLOAD_SIZE_MB = 25;
const MAX_UPLOAD_BASE64_CHARS = Math.ceil(MAX_UPLOAD_SIZE_MB * 1024 * 1024 * (4 / 3));

// Validación del nombre: bloquea path traversal y caracteres peligrosos.
const UNSAFE_FILENAME_REGEX = /[/\\:*?"<>|]/;

export async function handleUploadAttachment(
  client: OdooClient,
  args: Record<string, unknown>,
  _policy?: AccessPolicy
): Promise<ToolResult> {
  const name = args.name as string;
  const data = args.data as string;

  // Validación del nombre de fichero.
  if (!name || name.trim() === "") {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: "The file name is empty." }, null, 2) }],
      isError: true,
    };
  }
  if (UNSAFE_FILENAME_REGEX.test(name) || name.includes("..")) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: "The file name contains characters that are not allowed: / \\ .. : * ? \" < > |" }, null, 2) }],
      isError: true,
    };
  }

  // Normalizamos el base64 quitando espacios en blanco.
  const cleanData = data.replace(/\s/g, "");

  // Límite de tamaño.
  if (cleanData.length > MAX_UPLOAD_BASE64_CHARS) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: `File is too large. The maximum upload size is ${MAX_UPLOAD_SIZE_MB} MB.` }, null, 2) }],
      isError: true,
    };
  }

  // Validez del base64.
  if (!BASE64_REGEX.test(cleanData)) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: "'data' is not valid base64." }, null, 2) }],
      isError: true,
    };
  }

  const values: Record<string, unknown> = {
    name: name.trim(),
    res_model: args.model,
    res_id: args.res_id,
    datas: cleanData,
    type: "binary",
  };

  if (args.mimetype) values.mimetype = args.mimetype;
  if (args.description) values.description = args.description;

  const id = await client.create("ir.attachment", values);

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          { success: true, attachment_id: id, name: name.trim() },
          null,
          2
        ),
      },
    ],
  };
}

export const downloadAttachmentTool: ToolDefinition = {
  name: "download_attachment",
  description:
    "Download/read an attachment by ID. Returns the base64-encoded file content.",
  inputSchema: {
    id: z.number().describe("Attachment ID to download"),
  },
};

const MAX_DOWNLOAD_SIZE_MB = 25;
const MAX_DOWNLOAD_SIZE_BYTES = MAX_DOWNLOAD_SIZE_MB * 1024 * 1024;

export async function handleDownloadAttachment(
  client: OdooClient,
  args: Record<string, unknown>,
  policy: AccessPolicy = OPEN_POLICY
): Promise<ToolResult> {
  const id = args.id as number;

  // Primero solo los metadatos: nos dan el tamaño y el modelo al que pertenece
  // el adjunto, que es lo que la lista blanca necesita comprobar.
  const metaRecords = (await client.read("ir.attachment", [id], [
    "name",
    "mimetype",
    "file_size",
    "res_model",
  ])) as Record<string, unknown>[];

  if (!metaRecords || metaRecords.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: `No attachment found with ID ${id}.` }, null, 2),
        },
      ],
      isError: true,
    };
  }

  const meta = metaRecords[0];
  const fileSize = meta.file_size as number;

  const resModel = meta.res_model;
  if (typeof resModel === "string" && !isModelAllowed(policy, resModel)) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              error: `Attachment ${id} belongs to model '${resModel}', which is not allowed by this server's configuration.`,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }

  if (fileSize > MAX_DOWNLOAD_SIZE_BYTES) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              error: `Attachment is too large (${(fileSize / 1024 / 1024).toFixed(1)} MB). The maximum download size is ${MAX_DOWNLOAD_SIZE_MB} MB.`,
              id,
              name: meta.name,
              mimetype: meta.mimetype,
              file_size: fileSize,
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }

  // Confirmado el tamaño, ya pedimos el contenido.
  const records = (await client.read("ir.attachment", [id], [
    "name",
    "mimetype",
    "file_size",
    "datas",
  ])) as Record<string, unknown>[];

  if (!records || records.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: `No attachment found with ID ${id}.` }, null, 2),
        },
      ],
      isError: true,
    };
  }

  const attachment = records[0];
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            id,
            name: attachment.name,
            mimetype: attachment.mimetype,
            file_size: attachment.file_size,
            data: attachment.datas,
          },
          null,
          2
        ),
      },
    ],
  };
}
