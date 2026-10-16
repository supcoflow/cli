// test/secreto-a-archivo.test.ts — con un fs falso (mapa de rutas a {tipo, contenido, modo})
import path from "node:path";
import { describe, expect, it } from "vitest";
import { crearGuardaDeSecretos, type FsDeSecretos } from "../src/secreto-a-archivo.ts";

const A = `scf_${"c".repeat(16)}_${"d".repeat(64)}`;
const B = `scf_${"c".repeat(16)}_${"e".repeat(64)}`;
const ID = "cla_cccccccccccccccc";
const OTRO_ID = "cla_ffffffffffffffff";

type Nodo = { tipo: "archivo" | "enlace" | "dir"; contenido?: string; modo?: number };

function fsFalso(inicial: Record<string, Nodo> = {}) {
  const nodos = new Map<string, Nodo>(Object.entries(inicial));
  const escrituras: string[] = [];
  const fs: FsDeSecretos = {
    realpath: (p) => p,
    existe: (p) => nodos.has(p) || [...nodos.keys()].some((k) => k.startsWith(p + "/")),
    escribirExclusivo(p, s, modo) {
      if (nodos.has(p)) throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
      escrituras.push(p);
      nodos.set(p, { tipo: "archivo", contenido: s, modo });
    },
    renombrar(a, b) {
      const n = nodos.get(a)!;
      nodos.delete(a);
      nodos.set(b, n);
    },
    borrarSiExiste: (p) => void nodos.delete(p),
    leerSinSeguir(p, tope) {
      const n = nodos.get(p);
      if (n === undefined) return { tipo: "ausente" };
      if (n.tipo === "enlace") return { tipo: "enlace" };
      if (n.tipo !== "archivo" || (n.contenido ?? "").length > tope) return { tipo: "ilegible" };
      return { tipo: "contenido", texto: n.contenido ?? "" };
    },
  };
  return { fs, nodos, escrituras };
}

