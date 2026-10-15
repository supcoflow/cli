// El `FsMinimo` REAL de src/entorno.ts contra un directorio temporal (Review Focus 6): lo que los
// dobles de la Tarea 3 no pueden probar es que el sistema de archivos de verdad se comporte así.
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fsReal } from "../src/entorno.ts";
import { almacenDeArchivo } from "../src/guardado/archivo.ts";
import { crearGuardado } from "../src/guardado/index.ts";

let tmp: string;
let dir: string;
let ruta: string;
const registro = { valor: "x", escritoEn: 1 };

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "supcoflow-archivo-"));
  dir = join(tmp, "config", "supcoflow");
  ruta = join(dir, "credenciales.json");
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const modo = (p: string) => statSync(p).mode & 0o777;

describe("el archivo de credenciales sobre el disco de verdad", () => {
  it("un .tmp viejo con 0644 no se hereda: el final queda 0600", async () => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(ruta + ".tmp", "viejo", { mode: 0o644 });
    chmodSync(ruta + ".tmp", 0o644);
    await almacenDeArchivo(ruta, fsReal).escribir("cuenta", registro);
    expect(modo(ruta)).toBe(0o600);
    expect(JSON.parse(readFileSync(ruta, "utf8"))).toEqual({ cuenta: registro });
    expect(existsSync(ruta + ".tmp")).toBe(false);
  });

  it("un .tmp que es un enlace no se escribe a través: la víctima queda intacta", async () => {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const victima = join(tmp, "victima");
    writeFileSync(victima, "no me toques", { mode: 0o644 });
    symlinkSync(victima, ruta + ".tmp");
    await almacenDeArchivo(ruta, fsReal).escribir("cuenta", registro);
    expect(readFileSync(victima, "utf8")).toBe("no me toques");
    expect(modo(victima)).toBe(0o644);
    expect(lstatSync(ruta).isFile()).toBe(true);
    expect(modo(ruta)).toBe(0o600);
  });

  it("una carpeta supcoflow que ya existía con 0755 queda 0700", async () => {
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o755);
    await almacenDeArchivo(ruta, fsReal).escribir("cuenta", registro);
    expect(modo(dir)).toBe(0o700);
  });

  it("un enlace roto cuenta como existente, así nadie salta por encima de él", () => {
    const enlace = join(tmp, "roto");
    symlinkSync(join(tmp, "no-existe"), enlace);
    expect(fsReal.existe(enlace)).toBe(true);
  });

  // `existsSync` dice false ante un enlace roto: el control del repo subía al padre, resolvía ese y
  // daba una ruta «real» que no pasaba por el repo, y lo único que frenaba la escritura era que el
  // `mkdir` falla sobre el enlace: suerte, no control. Con `existe` mirando el enlace mismo, el
  // control llega al enlace, no lo puede resolver y no deja escribir.
  it("~/.config/supcoflow como enlace roto hacia un repo: no se escribe nada", async () => {
    const repo = join(tmp, "dotfiles");
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(join(tmp, "config"), { recursive: true });
    symlinkSync(join(repo, "supcoflow"), dir);
    const g = crearGuardado({
      env: {}, llavero: null, archivo: almacenDeArchivo(ruta, fsReal), rutaDelArchivo: ruta,
      fs: fsReal, ahora: () => 1, avisar: () => {},
    });
    await expect(g.guardarClave("https://app.supcoflow.dev", "clave")).rejects.toThrow();
    expect(existsSync(join(repo, "supcoflow"))).toBe(false);
  });
});
