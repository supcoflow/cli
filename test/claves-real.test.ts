// Las piezas REALES de `claves crear` (src/entorno.ts) contra un directorio temporal: lo que los dobles no
// pueden probar es que el disco de verdad respete el modo, no siga enlaces y haga el candado exclusivo.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { crearCandados } from "../src/candado.ts";
import { fsDelCandadoReal, fsDeSecretosReal, procesoVivo } from "../src/entorno.ts";
import { crearGuardaDeSecretos } from "../src/secreto-a-archivo.ts";

const A = `scf_${"c".repeat(16)}_${"d".repeat(64)}`;
const B = `scf_${"c".repeat(16)}_${"e".repeat(64)}`;
const ID = "cla_cccccccccccccccc";
let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "supcoflow-claves-")); });
afterEach(() => rmSync(tmp, { recursive: true, force: true }));
const modo = (p: string) => statSync(p).mode & 0o777;

describe("el secreto en el disco de verdad", () => {
  it("queda 0600 aunque la umask diga otra cosa, y se reemplaza con el mismo sufijo", () => {
    const ruta = join(tmp, "ci.key");
    const g = crearGuardaDeSecretos(fsDeSecretosReal);
    const umask = process.umask(0o000);
    try {
      expect(g.guardar(ruta, ID, A)).toBe("guardado");
    } finally {
      process.umask(umask);
    }
    expect(modo(ruta)).toBe(0o600);
    expect(g.leer(ruta)).toEqual({ estado: "clave", claveId: ID, secreto: A });
    expect(g.guardar(ruta, ID, B)).toBe("guardado");
    expect(readFileSync(ruta, "utf8")).toBe(B + "\n");
    expect(modo(ruta)).toBe(0o600);
  });
  it("un enlace en el destino: 3 al guardar, otra_cosa al leer, y su destino intacto", () => {
    const real = join(tmp, "real");
    writeFileSync(real, A + "\n");
    const ruta = join(tmp, "ci.key");
    symlinkSync(real, ruta);
    const g = crearGuardaDeSecretos(fsDeSecretosReal);
    expect(g.leer(ruta)).toEqual({ estado: "otra_cosa" });
    expect(g.guardar(ruta, ID, B)).toMatchObject({ codigo: 3 });
    expect(readFileSync(real, "utf8")).toBe(A + "\n");
  });
  it("dentro de un repo (hay .git): 3, nada escrito", () => {
    mkdirSync(join(tmp, "r", ".git"), { recursive: true });
    const ruta = join(tmp, "r", "ci.key");
    expect(crearGuardaDeSecretos(fsDeSecretosReal).guardar(ruta, ID, A)).toMatchObject({ codigo: 3 });
    expect(() => statSync(ruta)).toThrow();
  });
});

describe("el candado en el disco de verdad", () => {
  it("exclusivo entre dos tomas, 0600, y soltar lo borra", () => {
    const carpeta = join(tmp, "candados");
    const c = crearCandados(fsDelCandadoReal, carpeta, process.pid, procesoVivo);
    const t = c.tomar("clave_crear#p#ci");
    expect(t.tipo).toBe("tomado");
    expect(c.tomar("clave_crear#p#ci").tipo).toBe("ocupado");
    if (t.tipo !== "tomado") return;
    t.soltar();
    expect(c.tomar("clave_crear#p#ci").tipo).toBe("tomado");
  });
  it("procesoVivo: el propio sí; un pid que no existe, no", () => {
    expect(procesoVivo(process.pid)).toBe(true);
    expect(procesoVivo(2 ** 22 + 12345)).toBe(false);
  });
  it("una carpeta sin permiso: no_disponible", () => {
    if (process.getuid?.() === 0) return; // root escribe igual
    const carpeta = join(tmp, "candados");
    mkdirSync(carpeta, { mode: 0o500 });
    expect(crearCandados(fsDelCandadoReal, carpeta, process.pid, procesoVivo).tomar("x").tipo).toBe("no_disponible");
  });
});
