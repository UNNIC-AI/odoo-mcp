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
      "args": ["-y", "git+ssh://git@github.com/unnic-ai/odoo-mcp.git"],
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

> **No hace falta publicar en npm.** `npx` acepta una URL de git: clona el
> repositorio, ejecuta el script `prepare` (que compila `dist/`) y lanza el
> binario. Solo necesitas acceso de lectura al repositorio. Para fijar una
> versión concreta, añade la referencia: `...odoo-mcp.git#v0.1.0`.

Si prefieres no depender de la red en cada arranque, apunta al repositorio
local o a Nix:

```json
"command": "node",  "args": ["/ruta/al/repo/dist/index.js"]
"command": "nix",   "args": ["run", "/ruta/al/repo", "--"]
"command": "nix",   "args": ["run", "git+ssh://git@github.com/unnic-ai/odoo-mcp.git", "--"]
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
| `ODOO_TIMEZONE` | No | Zona IANA para mostrar las fechas. Sin definir, la del usuario en Odoo |

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

### Fechas y zonas horarias

Odoo guarda los datetime en UTC y los devuelve sin zona (`2026-08-25 08:31:55`).
Tal cual, el modelo no puede saber que están desfasados respecto a la hora que
ve el usuario. El servidor los convierte a la zona del usuario y los emite con
desfase explícito:

```
"date_order": "2026-08-25T10:31:55+02:00"
```

Los campos de tipo `date` no llevan hora ni zona y se dejan intactos.

> **Al filtrar, los datetime van en UTC.** Odoo interpreta en UTC los valores
> que entran en un `domain`, aunque los que salen se muestren en tu zona. Las
> descripciones de las herramientas ya se lo advierten al modelo.

`ODOO_TIMEZONE` fuerza una zona concreta; sin ella se usa la del usuario en
Odoo, y UTC si no tiene ninguna.

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
| `get_messages` | | Mensajes del chatter y cambios de campo con su valor anterior y nuevo |
| `list_attachments` | | Adjuntos de un registro |
| `download_attachment` | | Descarga un adjunto: texto legible, imagen o recurso binario |
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

Tres detalles del formato de salida que conviene conocer:

- **`download_attachment`** no devuelve base64 dentro del JSON. Un CSV o un
  JSON llegan como texto legible; una imagen, como bloque de imagen; el resto,
  como recurso binario incrustado que maneja el cliente MCP sin gastar
  contexto. Límite de 25 MB, y 256 KB para lo que se decodifica a texto.
- **`get_messages`** resuelve `tracking_value_ids` en cambios legibles
  (`{ field, old_value, new_value }`) en vez de devolver ids sueltos, con una
  sola lectura para todos los mensajes de la página.
- **`search_grouped`** normaliza el número de registros de cada grupo a
  `__count`, independientemente del campo por el que se agrupe y de si Odoo usó
  `read_group` (hasta la 18) o `formatted_read_group` (19 en adelante). La
  respuesta indica en `odoo_method` cuál se ha usado.

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

### Compatibilidad entre versiones de Odoo

Odoo renombra campos y métodos entre versiones. En vez de fijar una versión, el
código pregunta al servidor qué tiene delante:

| Qué cambia | Cómo se resuelve |
|------------|------------------|
| `res.users.groups_id` → `group_ids` | `whoami` mira `fields_get` y usa el que exista |
| `mail.tracking.value`: `field`/`field_desc` → `field_id` | Igual: se piden solo las columnas presentes |
| `read_group` → `formatted_read_group` (Odoo 19) | Se elige por versión de servidor, con vuelta atrás si falla |

La versión se lee una vez y se cachea, igual que los `fields_get`. Si actualizáis
Odoo, `npm run test:integration` contra la instancia nueva es la forma rápida de
comprobar que nada de esto se ha roto.

### La versión del paquete

Sale de `package.json` en tiempo de compilación: `tsup` y `vitest` la inyectan
con `define` y `src/version.ts` la expone. No hay que tocarla en ningún otro
sitio, y una prueba comprueba que coinciden.

### Convenio de idiomas

- **Español**: comentarios, mensajes de arranque en stderr y documentación.
  Los lee el equipo.
- **Inglés**: nombres y descripciones de herramientas, y todo el contenido de
  los `ToolResult`, incluidos los errores. Los lee el modelo.

## Licencia

MIT