describe("el secreto a un archivo", () => {
  it("destino nuevo fuera de un repo: queda 0600 con el contenido + salto, sin .tmp de más", () => {
    const f = fsFalso({ "/home/u": { tipo: "dir" } });
    expect(crearGuardaDeSecretos(f.fs).guardar("/home/u/ci.key", ID, A)).toBe("guardado");
    expect(f.nodos.get("/home/u/ci.key")).toEqual({ tipo: "archivo", contenido: A + "\n", modo: 0o600 });
    expect([...f.nodos.keys()].filter((k) => k.endsWith(".tmp"))).toEqual([]);
    // El temporal se creó en exclusiva en la MISMA carpeta (el rename tiene que ser atómico).
    expect(path.dirname(f.escrituras[0]!)).toBe("/home/u");
  });
  it("destino dentro de un working tree (existe /w/r/.git): 3, nada escrito", () => {
    const f = fsFalso({ "/w/r/.git": { tipo: "dir" } });
    const r = crearGuardaDeSecretos(f.fs).guardar("/w/r/sub/ci.key", ID, A);
    expect(r).toMatchObject({ codigo: 3 });
    expect(f.escrituras).toEqual([]);
  });
  it("una ruta que no se puede resolver (enlace roto en el camino): 3, falla cerrado", () => {
    const f = fsFalso();
    f.fs.realpath = () => { throw new Error("ENOENT"); };
    expect(crearGuardaDeSecretos(f.fs).guardar("/home/u/ci.key", ID, A)).toMatchObject({ codigo: 3 });
    expect(f.escrituras).toEqual([]);
  });
  it("destino que es un enlace: 3, intacto", () => {
    const f = fsFalso({ "/home/u/ci.key": { tipo: "enlace" } });
    expect(crearGuardaDeSecretos(f.fs).guardar("/home/u/ci.key", ID, A)).toMatchObject({ codigo: 3 });
    expect(f.nodos.get("/home/u/ci.key")).toEqual({ tipo: "enlace" });
  });
  it("destino con una clave del MISMO sufijo: se reemplaza (0600)", () => {
    const f = fsFalso({ "/home/u/ci.key": { tipo: "archivo", contenido: A + "\n", modo: 0o600 } });
    expect(crearGuardaDeSecretos(f.fs).guardar("/home/u/ci.key", ID, B)).toBe("guardado");
    expect(f.nodos.get("/home/u/ci.key")).toEqual({ tipo: "archivo", contenido: B + "\n", modo: 0o600 });
  });
  it("destino con una clave de OTRA fila: 4, intacto", () => {
    const f = fsFalso({ "/home/u/ci.key": { tipo: "archivo", contenido: A + "\n", modo: 0o600 } });
    const r = crearGuardaDeSecretos(f.fs).guardar("/home/u/ci.key", OTRO_ID, B);
    expect(r).toMatchObject({ codigo: 4 });
    expect(JSON.stringify(r)).not.toContain(A);
    expect(f.nodos.get("/home/u/ci.key")!.contenido).toBe(A + "\n");
  });
  it("destino con otra cosa: 4, intacto, y el error no contiene su contenido", () => {
    const f = fsFalso({ "/home/u/ci.key": { tipo: "archivo", contenido: "hola-secreto-ajeno", modo: 0o644 } });
    const r = crearGuardaDeSecretos(f.fs).guardar("/home/u/ci.key", ID, A);
    expect(r).toMatchObject({ codigo: 4 });
    expect(JSON.stringify(r)).not.toContain("hola-secreto-ajeno");
    expect(f.nodos.get("/home/u/ci.key")!.contenido).toBe("hola-secreto-ajeno");
  });
  it("destino que es una carpeta: 4", () => {
    const f = fsFalso({ "/home/u/ci.key": { tipo: "dir" } });
    expect(crearGuardaDeSecretos(f.fs).guardar("/home/u/ci.key", ID, A)).toMatchObject({ codigo: 4 });
  });
  it("una escritura que falla: 3, sin el secreto en el error, y el .tmp no queda", () => {
    const f = fsFalso();
    f.fs.renombrar = () => { throw new Error(`EACCES con ${A}`); };
    const r = crearGuardaDeSecretos(f.fs).guardar("/home/u/ci.key", ID, A);
    expect(r).toMatchObject({ codigo: 3 });
    expect(JSON.stringify(r)).not.toContain(A);
    expect([...f.nodos.keys()].filter((k) => k.endsWith(".tmp"))).toEqual([]);
  });
  it("leer: ausente; una clave → {clave, claveId, secreto}; basura, enlace, carpeta o algo enorme → otra_cosa", () => {
    const f = fsFalso({
      "/k/bien": { tipo: "archivo", contenido: A + "\n" },
      "/k/sin-salto": { tipo: "archivo", contenido: A },
      "/k/basura": { tipo: "archivo", contenido: "hola" },
      "/k/dos-lineas": { tipo: "archivo", contenido: `${A}\n${B}\n` },
      "/k/enlace": { tipo: "enlace" },
      "/k/dir": { tipo: "dir" },
      "/k/enorme": { tipo: "archivo", contenido: "x".repeat(10_000) },
    });
    const g = crearGuardaDeSecretos(f.fs);
    expect(g.leer("/k/nada")).toEqual({ estado: "ausente" });
    expect(g.leer("/k/bien")).toEqual({ estado: "clave", claveId: ID, secreto: A });
    expect(g.leer("/k/sin-salto")).toEqual({ estado: "clave", claveId: ID, secreto: A });
    for (const p of ["/k/basura", "/k/dos-lineas", "/k/enlace", "/k/dir", "/k/enorme"]) expect(g.leer(p)).toEqual({ estado: "otra_cosa" });
  });
  it("validarDestino: dentro de un repo, 3; fuera, null; sin escribir nada", () => {
    const f = fsFalso({ "/w/r/.git": { tipo: "dir" } });
    expect(crearGuardaDeSecretos(f.fs).validarDestino("/w/r/sub/ci.key")).toMatchObject({ codigo: 3 });
    expect(crearGuardaDeSecretos(f.fs).validarDestino("/home/u/ci.key")).toBeNull();
    expect(f.escrituras).toEqual([]);
  });
});
