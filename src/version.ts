/**
 * La versión sale de package.json en tiempo de compilación: tsup y vitest la
 * inyectan con `define`. Así no hay dos sitios que puedan discrepar, que es lo
 * que pasaba cuando index.ts la llevaba escrita a mano.
 */
declare const __PACKAGE_VERSION__: string;

export const VERSION: string =
  typeof __PACKAGE_VERSION__ === "string" ? __PACKAGE_VERSION__ : "0.0.0-dev";
