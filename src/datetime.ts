/**
 * Conversión de fechas de Odoo a ISO 8601 con desfase horario.
 *
 * Odoo guarda los datetime en UTC y XML-RPC los devuelve como cadenas sin zona
 * ("2026-08-25 08:31:55"). Un modelo que lea eso junto a una hora local no
 * tiene forma de saber que van desfasadas. Aquí las pasamos a la zona del
 * usuario y las emitimos con desfase explícito ("2026-08-25T10:31:55+02:00"),
 * que ya es inequívoco.
 *
 * Los campos de tipo `date` no llevan hora ni zona: se dejan tal cual.
 */

const ODOO_DATETIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

const pad = (n: number) => String(n).padStart(2, "0");

/** Minutos de desfase de una zona en un instante dado (con horario de verano). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second")
  );

  return Math.round((asIfUtc - instant.getTime()) / 60000);
}

/** true si la zona horaria la reconoce el runtime. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * "2026-08-25 08:31:55" (UTC) → "2026-08-25T10:31:55+02:00" en Europe/Madrid.
 * Devuelve la entrada sin tocar si no encaja con el formato de Odoo.
 */
export function utcNaiveToIso(value: string, timeZone: string): string {
  const match = ODOO_DATETIME.exec(value);
  if (!match) return value;

  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);

  // Date.UTC acepta desbordamientos: el mes 13 pasaría a enero del año
  // siguiente sin avisar. Comprobamos los rangos antes de fiarnos.
  if (
    month < 1 || month > 12 ||
    day < 1 || day > 31 ||
    hour > 23 || minute > 59 || second > 59
  ) {
    return value;
  }

  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second);

  // Un 31 de febrero pasa los rangos pero no existe: si la fecha reconstruida
  // no coincide, devolvemos la entrada tal cual.
  const check = new Date(utcMs);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return value;
  }

  let offset: number;
  try {
    offset = offsetMinutes(new Date(utcMs), timeZone);
  } catch {
    // Zona desconocida: mejor marcarlo como UTC que mentir con una hora local.
    offset = 0;
  }

  const local = new Date(utcMs + offset * 60000);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);

  return (
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/**
 * Reescribe los campos de tipo datetime de un registro. `fieldTypes` viene de
 * fields_get; los campos que no aparezcan se dejan intactos, igual que los
 * valores que no sean cadenas (Odoo usa `false` para los vacíos).
 */
export function localizeRecord(
  record: Record<string, unknown>,
  fieldTypes: Record<string, string>,
  timeZone: string
): Record<string, unknown> {
  let changed = false;
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (fieldTypes[key] === "datetime" && typeof value === "string") {
      const converted = utcNaiveToIso(value, timeZone);
      out[key] = converted;
      if (converted !== value) changed = true;
    } else {
      out[key] = value;
    }
  }

  return changed ? out : record;
}

export function localizeRecords(
  records: unknown[],
  fieldTypes: Record<string, string>,
  timeZone: string
): unknown[] {
  return records.map((record) =>
    record && typeof record === "object" && !Array.isArray(record)
      ? localizeRecord(record as Record<string, unknown>, fieldTypes, timeZone)
      : record
  );
}
