import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ayuda, comandoDescribir, DESCRIPCION } from "../src/comandos/describir.ts";

describe("describir --json", () => {
  it("lista los comandos, los siete códigos y las facultades que la clave no tiene", () => {
    const r = comandoDescribir();
    expect(r.codigo).toBe(0);
    expect(r.json.ok).toBe(true);
    const comandos = r.json.comandos as { nombre: string }[];
    expect(comandos.map((c) => c.nombre).slice(0, 7)).toEqual(["login", "logout", "quien-soy", "describir", "repo conectar", "proyecto crear", "proyecto ver"]);
    expect(comandos).toHaveLength(20);
    expect(Object.keys(r.json.codigos as object)).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
    const facultades = r.json.facultades as { nombre: string; con_api_key: boolean }[];
    const sin = facultades.filter((f) => !f.con_api_key).map((f) => f.nombre);
    expect(sin).toEqual(["solo_consola", "operador"]);
    expect(facultades.filter((f) => f.con_api_key).map((f) => f.nombre)).toEqual(["consultar", "configurar", "probar"]);
  });

  it("describe los comandos del bloque 3 con sus códigos", () => {
    const nombres = DESCRIPCION.comandos.map((c) => c.nombre);
    expect(nombres.slice(0, 7)).toEqual(["login", "logout", "quien-soy", "describir", "repo conectar", "proyecto crear", "proyecto ver"]);
    expect(DESCRIPCION.comandos.find((c) => c.nombre === "repo conectar")!.codigos).toEqual([0, 1, 2, 3, 4, 5]);
    expect(DESCRIPCION.comandos.find((c) => c.nombre === "proyecto crear")!.flags.join(" ")).toContain("--install");
  });

  it("describe los trece comandos de configurar, cada uno con flag, ejemplo y códigos", () => {
    const nuevos = [
      "catalogo", "configuracion", "chat prender", "chat apagar", "chat marca", "chat logo", "sitios agregar", "sitios quitar",
      "datos fijar", "politica fijar", "claves crear", "claves listar", "claves revocar",
    ];
    for (const n of nuevos) {
      const c = DESCRIPCION.comandos.find((x) => x.nombre === n);
      expect(c, n).toBeDefined();
      expect(c!.flags.length, n).toBeGreaterThan(0);
      expect(c!.ejemplos.length, n).toBeGreaterThan(0);
      expect(c!.codigos.length, n).toBeGreaterThan(0);
    }
    expect(DESCRIPCION.comandos.find((c) => c.nombre === "claves crear")!.codigos).toContain(4);
  });

  it("todo comando de configurar declara el 4: sin proyecto en el repo, o una clave de consulta que no escribe", () => {
    const configurar = DESCRIPCION.comandos.filter((c) => !["login", "logout", "quien-soy", "describir", "repo conectar", "proyecto crear", "proyecto ver", "catalogo"].includes(c.nombre));
    expect(configurar).toHaveLength(12);
    for (const c of configurar) expect(c.codigos, c.nombre).toContain(4);
  });

  it("los textos de datos fijar y configuracion no prometen «toda IA» ni «ninguna IA» y dicen el límite", () => {
    for (const n of ["datos fijar", "configuracion"]) {
      const c = DESCRIPCION.comandos.find((x) => x.nombre === n)!;
      const t = `${c.resumen} ${c.flags.join(" ")}`;
      expect(t, n).not.toMatch(/toda (la )?IA|ninguna IA/i);
      expect(t, n).toMatch(/IA del chat/);
    }
  });

  it("la versión es la del package.json, y es la 0.3.0", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(DESCRIPCION.version).toBe(pkg.version);
    expect(pkg.version).toBe("0.3.0");
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

  it("la de `repo conectar` trae sus dos pasos", () => {
    const t = ayuda("repo conectar");
    expect(t).toContain("supcoflow repo conectar --start --json");
    expect(t).toContain("supcoflow repo conectar --wait --json");
    expect(t).not.toContain("supcoflow login --start");
  });
});
