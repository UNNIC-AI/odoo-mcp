import type { OdooClient } from "../odoo-client.js";
import type { ToolDefinition, ToolResult } from "./types.js";
import type { AccessPolicy } from "../access.js";

export const whoamiTool: ToolDefinition = {
  name: "whoami",
  description:
    "Show current connection info: authenticated user, uid, partner, company, server version, and database name.",
  inputSchema: {},
};

/**
 * El campo de grupos de res.users cambió de nombre entre versiones de Odoo
 * (`groups_id` en las clásicas, `group_ids` en las recientes). Pedir el que no
 * existe hace fallar toda la llamada, así que preguntamos primero.
 */
async function resolveGroupsField(client: OdooClient): Promise<string | null> {
  const fields = (await client.getFields("res.users", ["type"])) as Record<
    string,
    unknown
  >;
  for (const candidate of ["group_ids", "groups_id"]) {
    if (candidate in fields) return candidate;
  }
  return null;
}

export async function handleWhoami(
  client: OdooClient,
  _args: Record<string, unknown>,
  _policy?: AccessPolicy
): Promise<ToolResult> {
  // Versión del servidor.
  const version = await client.getVersion();

  const groupsField = await resolveGroupsField(client);

  // Datos del usuario autenticado.
  const uid = client.getUid();
  const users = (await client.searchRead(
    "res.users",
    [["id", "=", uid]],
    [
      "name",
      "login",
      "email",
      "partner_id",
      "company_id",
      "company_ids",
      ...(groupsField ? [groupsField] : []),
      "lang",
      "tz",
    ],
    1
  )) as Array<Record<string, unknown>>;

  if (!users || users.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: "Could not read current user info" }, null, 2),
        },
      ],
      isError: true,
    };
  }

  const user = users[0] as Record<string, unknown>;

  // Grupos de permisos: solo los de nivel aplicación/rol, que son los que
  // llevan " / " en full_name. Los técnicos internos se descartan.
  const groupIds = groupsField ? ((user[groupsField] as number[]) ?? []) : [];
  let groups: string[] = [];
  if (groupIds.length > 0) {
    const groupRecords = (await client.searchRead(
      "res.groups",
      [["id", "in", groupIds]],
      ["full_name"],
      200
    )) as Array<Record<string, unknown>>;
    groups = groupRecords
      .map((g) => g.full_name as string)
      .filter((name) => name.includes(" / "))
      .sort();
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            uid,
            name: user.name,
            login: user.login,
            email: user.email,
            partner_id: user.partner_id,
            company_id: user.company_id,
            company_ids: user.company_ids,
            lang: user.lang,
            tz: user.tz,
            groups: groups,
            url: client.getUrl(),
            server: {
              version: version.server_version,
              version_info: version.server_version_info,
              protocol_version: version.protocol_version,
            },
            database: client.getDatabase(),
          },
          null,
          2
        ),
      },
    ],
  };
}
