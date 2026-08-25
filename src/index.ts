import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { OdooClient, AuthenticationError } from "./odoo-client.js";
import { ConfigError, describeConfig, loadConfig } from "./config.js";
import { policyFromConfig } from "./access.js";
import { createServer } from "./server.js";

const VERSION = "0.1.0";

/**
 * Este servidor es de un solo usuario: cada persona lo ejecuta en su propio
 * cliente de IA con sus propias credenciales de Odoo, mediante stdio. Los
 * permisos efectivos son los del usuario de Odoo configurado, así que no hay
 * ninguna capa de autorización adicional que mantener aquí.
 */
async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`Error de configuración: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  console.error(describeConfig(config));

  const odoo = new OdooClient(config);

  try {
    await odoo.connect();
  } catch (err) {
    if (err instanceof AuthenticationError) {
      console.error(`Error de autenticación: ${err.message}`);
    } else {
      console.error(
        `No se pudo conectar con Odoo en ${config.url}: ${(err as Error).message}`
      );
    }
    process.exit(1);
  }

  const server = createServer(odoo, policyFromConfig(config), VERSION);
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("Error irrecuperable:", err);
  process.exit(1);
});
