# CLAUDE.md

Servidor MCP para Odoo por XML-RPC. Un proceso, un usuario, transporte stdio:
los permisos efectivos son los del usuario de Odoo configurado, así que aquí no
hay ninguna capa de autorización que mantener. El README explica el porqué en
[Modelo de uso](README.md#modelo-de-uso).

## Entorno

`node` y `npm` **no están en el PATH** fuera del devShell. Todo comando de
desarrollo va prefijado:

```bash
nix develop --command npm ci          # la primera vez
nix develop --command npm test        # unitarias (vitest run test/unit)
nix develop --command npm run typecheck
nix develop --command npm run build   # tsup → dist/
```

## Antes de subir cambios

No hay CI: el workflow se eliminó en 84db7b9. La puerta es `nix build`, que
ejecuta `npm run typecheck` y `npm test` dentro del sandbox (`checkPhase` en
`flake.nix`). Ejecútalo antes de empujar.

Las pruebas de integración (`npm run test:integration`) hablan con un Odoo real
y se saltan solas si faltan las variables de entorno — ver
`test/integration/README.md`. Son la única forma de validar la compatibilidad
entre versiones de Odoo; las unitarias usan un doble de `OdooClient`.

## Convenio de idiomas

- **Español**: comentarios, documentación y mensajes de stderr. Los lee el equipo.
- **Inglés**: nombres y descripciones de herramientas, y todo el contenido de
  los `ToolResult`, errores incluidos. Los lee el modelo.

## Mapa

| Fichero | Qué hace |
|---------|----------|
| `src/config.ts` | Entorno → `Config` validada. Errores en español, accionables |
| `src/access.ts` | `AccessPolicy`: modo solo lectura y lista blanca de modelos |
| `src/server.ts` | Registro `TOOLS` y `wrapHandler` (lista blanca + errores) |
| `src/odoo-client.ts` | XML-RPC, autenticación, cachés y compatibilidad de versiones |
| `src/datetime.ts` | Localiza los datetime que salen; los que entran en un `domain` siguen en UTC |
| `src/tools/*.ts` | Una herramienta por fichero: definición + handler |

## Añadir una herramienta

1. `src/tools/mi-herramienta.ts` con `ToolDefinition` + handler.
2. Entrada en `TOOLS` (`src/server.ts`), con `write: true` si modifica datos y
   `fixedModel` si opera siempre sobre un modelo concreto.
3. Prueba en `test/unit/tools/`.

Si el handler recibe un argumento `model`, la lista blanca se aplica sola desde
`wrapHandler`; no la repliques en el handler.

## Detalles que se rompen si los ignoras

- **La versión** se inyecta desde `package.json` en tiempo de compilación
  (`define` de tsup y vitest) y se expone en `src/version.ts`. No la escribas a
  mano en ningún otro sitio; hay una prueba que comprueba que coinciden.
- **Compatibilidad con Odoo**: nada de fijar versión. El código pregunta al
  servidor (`fields_get`, `server_version_info`) y elige — `read_group` hasta la
  18, `formatted_read_group` desde la 19, `groups_id` → `group_ids`, etc.
- **Al cambiar dependencias** hay que actualizar `npmDepsHash` en `flake.nix`:
  `nix run nixpkgs#prefetch-npm-deps -- package-lock.json`.
