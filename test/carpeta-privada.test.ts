// Guardar en una carpeta compartida (la salida que propone el aviso: /Users/Shared/supcoflow-<uid>) sin que otro usuario de
// la máquina pueda ocupar el nombre, enlazarlo o dejar ahí un pedido pendiente (revisión 1, P2-2). Disco real; el "otro
// usuario" se simula cambiando lo que `ficha` dice del dueño, porque un test no puede crear archivos de otro usuario.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Diagnostico } from "../src/api.ts";
import { diagnosticar, probar, type DepsDePrueba } from "../src/comandos/probar.ts";
import { fsDelLugarReal, fsReal, gitReal } from "../src/entorno.ts";
import { almacenDeArchivo } from "../src/guardado/archivo.ts";
import { carpetaFueraDeUnRepo } from "../src/guardado/fuera-del-repo.ts";
import { almacenEnCarpetaPrivada, revisarCarpetaPrivada, SinLugarSeguro } from "../src/guardado/carpeta-privada.ts";
import { revisarElLugar } from "../src/guardado/lugar.ts";
import { almacenProtegido } from "../src/guardado/protegido.ts";
import type { FsDelLugar } from "../src/guardado/lugar.ts";
import { crearRegistroDePruebas } from "../src/pruebas-guardadas.ts";

let tmp: string;
let compartida: string; // como /Users/Shared: de todos, con el bit sticky
let raiz: string; // la raíz por usuario
let dir: string; // <raíz>/supcoflow: lo que usa la terminal con XDG_CONFIG_HOME=<raíz>
beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "supcoflow-priv-")));
  compartida = join(tmp, "compartida");
  mkdirSync(compartida);
  chmodSync(compartida, 0o1777);
  raiz = join(compartida, "supcoflow-501");
  dir = join(raiz, "supcoflow");
});
afterEach(() => {
  try { chmodSync(compartida, 0o1777); } catch { /* no existe */ }
  rmSync(tmp, { recursive: true, force: true });
});

/** Un sistema de archivos donde esas rutas figuran como de otro usuario. */
function conAjenos(ajenos: string[]): FsDelLugar {
  return {
    ...fsDelLugarReal,
    ficha(p, seguir) {
      const f = fsDelLugarReal.ficha(p, seguir);
      return f.existe && ajenos.includes(p) ? { ...f, uid: (f.uid ?? 0) + 1 } : f;
    },
  };
}
const crearPrivada = (p: string) => { mkdirSync(p, { recursive: true }); chmodSync(p, 0o700); };
const modo = (p: string) => statSync(p).mode & 0o7777;

