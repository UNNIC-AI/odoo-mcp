# odoo-mcp

Servidor MCP (Model Context Protocol) para Odoo. Conecta cualquier asistente de
IA a tu instancia de Odoo por XML-RPC estándar — sin instalar ningún módulo.

Cada persona lo ejecuta en su propio cliente de IA con sus propias credenciales.
No es un servicio compartido: ver [Modelo de uso](#modelo-de-uso).

## Puesta en marcha

### 1. Consigue tu API key de Odoo

**Ajustes → Usuarios y compañías → Usuarios → tu usuario → Seguridad de la
cuenta → Nueva clave de API**.

### 2. Configura tu cliente MCP

```json
{
  "mcpServers": {
    "odoo": {
      "command": "npx",
      "args": ["-y", "odoo-mcp"],
      "env": {
        "ODOO_URL": "https://mi-odoo.com",
        "ODOO_DB": "mi-base-de-datos",
        "ODOO_USER": "yo@empresa.com",
        "ODOO_API_KEY": "mi-api-key"
      }
    }
  }
}
```

> **`ODOO_USER` es obligatorio también con API key.** Odoo autentica con
> usuario + credencial: la API key ocupa el sitio de la contraseña, no el del
> usuario. Sin `ODOO_USER` el servidor no arranca y te lo dice al iniciarse.

Si trabajas desde el repositorio en vez de desde npm, cambia `command` y `args`
por la ruta local o por Nix:

```json
"command": "node",  "args": ["/ruta/al/repo/dist/index.js"]
"command": "nix",   "args": ["run", "/ruta/al/repo", "--"]
```

### 3. Pregunta

> «Enséñame los pedidos de venta abiertos»
> «Crea un contacto llamado Ana Pérez con email ana@ejemplo.com»
> «¿Cuántas facturas se han creado este mes?»

## Variables de entorno

| Variable | Obligatoria | Descripción |
|----------|-------------|-------------|
| `ODOO_URL` | Sí | URL de la instancia, p. ej. `https://mi-odoo.com` |
| `ODOO_DB` | Sí | Nombre de la base de datos |
| `ODOO_USER` | Sí | Login del usuario, normalmente su email |
| `ODOO_API_KEY` | Sí\* | Clave de API (recomendado) |
| `ODOO_PASSWORD` | Sí\* | Contraseña, alternativa a la clave de API |
| `ODOO_TIMEOUT` | No | Segundos de espera por llamada XML-RPC. Por defecto 30 |
| `ODOO_READONLY` | No | `true` desactiva todas las herramientas de escritura. Por defecto `false` |
| `ODOO_ALLOWED_MODELS` | No | Lista blanca de modelos separada por comas. Sin definir, todos |

\* Hace falta `ODOO_API_KEY` o `ODOO_PASSWORD`. Si defines las dos, gana la
clave de API.

### Limitar lo que el modelo puede tocar

`ODOO_READONLY=true` hace que las seis herramientas de escritura ni siquiera se
registren: el modelo no las ve, así que no las intenta.

`ODOO_ALLOWED_MODELS` acepta nombres exactos y comodines de prefijo:

```bash
ODOO_ALLOWED_MODELS="sale.*,res.partner,account.move"
```

Con la lista activa, cualquier herramienta que reciba un modelo fuera de ella
falla antes de llamar a Odoo, `list_models` solo anuncia los permitidos, y
`download_attachment` comprueba a qué modelo pertenece el adjunto antes de
devolverlo. `whoami` y `list_models` siguen disponibles siempre.

Las dos opciones son una segunda barrera, no la principal: **el límite real son
los permisos del usuario de Odoo cuyas credenciales uses**. Si no quieres que el
asistente vea las nóminas, el sitio para arreglarlo es Odoo.

## Herramientas

Las 18 herramientas, y si escriben en Odoo:

| Herramienta | Escribe | Descripción |
|-------------|:-------:|-------------|
| `search_records` | | Busca con dominio, selección de campos, paginación y orden |
| `read_record` | | Lee registros concretos por ID |
| `count_records` | | Cuenta los registros que cumplen un dominio |
| `search_grouped` | | Agrega con `read_group` (sumas, medias, conteos) |
| `name_search` | | Busca por nombre al estilo autocompletado; devuelve id + nombre |
| `list_models` | | Lista los modelos disponibles |
| `get_fields` | | Definiciones de campo de un modelo |
| `whoami` | | Usuario, compañía, versión de servidor y base de datos |
| `get_messages` | | Mensajes y trazabilidad del chatter de un registro |
| `list_attachments` | | Adjuntos de un registro |
| `download_attachment` | | Descarga un adjunto (base64, máx. 25 MB) |
| `search_calendar` | | Eventos de calendario; por defecto solo los tuyos |
| `create_record` | Sí | Crea uno o varios registros (hasta 100 por llamada) |
| `update_record` | Sí | Modifica registros existentes |
| `delete_record` | Sí | Borra registros. Permanente |
| `execute_method` | Sí | Ejecuta métodos de negocio (`action_confirm`, `action_post`…) |
| `post_message` | Sí | Publica un mensaje o nota interna en el chatter |
| `upload_attachment` | Sí | Sube un fichero a un registro (base64, máx. 25 MB) |

`execute_method` bloquea `create`, `write`, `unlink`, `copy`, `name_create` y
`web_save` para que esas operaciones pasen por las herramientas dedicadas, que
validan la entrada y quedan marcadas como escritura.

### Ejemplos

**Buscar:**
```
model:  "res.partner"
domain: '[["is_company","=",true]]'
fields: "name,email,phone"
limit:  10
```

**Crear en lote:**
```
model:  "res.partner"
values: '[{"name":"Ana"},{"name":"Luis"}]'
```

**Agregar:**
```
model:   "sale.order"
domain:  '[["state","=","sale"]]'
fields:  "amount_total:sum"
groupby: "partner_id"
```

## Modelo de uso

Un proceso, un usuario, transporte stdio. Cada persona ejecuta su propia copia
con sus credenciales, y actúa en Odoo como ella misma: las reglas de registro,
los permisos y la pista de auditoría de Odoo funcionan como se espera.

No hay transporte HTTP ni multiusuario a propósito. Un servidor compartido
obligaría a una cuenta de servicio común, y entonces todo el mundo tendría los
permisos de esa cuenta y el registro de auditoría diría siempre lo mismo.

## Desarrollo

```bash
npm install
npm run build      # tsup → dist/
npm test           # pruebas unitarias
npm run typecheck  # tsc sobre src/ y test/
```

Con Nix:

```bash
nix build          # ./result/bin/odoo-mcp
nix run
nix develop        # entorno con node y npm
```

Al cambiar dependencias hay que actualizar `npmDepsHash` en `flake.nix`:

```bash
nix run nixpkgs#prefetch-npm-deps -- package-lock.json
```

### Pruebas

Las unitarias no necesitan red ni Odoo: usan un doble de `OdooClient`. Las de
integración hablan con un Odoo real y se ejecutan aparte — ver
[`test/integration/README.md`](test/integration/README.md).

### Añadir una herramienta

1. Crea `src/tools/mi-herramienta.ts` con la definición y el handler:

   ```ts
   export const miHerramientaTool: ToolDefinition = {
     name: "mi_herramienta",
     description: "...",   // en inglés: lo lee el modelo
     inputSchema: { model: z.string().describe("...") },
   };

   export async function handleMiHerramienta(
     client: OdooClient,
     args: Record<string, unknown>,
     _policy?: AccessPolicy
   ): Promise<ToolResult> { ... }
   ```

2. Añade una entrada a `TOOLS` en `src/server.ts`, marcando `write: true` si
   modifica datos y `fixedModel` si siempre opera sobre un modelo concreto.
3. Escribe la prueba en `test/unit/tools/`.

Si el handler recibe un argumento llamado `model`, la lista blanca se aplica
sola: la comprobación vive en `wrapHandler`.

### Convenio de idiomas

- **Español**: comentarios, mensajes de arranque en stderr y documentación.
  Los lee el equipo.
- **Inglés**: nombres y descripciones de herramientas, y todo el contenido de
  los `ToolResult`, incluidos los errores. Los lee el modelo.

## Licencia

MIT
