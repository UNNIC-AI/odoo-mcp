import { describe, expect, it } from "vitest";
import {
  isValidTimeZone,
  localizeRecord,
  localizeRecords,
  utcNaiveToIso,
} from "../../src/datetime.js";

describe("utcNaiveToIso", () => {
  it("añade el desfase de verano de Madrid", () => {
    expect(utcNaiveToIso("2026-08-25 08:31:55", "Europe/Madrid")).toBe(
      "2026-08-25T10:31:55+02:00"
    );
  });

  it("usa el desfase de invierno cuando toca", () => {
    expect(utcNaiveToIso("2026-01-15 08:00:00", "Europe/Madrid")).toBe(
      "2026-01-15T09:00:00+01:00"
    );
  });

  it("marca UTC con +00:00 en vez de dejarlo ambiguo", () => {
    expect(utcNaiveToIso("2026-08-25 08:31:55", "UTC")).toBe(
      "2026-08-25T08:31:55+00:00"
    );
  });

  it("maneja desfases negativos", () => {
    expect(utcNaiveToIso("2026-08-25 08:00:00", "America/New_York")).toBe(
      "2026-08-25T04:00:00-04:00"
    );
  });

  it("maneja desfases que no son de horas enteras", () => {
    expect(utcNaiveToIso("2026-08-25 08:00:00", "Asia/Kolkata")).toBe(
      "2026-08-25T13:30:00+05:30"
    );
  });

  it("cruza el cambio de día hacia adelante", () => {
    expect(utcNaiveToIso("2026-08-25 23:30:00", "Asia/Tokyo")).toBe(
      "2026-08-26T08:30:00+09:00"
    );
  });

  it("cruza el cambio de día hacia atrás", () => {
    expect(utcNaiveToIso("2026-08-25 02:00:00", "America/Los_Angeles")).toBe(
      "2026-08-24T19:00:00-07:00"
    );
  });

  it("acepta también el separador T", () => {
    expect(utcNaiveToIso("2026-08-25T08:31:55", "UTC")).toBe(
      "2026-08-25T08:31:55+00:00"
    );
  });

  it.each(["2026-08-25", "", "no es una fecha", "2026-13-45 99:99:99"])(
    "deja intacto lo que no es un datetime de Odoo (%s)",
    (value) => {
      expect(utcNaiveToIso(value, "Europe/Madrid")).toBe(value);
    }
  );

  it("ante una zona desconocida cae a UTC en vez de inventarse la hora", () => {
    expect(utcNaiveToIso("2026-08-25 08:31:55", "Marte/Olympus")).toBe(
      "2026-08-25T08:31:55+00:00"
    );
  });
});

describe("isValidTimeZone", () => {
  it.each(["Europe/Madrid", "UTC", "America/New_York"])("acepta %s", (tz) => {
    expect(isValidTimeZone(tz)).toBe(true);
  });

  it.each(["Marte/Olympus", "no-existe"])("rechaza %s", (tz) => {
    expect(isValidTimeZone(tz)).toBe(false);
  });
});

describe("localizeRecord", () => {
  const types = {
    create_date: "datetime",
    date_order: "datetime",
    validity_date: "date",
    name: "char",
  };

  it("solo toca los campos de tipo datetime", () => {
    const record = {
      name: "S00016",
      date_order: "2026-08-25 08:31:55",
      validity_date: "2026-09-10",
      create_date: "2026-08-25 08:31:53",
    };

    expect(localizeRecord(record, types, "Europe/Madrid")).toEqual({
      name: "S00016",
      date_order: "2026-08-25T10:31:55+02:00",
      // Un `date` no tiene hora ni zona: se deja como está.
      validity_date: "2026-09-10",
      create_date: "2026-08-25T10:31:53+02:00",
    });
  });

  it("respeta los false con los que Odoo marca los vacíos", () => {
    const record = { date_order: false, name: "S1" };
    expect(localizeRecord(record, types, "Europe/Madrid")).toEqual(record);
  });

  it("deja intactos los campos que no aparecen en fields_get", () => {
    const record = { desconocido: "2026-08-25 08:31:55" };
    expect(localizeRecord(record, types, "Europe/Madrid")).toEqual(record);
  });

  it("devuelve el mismo objeto si no hay nada que convertir", () => {
    const record = { name: "S1" };
    expect(localizeRecord(record, types, "Europe/Madrid")).toBe(record);
  });

  it("sin tipos de campo no cambia nada", () => {
    const record = { date_order: "2026-08-25 08:31:55" };
    expect(localizeRecord(record, {}, "Europe/Madrid")).toBe(record);
  });
});

describe("localizeRecords", () => {
  it("convierte una lista entera", () => {
    const records = [
      { create_date: "2026-08-25 08:00:00" },
      { create_date: "2026-08-25 09:00:00" },
    ];

    expect(localizeRecords(records, { create_date: "datetime" }, "UTC")).toEqual([
      { create_date: "2026-08-25T08:00:00+00:00" },
      { create_date: "2026-08-25T09:00:00+00:00" },
    ]);
  });

  it("no se rompe con elementos que no son objetos", () => {
    expect(localizeRecords([null, 5, "x"], { a: "datetime" }, "UTC")).toEqual([
      null,
      5,
      "x",
    ]);
  });
});