describe("revisarCarpetaPrivada", () => {
  it("fuera de toda carpeta compartida no cambia nada (el caso de siempre: ~/.config/supcoflow)", () => {
    const casa = join(tmp, "casa", ".config", "supcoflow");
    mkdirSync(casa, { recursive: true }); // 0755, como cualquiera
    expect(revisarCarpetaPrivada(casa, fsDelLugarReal)).toBeNull();
    expect(revisarCarpetaPrivada(join(tmp, "casa", "no-existe", "x"), fsDelLugarReal)).toBeNull();
  });

  it("bajo una carpeta compartida: lo que no existe todavía está bien, y revisar no crea nada", () => {
    expect(revisarCarpetaPrivada(dir, fsDelLugarReal)).toBeNull();
    expect(existsSync(raiz)).toBe(false);
  });

  it("la raíz por usuario propia y 0700, y el destino propio: está bien", () => {
    crearPrivada(raiz);
    crearPrivada(dir);
    expect(revisarCarpetaPrivada(dir, fsDelLugarReal)).toBeNull();
  });

  it("la raíz existe y otro usuario puede leerla (0755): no sirve, y el aviso dice qué hacer", () => {
    mkdirSync(raiz);
    chmodSync(raiz, 0o755);
    expect(revisarCarpetaPrivada(dir, fsDelLugarReal)).toMatchObject({ codigo: "carpeta_compartida_insegura", detalle: expect.stringContaining(raiz) });
    expect(revisarCarpetaPrivada(dir, fsDelLugarReal)!.detalle).toMatch(/chmod 700/);
  });

  it("un tramo de más abajo que otros pueden escribir (0775 / 0777): no sirve", () => {
    crearPrivada(raiz);
    mkdirSync(dir);
    chmodSync(dir, 0o777);
    expect(revisarCarpetaPrivada(dir, fsDelLugarReal)).toMatchObject({ codigo: "carpeta_compartida_insegura" });
  });

  it("la raíz es de otro usuario (alguien ocupó el nombre): no sirve", () => {
    crearPrivada(raiz);
    crearPrivada(dir);
    expect(revisarCarpetaPrivada(dir, conAjenos([raiz]))).toMatchObject({ codigo: "carpeta_compartida_insegura", detalle: expect.stringMatching(/isn't yours/) });
  });

  it("el destino <raíz>/supcoflow es de otro usuario: no sirve", () => {
    crearPrivada(raiz);
    crearPrivada(dir);
    expect(revisarCarpetaPrivada(dir, conAjenos([dir]))).toMatchObject({ codigo: "carpeta_compartida_insegura" });
  });

  it("un enlace puesto por otro usuario no se sigue, aunque apunte a una carpeta mía", () => {
    const mia = join(tmp, "mia");
    crearPrivada(mia);
    symlinkSync(mia, raiz);
    expect(revisarCarpetaPrivada(dir, conAjenos([raiz]))).toMatchObject({ codigo: "carpeta_compartida_insegura", detalle: expect.stringMatching(/link/) });
  });

  it("un enlace mío hacia una carpeta mía y privada sí vale (stow dentro de mi propia raíz)", () => {
    const mia = join(tmp, "mia");
    crearPrivada(mia);
    crearPrivada(raiz);
    symlinkSync(mia, dir);
    expect(revisarCarpetaPrivada(dir, fsDelLugarReal)).toBeNull();
  });

  it("un enlace roto, un archivo o algo que no es carpeta en el camino: no sirve", () => {
    symlinkSync(join(tmp, "no-existe"), raiz);
    expect(revisarCarpetaPrivada(dir, fsDelLugarReal)).toMatchObject({ codigo: "carpeta_compartida_insegura" });
    rmSync(raiz);
    writeFileSync(raiz, "x");
    expect(revisarCarpetaPrivada(dir, fsDelLugarReal)).toMatchObject({ codigo: "carpeta_compartida_insegura" });
  });

  it("la carpeta compartida que otros pueden escribir SIN bit sticky no sirve (otro podría reemplazar la raíz)", () => {
    chmodSync(compartida, 0o777);
    expect(revisarCarpetaPrivada(dir, fsDelLugarReal)).toMatchObject({ codigo: "carpeta_compartida_insegura", detalle: expect.stringMatching(/sticky/) });
  });

  it("con `crear`, crea lo que falta con 0700, la raíz incluida, y la verifica", () => {
    expect(revisarCarpetaPrivada(dir, fsDelLugarReal, { crear: true })).toBeNull();
    expect(modo(raiz)).toBe(0o700);
    expect(modo(dir)).toBe(0o700);
  });

  it("con `crear`, si otro usuario ganó la carrera (la raíz recién creada figura ajena), no sirve", () => {
    expect(revisarCarpetaPrivada(dir, conAjenos([raiz]), { crear: true })).toMatchObject({ codigo: "carpeta_compartida_insegura" });
  });
});

// Revisión 2, P2-R2-1: la carpeta compartida de confianza es la MÁS ALTA que otros pueden escribir; una raíz por usuario que
// se declara 01777 no se vuelve «la compartida» para saltarse sus propias comprobaciones.
describe("P2-R2-1: la raíz personal se exige propia y 0700 desde la base compartida", () => {
  it("una raíz propia con 01777 (hijo propio 0700) se rechaza", () => {
    crearPrivada(dir);
    chmodSync(raiz, 0o1777);
    expect(revisarCarpetaPrivada(dir, fsDelLugarReal)).toMatchObject({ codigo: "carpeta_compartida_insegura" });
  });

  it("una raíz ajena con 01777 se rechaza, y el almacén no lee lo que haya adentro", async () => {
    crearPrivada(dir);
    chmodSync(raiz, 0o1777);
    writeFileSync(join(dir, "pruebas.json"), JSON.stringify({ c: { valor: "plantado", escritoEn: 1 } }));
    const ruta = join(dir, "pruebas.json");
    const ajena = conAjenos([raiz]);
    expect(revisarCarpetaPrivada(dir, ajena)).toMatchObject({ codigo: "carpeta_compartida_insegura" });
    await expect(almacenEnCarpetaPrivada(almacenDeArchivo(ruta, fsReal), { ruta, fs: ajena }).leer("c")).rejects.toBeInstanceOf(SinLugarSeguro);
  });

  it("un enlace AJENO que apunta a otra carpeta compartida se rechaza (sin seguirlo)", () => {
    const otra = join(tmp, "otra-compartida");
    mkdirSync(otra);
    chmodSync(otra, 0o1777);
    symlinkSync(otra, raiz);
    expect(revisarCarpetaPrivada(dir, conAjenos([raiz]))).toMatchObject({ codigo: "carpeta_compartida_insegura" });
  });

  it("una raíz con modo 01777 que otro usuario recién creó tampoco pasa con `crear`", () => {
    mkdirSync(raiz);
    chmodSync(raiz, 0o1777);
    expect(revisarCarpetaPrivada(dir, fsDelLugarReal, { crear: true })).toMatchObject({ codigo: "carpeta_compartida_insegura" });
    expect(existsSync(dir)).toBe(false);
  });
});

// Revisión 2, P2-R2-2: un enlace propio introduce la cadena REAL de su destino; sus ancestros también se comprueban.
describe("P2-R2-2: los ancestros de la ruta real de un enlace propio", () => {
  function raizEnlazadaAUnPadreAbierto(modoDelPadre: number) {
    const padre = join(tmp, "padre-abierto");
    mkdirSync(padre);
    chmodSync(padre, modoDelPadre);
    const real = join(padre, "mia");
    crearPrivada(real);
    crearPrivada(join(real, "supcoflow"));
    symlinkSync(real, raiz);
  }

  it("raíz = enlace propio a una carpeta propia 0700 dentro de un padre que otros escriben SIN sticky: se rechaza", () => {
    raizEnlazadaAUnPadreAbierto(0o777);
    expect(revisarCarpetaPrivada(dir, fsDelLugarReal)).toMatchObject({ codigo: "carpeta_compartida_insegura" });
  });

  it("lo mismo, y coincide con revisar la ruta real directamente", () => {
    raizEnlazadaAUnPadreAbierto(0o777);
    const real = realpathSync(dir);
    expect(revisarCarpetaPrivada(real, fsDelLugarReal)).toMatchObject({ codigo: "carpeta_compartida_insegura" });
    expect(revisarCarpetaPrivada(dir, fsDelLugarReal)).not.toBeNull();
  });

  it("el almacén tampoco escribe por ese enlace", async () => {
    raizEnlazadaAUnPadreAbierto(0o777);
    const ruta = join(dir, "pruebas.json");
    await expect(almacenEnCarpetaPrivada(almacenDeArchivo(ruta, fsReal), { ruta, fs: fsDelLugarReal }).escribir("c", { valor: "v", escritoEn: 1 })).rejects.toBeInstanceOf(SinLugarSeguro);
    expect(existsSync(ruta)).toBe(false);
  });

  it("el mismo enlace hacia un padre con sticky (como una compartida) sí vale si la cadena real es toda propia y privada", () => {
    raizEnlazadaAUnPadreAbierto(0o1777);
    expect(revisarCarpetaPrivada(dir, fsDelLugarReal)).toBeNull();
  });

  it("el selector coincide con el rechazo", () => {
    raizEnlazadaAUnPadreAbierto(0o777);
    // `compartida` es la candidata; su `supcoflow-501` es el enlace
    expect(carpetaFueraDeUnRepo({ fs: fsDelLugarReal, candidatos: [compartida], usuario: "501" })).toBeNull();
  });
});

describe("almacenEnCarpetaPrivada", () => {
  const ruta = () => join(dir, "pruebas.json");
  const armar = (fs: FsDelLugar = fsDelLugarReal) => almacenEnCarpetaPrivada(almacenDeArchivo(ruta(), fsReal), { ruta: ruta(), fs });
  const REG = { valor: "v", escritoEn: 1 };

  it("escribir crea la raíz y la carpeta 0700 y guarda; leer devuelve lo guardado", async () => {
    await armar().escribir("c", REG);
    expect(modo(raiz)).toBe(0o700);
    expect(modo(dir)).toBe(0o700);
    expect(modo(ruta())).toBe(0o600);
    expect(await armar().leer("c")).toEqual(REG);
  });

  it("leer una carpeta que no existe es «no hay», no un error", async () => {
    expect(await armar().leer("c")).toBeNull();
    expect(existsSync(raiz)).toBe(false);
  });

  it("leer con la raíz ocupada por otro usuario NO lee: lanza SinLugarSeguro", async () => {
    crearPrivada(raiz);
    crearPrivada(dir);
    writeFileSync(ruta(), JSON.stringify({ c: REG }));
    await expect(armar(conAjenos([raiz])).leer("c")).rejects.toBeInstanceOf(SinLugarSeguro);
  });

  it("escribir y borrar con la raíz ajena no tocan el disco", async () => {
    crearPrivada(raiz);
    crearPrivada(dir);
    const antes = JSON.stringify({ c: REG });
    writeFileSync(ruta(), antes);
    await expect(armar(conAjenos([raiz])).escribir("c", { valor: "otro", escritoEn: 2 })).rejects.toBeInstanceOf(SinLugarSeguro);
    await expect(armar(conAjenos([raiz])).borrar("c")).rejects.toBeInstanceOf(SinLugarSeguro);
    expect(readFileSync(ruta(), "utf8")).toBe(antes);
  });

  it("carrera al crear: si lo recién creado figura ajeno, no se escribe nada", async () => {
    await expect(armar(conAjenos([raiz])).escribir("c", REG)).rejects.toBeInstanceOf(SinLugarSeguro);
    expect(existsSync(ruta())).toBe(false);
  });

  it("fuera de una carpeta compartida es transparente", async () => {
    const casa = join(tmp, "casa", "supcoflow", "pruebas.json");
    const a = almacenEnCarpetaPrivada(almacenDeArchivo(casa, fsReal), { ruta: casa, fs: fsDelLugarReal });
    await a.escribir("c", REG);
    expect(await a.leer("c")).toEqual(REG);
  });
});

// La hipótesis de la revisión: un pedido pendiente que dejó otro usuario en la ruta compartida NO se reenvía.
describe("P2-2: el pedido pendiente que dejó otro usuario no se usa", () => {
  const CLAVE = `scf_${"a".repeat(16)}_${"b".repeat(64)}`;
  const PROY = { id: "proj_r-1", slug: "r", repo: "d/r", rama: "main", installCommand: "npm ci", testCommand: "npm test" };
  const DIAG: Diagnostico = {
    listo: true,
    puntos: [
      { punto: "instalacion", ok: true, mensaje: "ok", grupo: "instalacion" }, { punto: "sitios", ok: true, mensaje: "ok", grupo: "instalacion" },
      { punto: "chat", ok: true, mensaje: "ok", grupo: "instalacion" }, { punto: "guia", ok: true, mensaje: "ok", grupo: "instalacion" },
      { punto: "despachos", ok: true, mensaje: "ok", grupo: "prueba" },
    ],
    politica: "guardar", techoUsd: 2, saldoUsd: 7.5, topeUsd: 10, comprometidoUsd: 2.5, pruebaAbierta: null,
  };
  const F = { repo: null, authorizeSpend: true, dryRun: false, message: null, wait: false, testId: null, ceiling: "2", expectPolicy: "save" };

  function deps(fs: FsDelLugar) {
    const ruta = join(dir, "pruebas.json");
    const posts: unknown[] = [];
    const pruebas = crearRegistroDePruebas({
      origen: "http://localhost:3000",
      almacen: almacenEnCarpetaPrivada(almacenProtegido(almacenDeArchivo(ruta, fsReal), { ruta, fs: fsReal, git: gitReal }), { ruta, fs }),
      rutaDelArchivo: ruta, ahora: () => 1, avisar: () => {},
      revisarElLugar: () => revisarElLugar({ ruta, fs, git: gitReal }),
    });
    const d: DepsDePrueba = {
      api: new URL("http://localhost:3000"),
      guardado: { leerClaveCompleta: async () => ({ valor: { clave: CLAVE, fuente: "llavero" }, completa: true }) } as never,
      git: async (args) => (args[0] === "rev-parse" ? { codigo: 0, stdout: "/w/r\n" } : { codigo: 0, stdout: "git@github.com:d/r.git\n" }),
      cwd: "/w/r", buscarProyecto: async () => PROY, leerDiagnostico: async () => DIAG,
      pedirPrueba: async (_a, _c, _p, intento) => { posts.push(intento); return { tipo: "aceptada", pruebaId: "prb_0000000000000001", reporteId: "rep_1", estado: "creada" }; },
      leerPrueba: async () => { throw new Error("no"); },
      pruebas, generar: () => "clave-1", ahora: () => 0, dormir: async () => {}, avisar: () => {},
    };
    return { d, posts };
  }
  const plantar = () => {
    crearPrivada(raiz);
    crearPrivada(dir);
    writeFileSync(join(dir, "pruebas.json"), JSON.stringify({
      "http://localhost:3000#prueba#proj_r-1": { valor: JSON.stringify({ intento: { clave: "injected-idempotency", mensaje: "UNTRUSTED", techo_usd: 2, politica_esperada: "guardar" }, ultima: null }), escritoEn: 1 },
    }));
  };

  it("test --authorize-spend con la raíz ocupada por otro: no hay POST, sale 1 prueba_no_guardada, y el motivo está en el mensaje", async () => {
    plantar();
    const { d, posts } = deps(conAjenos([raiz]));
    const r = await probar(d, F);
    expect(posts).toEqual([]);
    expect(r.codigo).toBe(1);
    expect(r.json).toMatchObject({ ok: false, error: "prueba_no_guardada" });
    expect(String(r.json.message)).toMatch(/isn't yours/);
    expect(JSON.stringify(r)).not.toContain("UNTRUSTED");
  });

  it("la misma situación sin ajenos reenvía el pedido (control: el test de arriba falla por el dueño, no por otra cosa)", async () => {
    plantar();
    const { d, posts } = deps(fsDelLugarReal);
    const r = await probar(d, F);
    expect(posts).toHaveLength(1);
    expect(r.codigo).toBe(5);
  });

  it("diagnose lo dice ANTES del sí de gasto, como impedimento de la máquina", async () => {
    plantar();
    const g = await diagnosticar(deps(conAjenos([raiz])).d, { repo: null });
    expect(g.codigo).toBe(4);
    expect(g.json.maquina).toMatchObject({ ok: false, impedimentos: expect.arrayContaining([expect.objectContaining({ codigo: "carpeta_compartida_insegura" })]) });
  });
});
