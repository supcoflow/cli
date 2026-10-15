import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ayuda, comandoDescribir, DESCRIPCION } from "../src/comandos/describir.ts";

describe("describir --json", () => {
  it("lista los cuatro comandos, los siete códigos y las facultades que la clave no tiene", () => {
    const r = comandoDescribir();
    expect(r.codigo).toBe(0);
    expect(r.json.ok).toBe(true);
    const comandos = r.json.comandos as { nombre: string }[];
    expect(comandos.map((c) => c.nombre)).toEqual(["login", "logout", "quien-soy", "describir"]);
    expect(Object.keys(r.json.codigos as object)).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
    const facultades = r.json.facultades as { nombre: string; con_api_key: boolean }[];
    const sin = facultades.filter((f) => !f.con_api_key).map((f) => f.nombre);
    expect(sin).toEqual(["solo_consola", "operador"]);
    expect(facultades.filter((f) => f.con_api_key).map((f) => f.nombre)).toEqual(["consultar", "configurar", "probar"]);
  });

  it("la versión es la del package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(DESCRIPCION.version).toBe(pkg.version);
  });

  it("cabe en una línea de JSON", () => {
    expect(JSON.stringify(comandoDescribir().json)).not.toContain("\n");
  });
});

describe("la ayuda", () => {
  it("trae ejemplos, armados desde la descripción", () => {
    const t = ayuda(null);
    expect(t).toContain("Ejemplos");
    expect(t).toContain("supcoflow login --start --json");
    for (const c of DESCRIPCION.comandos) expect(t).toContain(c.nombre);
  });

  it("la de un comando trae sus flags y sus ejemplos", () => {
    const t = ayuda("login");
    expect(t).toContain("--wait");
    expect(t).toContain("supcoflow login --wait --json");
  });
});
