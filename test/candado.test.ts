// test/candado.test.ts — con un fs falso y `procesoVivo` inyectado
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { crearCandados, type FsDelCandado } from "../src/candado.ts";

const CARPETA = "/h/.config/supcoflow/candados";
const rutaDe = (nombre: string) => `${CARPETA}/${createHash("sha256").update(nombre).digest("hex")}.lock`;

function fsFalso(o: { sinPermiso?: "carpeta" | "archivo" } = {}) {
  const archivos = new Map<string, { contenido: string; modo: number }>();
  const borrados: string[] = [];
  const fs: FsDelCandado = {
    crearExclusivo(p, contenido, modo) {
      if (o.sinPermiso === "archivo") throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      if (archivos.has(p)) return false;
      archivos.set(p, { contenido, modo });
      return true;
    },
    leer: (p) => archivos.get(p)?.contenido ?? null,
    borrar(p) {
      borrados.push(p);
      archivos.delete(p);
    },
    crearDir() {
      if (o.sinPermiso === "carpeta") throw Object.assign(new Error("EACCES"), { code: "EACCES" });
    },
  };
  return { fs, archivos, borrados };
}
const VIVO = 100;
const MUERTO = 200;
const procesoVivo = (pid: number) => pid === VIVO || pid === 101;

describe("candado por operación", () => {
  it("tomar en una carpeta vacía: tomado, y crea <sha256(nombre)>.lock 0600 con {pid, token}", () => {
    const f = fsFalso();
    const t = crearCandados(f.fs, CARPETA, VIVO, procesoVivo).tomar("clave_crear#p#ci");
    expect(t.tipo).toBe("tomado");
    const a = f.archivos.get(rutaDe("clave_crear#p#ci"))!;
    expect(a.modo).toBe(0o600);
    const v = JSON.parse(a.contenido) as { pid: number; token: string };
    expect(v.pid).toBe(VIVO);
    expect(typeof v.token).toBe("string");
    expect(v.token.length).toBeGreaterThan(8);
  });
  it("tomar dos veces el mismo nombre con el pid vivo: la segunda ocupado", () => {
    const f = fsFalso();
    const c = crearCandados(f.fs, CARPETA, VIVO, procesoVivo);
    expect(c.tomar("x").tipo).toBe("tomado");
    expect(crearCandados(f.fs, CARPETA, 101, procesoVivo).tomar("x").tipo).toBe("ocupado");
  });
  it("soltar y volver a tomar: anda", () => {
    const f = fsFalso();
    const c = crearCandados(f.fs, CARPETA, VIVO, procesoVivo);
    const t = c.tomar("x");
    if (t.tipo !== "tomado") throw new Error("no tomó");
    t.soltar();
    expect(f.archivos.size).toBe(0);
    expect(c.tomar("x").tipo).toBe("tomado");
  });
  it("tercera revisión, hallazgo 1: un .lock de un pid MUERTO → abandonado con la ruta; nadie lo borra, y dos recuperadores no entran", () => {
    const f = fsFalso();
    f.archivos.set(rutaDe("x"), { contenido: JSON.stringify({ pid: MUERTO, token: "viejo" }), modo: 0o600 });
    const uno = crearCandados(f.fs, CARPETA, VIVO, procesoVivo).tomar("x");
    const otro = crearCandados(f.fs, CARPETA, 101, procesoVivo).tomar("x");
    expect(uno).toEqual({ tipo: "abandonado", ruta: rutaDe("x") });
    expect(otro).toEqual({ tipo: "abandonado", ruta: rutaDe("x") });
    expect(f.borrados).toEqual([]);
    expect(JSON.parse(f.archivos.get(rutaDe("x"))!.contenido)).toEqual({ pid: MUERTO, token: "viejo" });
  });
  it("un .lock ilegible (basura o sin pid) → abandonado, nunca ocupado ni borrado", () => {
    for (const contenido of ["no-json", "{}", JSON.stringify({ pid: "100" })]) {
      const f = fsFalso();
      f.archivos.set(rutaDe("x"), { contenido, modo: 0o600 });
      expect(crearCandados(f.fs, CARPETA, VIVO, procesoVivo).tomar("x")).toEqual({ tipo: "abandonado", ruta: rutaDe("x") });
      expect(f.borrados).toEqual([]);
    }
  });
  it("soltar de un dueño viejo después de que una persona borró su lock y otro tomó uno nuevo: no lo borra", () => {
    const f = fsFalso();
    const viejo = crearCandados(f.fs, CARPETA, VIVO, procesoVivo).tomar("x");
    if (viejo.tipo !== "tomado") throw new Error("no tomó");
    f.archivos.delete(rutaDe("x")); // la persona lo borró a mano
    const nuevo = crearCandados(f.fs, CARPETA, 101, procesoVivo).tomar("x");
    expect(nuevo.tipo).toBe("tomado");
    const delNuevo = f.archivos.get(rutaDe("x"))!.contenido;
    viejo.soltar();
    expect(f.archivos.get(rutaDe("x"))?.contenido).toBe(delNuevo);
    expect(f.borrados).toEqual([]);
  });
  it("carpeta o archivo que no se pueden crear (EACCES): no_disponible con la ruta", () => {
    for (const sinPermiso of ["carpeta", "archivo"] as const) {
      const f = fsFalso({ sinPermiso });
      expect(crearCandados(f.fs, CARPETA, VIVO, procesoVivo).tomar("x")).toEqual({ tipo: "no_disponible", ruta: rutaDe("x") });
    }
  });
  it("dos nombres distintos no se bloquean entre sí", () => {
    const f = fsFalso();
    const c = crearCandados(f.fs, CARPETA, VIVO, procesoVivo);
    expect(c.tomar("clave_crear#p#ci").tipo).toBe("tomado");
    expect(c.tomar("clave_crear#p#otra").tipo).toBe("tomado");
  });
});
