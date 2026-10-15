import { describe, expect, it } from "vitest";
import { almacenDeLlavero, TECHO_DEL_LLAVERO_MS, type Correr } from "../src/guardado/llavero.ts";
import { almacenDeArchivo } from "../src/guardado/archivo.ts";
import { crearGuardado, type Almacen, type Registro } from "../src/guardado/index.ts";
import { dentroDeUnWorkingTree } from "../src/guardado/repo.ts";
// Imports de los tests agregados al final (las reglas que el brief pide en prosa).
import { LlaveroAusente } from "../src/guardado/llavero.ts";
import { type FsMinimo } from "../src/guardado/archivo.ts";
import { rutaReal } from "../src/guardado/repo.ts";

const A = `scf_${"a".repeat(16)}_${"b".repeat(64)}`;
const B = `scf_${"c".repeat(16)}_${"d".repeat(64)}`;
const PROD = "https://app.supcoflow.dev";
const LOCAL = "http://localhost:3000";
const RUTA = "/home/a/.config/supcoflow/credenciales.json";

function memoria(nombre: "llavero" | "archivo"): Almacen & { datos: Map<string, Registro>; roto: boolean } {
  const datos = new Map<string, Registro>();
  const m = {
    nombre, datos, roto: false,
    async leer(c: string) { if (m.roto) throw new Error("llavero caído"); return datos.get(c) ?? null; },
    async escribir(c: string, r: Registro) { if (m.roto) throw new Error("llavero caído"); datos.set(c, r); },
    async borrar(c: string) { if (m.roto) throw new Error("llavero caído"); datos.delete(c); },
  };
  return m;
}
const sinEnlaces = (existentes: string[] = []) => ({ realpath: (p: string) => p, existe: (p: string) => existentes.includes(p) });
function armar(o: { env?: Record<string, string>; llavero?: ReturnType<typeof memoria> | null; fs?: ReturnType<typeof sinEnlaces> } = {}) {
  let t = 1_000;
  const llavero = o.llavero === undefined ? memoria("llavero") : o.llavero;
  const archivo = memoria("archivo"); const avisos: string[] = [];
  const g = crearGuardado({ env: o.env ?? {}, llavero, archivo, rutaDelArchivo: RUTA, fs: o.fs ?? sinEnlaces(), ahora: () => ++t, avisar: (s) => avisos.push(s) });
  return { g, llavero, archivo, avisos };
}

describe("dentroDeUnWorkingTree", () => {
  it("encuentra un .git directorio o archivo subiendo", () => {
    expect(dentroDeUnWorkingTree("/home/a/.config/supcoflow", sinEnlaces(["/home/a/.git"]))).toBe("/home/a");
    expect(dentroDeUnWorkingTree("/w/repo/sub", sinEnlaces(["/w/repo/.git"]))).toBe("/w/repo");
  });
  it("null si no hay ninguno hasta la raíz", () => {
    expect(dentroDeUnWorkingTree("/home/a/.config/supcoflow", sinEnlaces())).toBeNull();
  });
  it("~/.config enlazado a una carpeta de un repo de dotfiles: lo ve por la ruta real (Review Focus 6)", () => {
    const fs = {
      existe: (p: string) => ["/home/a/.config", "/home/a/dotfiles/.git", "/home/a/dotfiles/config"].includes(p),
      realpath: (p: string) => (p === "/home/a/.config" ? "/home/a/dotfiles/config" : p),
    };
    expect(dentroDeUnWorkingTree("/home/a/.config/supcoflow", fs)).toBe("/home/a/dotfiles");
  });
});

describe("crearGuardado", () => {
  it("SUPCOFLOW_TOKEN manda sobre lo guardado", async () => {
    const { g } = armar({ env: { SUPCOFLOW_TOKEN: A } });
    await g.guardarClave(PROD, B);
    expect(await g.leerClave(PROD)).toEqual({ clave: A, fuente: "env" });
    expect(await g.leerClaveGuardada(PROD)).toEqual({ clave: B, fuente: "llavero" });
  });
  it("con llavero, guarda ahí y no avisa", async () => {
    const { g, archivo, avisos } = armar();
    expect(await g.guardarClave(PROD, A)).toEqual({ donde: "llavero" });
    expect(archivo.datos.size).toBe(0); expect(avisos).toEqual([]);
  });
  it("sin llavero, guarda en archivo AVISANDO", async () => {
    const { g, avisos } = armar({ llavero: null });
    expect(await g.guardarClave(PROD, A)).toEqual({ donde: "archivo" });
    expect(avisos.join()).toContain("0600");
    expect(avisos.join()).not.toContain(A);
  });
  it("HOME con dotfiles en git: sin llavero NO escribe nada (Review Focus 1)", async () => {
    const { g, archivo } = armar({ llavero: null, fs: sinEnlaces(["/home/a/.git"]) });
    await expect(g.guardarClave(PROD, A)).rejects.toMatchObject({ error: "destino_dentro_de_un_repo" });
    expect(archivo.datos.size).toBe(0);
  });
  it("HOME con dotfiles en git: con llavero sí guarda (el llavero no está en el repo)", async () => {
    const { g } = armar({ fs: sinEnlaces(["/home/a/.git"]) });
    expect(await g.guardarClave(PROD, A)).toEqual({ donde: "llavero" });
  });
  it("una clave de localhost no se usa contra producción (Review Focus 3)", async () => {
    const { g } = armar();
    await g.guardarClave(LOCAL, A);
    expect(await g.leerClave(PROD)).toBeNull();
    expect(await g.leerClave(LOCAL)).toMatchObject({ clave: A });
  });
  it("llavero con A, falla, B va al archivo, el llavero vuelve: gana B (Review Focus 8)", async () => {
    const { g, llavero } = armar();
    await g.guardarClave(PROD, A);
    llavero.roto = true;
    expect(await g.guardarClave(PROD, B)).toEqual({ donde: "archivo" });
    llavero.roto = false; // vuelve, todavía con A adentro
    expect(llavero.datos.get(PROD)).toBeDefined();
    expect(await g.leerClave(PROD)).toEqual({ clave: B, fuente: "archivo" });
  });
  it("la clave y el login en curso son cuentas distintas (Review Focus 7)", async () => {
    const { g } = armar();
    await g.guardarClave(PROD, A);
    await g.guardarPendiente(PROD, { deviceCode: "e".repeat(64), userCode: "BCDF-GHJK", verificationUriComplete: "u", venceEn: 9, intervaloS: 5, ultimoSondeoEn: null });
    await g.borrarPendiente(PROD);
    expect(await g.leerClave(PROD)).toEqual({ clave: A, fuente: "llavero" });
  });
  it("un borrado que falla en el llavero no se informa como hecho", async () => {
    const { g, llavero } = armar();
    await g.guardarClave(PROD, A);
    llavero.roto = true;
    await expect(g.borrarClave(PROD)).rejects.toMatchObject({ error: "no_se_pudo_borrar" });
  });
  it("Linux sin secret-tool: guardar, leer, borrar la clave y el pendiente andan sólo con el archivo (Review Focus 12)", async () => {
    const correr: Correr = async () => ({ codigo: null, stdout: "", vencido: false, ausente: true });
    let t = 0; const archivo = memoria("archivo");
    const g = crearGuardado({ env: {}, llavero: almacenDeLinux(correr), archivo, rutaDelArchivo: RUTA, fs: sinEnlaces(), ahora: () => ++t, avisar: () => {} });
    await g.guardarPendiente(PROD, { deviceCode: "e".repeat(64), userCode: "BCDF-GHJK", verificationUriComplete: "u", venceEn: 9, intervaloS: 5, ultimoSondeoEn: null });
    expect(await g.guardarClave(PROD, A)).toEqual({ donde: "archivo" });
    expect(await g.borrarPendiente(PROD)).toBe(true);
    expect(await g.leerClave(PROD)).toEqual({ clave: A, fuente: "archivo" });
    await expect(g.borrarClave(PROD)).resolves.toBeUndefined();
    expect(await g.leerClave(PROD)).toBeNull();
  });
  it("borrarPendiente no lanza aunque el llavero presente falle", async () => {
    const { g, llavero } = armar();
    await g.guardarPendiente(PROD, { deviceCode: "e".repeat(64), userCode: "BCDF-GHJK", verificationUriComplete: "u", venceEn: 9, intervaloS: 5, ultimoSondeoEn: null });
    llavero.roto = true;
    expect(await g.borrarPendiente(PROD)).toBe(false);
  });
  it("por revocar: A en el llavero, el llavero cae, B va al archivo, el llavero vuelve → [A, B] (Review Focus 15)", async () => {
    const { g, llavero } = armar();
    await g.anotarPorRevocar(PROD, A);
    llavero.roto = true;
    await g.anotarPorRevocar(PROD, B);
    expect(await g.leerPorRevocar(PROD)).toEqual({ claves: [B], completa: false });
    llavero.roto = false;
    expect((await g.leerPorRevocar(PROD)).claves.sort()).toEqual([A, B].sort());
  });
  it("por revocar: quitar con el llavero caído no es completo", async () => {
    const { g, llavero } = armar();
    await g.anotarPorRevocar(PROD, A);
    llavero.roto = true;
    expect(await g.quitarPorRevocar(PROD, A)).toEqual({ completo: false });
  });
  it("por revocar: se anota, se lee y se quita, aparte de la clave", async () => {
    const { g } = armar();
    await g.guardarClave(PROD, B);
    await g.anotarPorRevocar(PROD, A);
    expect(await g.leerPorRevocar(PROD)).toEqual({ claves: [A], completa: true });
    await g.quitarPorRevocar(PROD, A);
    expect(await g.leerPorRevocar(PROD)).toEqual({ claves: [], completa: true });
    expect(await g.leerClave(PROD)).toEqual({ clave: B, fuente: "llavero" });
  });
});

// Un Linux de mentira que sí tiene `secret-tool`: el llavero comprueba la ruta absoluta antes de llamar.
const almacenDeLinux = (correr: Correr) => almacenDeLlavero("linux", correr, (r) => r === "/usr/bin/secret-tool");

describe("almacenDeLlavero", () => {
  it("macOS: el secreto viaja por stdin, nunca en los argumentos", async () => {
    const llamadas: { bin: string; args: string[]; stdin: string | null }[] = [];
    const correr: Correr = async (bin, args, stdin) => { llamadas.push({ bin, args, stdin }); return { codigo: 0, stdout: "", vencido: false }; };
    await almacenDeLlavero("darwin", correr)!.escribir(PROD, { valor: A, escritoEn: 1 });
    expect(llamadas[0]!.bin).toBe("/usr/bin/security");
    expect(llamadas[0]!.args).toEqual(["-i"]);
    expect(llamadas[0]!.args.join(" ")).not.toContain(A);
    expect(llamadas[0]!.stdin).toContain("add-generic-password");
  });
  it("un llavero que se cuelga vence el techo y se trata como falla (Review Focus 2)", async () => {
    const techos: number[] = [];
    const correr: Correr = async (_b, _a, _s, techo) => { techos.push(techo); return { codigo: null, stdout: "", vencido: true }; };
    await expect(almacenDeLinux(correr)!.escribir(PROD, { valor: A, escritoEn: 1 })).rejects.toThrow();
    expect(techos[0]).toBe(TECHO_DEL_LLAVERO_MS);
  });
  it("Windows no tiene llavero soportado", () => {
    expect(almacenDeLlavero("win32", async () => ({ codigo: 0, stdout: "", vencido: false }))).toBeNull();
  });
  it("macOS: lo que se escribe se lee igual (ida y vuelta por base64url)", async () => {
    let guardado = "";
    const correr: Correr = async (_b, args, stdin) => {
      if (args[0] === "-i") { guardado = /-w (\S+)/.exec(stdin!)![1]!; return { codigo: 0, stdout: "", vencido: false }; }
      return { codigo: 0, stdout: guardado + "\n", vencido: false };
    };
    const ll = almacenDeLlavero("darwin", correr)!;
    await ll.escribir(PROD, { valor: A, escritoEn: 7 });
    expect(await ll.leer(PROD)).toEqual({ valor: A, escritoEn: 7 });
  });
});

describe("almacenDeArchivo", () => {
  function fsQueAnota(inicial: string | null = null) {
    const ops: string[] = []; let contenido = inicial;
    const fs = {
      leer: () => contenido,
      crearDir: (p: string, m: number) => { ops.push(`dir ${p} ${m.toString(8)}`); },
      chmod: (p: string, m: number) => { ops.push(`chmod ${p} ${m.toString(8)}`); },
      borrarSiExiste: (p: string) => { ops.push(`borrar ${p}`); },
      escribirExclusivo: (p: string, s: string, m: number) => { ops.push(`exclusivo ${p} ${m.toString(8)}`); contenido = s; },
      renombrar: (a: string, b: string) => { ops.push(`renombrar ${a} ${b}`); },
      realpath: (p: string) => p, existe: () => false,
    };
    return { fs, ops };
  }
  it("dir 0700 forzado, .tmp viejo borrado, temporal exclusivo 0600, renombrado (Review Focus 6)", async () => {
    const { fs, ops } = fsQueAnota();
    await almacenDeArchivo("/h/.config/supcoflow/credenciales.json", fs).escribir(PROD, { valor: A, escritoEn: 1 });
    expect(ops).toEqual([
      "dir /h/.config/supcoflow 700",
      "chmod /h/.config/supcoflow 700",
      "borrar /h/.config/supcoflow/credenciales.json.tmp",
      "exclusivo /h/.config/supcoflow/credenciales.json.tmp 600",
      "renombrar /h/.config/supcoflow/credenciales.json.tmp /h/.config/supcoflow/credenciales.json",
    ]);
  });
});

// Lo que el brief pide en prosa y los tests de arriba no pinzan.
describe("reglas en prosa", () => {
  const registrador = (vistas: { bin: string; args: string[]; stdin: string | null; techo: number }[], resp: (args: string[]) => Awaited<ReturnType<Correr>>): Correr =>
    async (bin, args, stdin, techo) => { vistas.push({ bin, args, stdin, techo }); return resp(args); };

  it("rutaReal: un enlace en un tramo intermedio se resuelve y se le suman los segmentos que faltan", () => {
    const fs = {
      existe: (p: string) => ["/", "/home", "/home/a", "/home/a/.config", "/home/a/.config/supcoflow"].includes(p),
      realpath: (p: string) => p.replace(/^\/home\/a\/\.config/, "/srv/dot/config"),
    };
    expect(rutaReal("/home/a/.config/supcoflow/nuevo/credenciales.json", fs)).toBe("/srv/dot/config/supcoflow/nuevo/credenciales.json");
  });
  it("dentroDeUnWorkingTree: el enlace es la carpeta supcoflow misma, apuntando adentro de un repo", () => {
    const fs = {
      existe: (p: string) => ["/home/a/.config/supcoflow", "/w/dotfiles/.git"].includes(p),
      realpath: (p: string) => (p === "/home/a/.config/supcoflow" ? "/w/dotfiles/supcoflow" : p),
    };
    expect(dentroDeUnWorkingTree("/home/a/.config/supcoflow", fs)).toBe("/w/dotfiles");
  });
  it("sin llavero y con ~/.config enlazado a un repo: no escribe nada", async () => {
    const fs = {
      existe: (p: string) => ["/home/a/.config", "/home/a/dotfiles/.git"].includes(p),
      realpath: (p: string) => (p === "/home/a/.config" ? "/home/a/dotfiles/config" : p),
    };
    const { g, archivo } = armar({ llavero: null, fs: fs as ReturnType<typeof sinEnlaces> });
    await expect(g.guardarClave(PROD, A)).rejects.toMatchObject({ codigo: 1, error: "destino_dentro_de_un_repo" });
    expect(archivo.datos.size).toBe(0);
  });
  it("Linux: el secreto viaja por stdin, nunca en los argumentos", async () => {
    const vistas: { bin: string; args: string[]; stdin: string | null; techo: number }[] = [];
    await almacenDeLinux(registrador(vistas, () => ({ codigo: 0, stdout: "", vencido: false })))!.escribir(PROD, { valor: A, escritoEn: 1 });
    expect(vistas[0]!.bin).toBe("/usr/bin/secret-tool");
    expect(vistas[0]!.args).toEqual(["store", "--label=Supcoflow", "servicio", "supcoflow", "cuenta", PROD]);
    expect(vistas[0]!.stdin).not.toBeNull();
    const b64 = Buffer.from(A).toString("base64url");
    expect(vistas.flatMap((v) => v.args).join(" ")).not.toContain(A);
    expect(vistas.flatMap((v) => v.args).join(" ")).not.toContain(b64.slice(0, 20));
  });
  it("macOS: no encontrado (44) es null al leer y nada al borrar; otro código lanza", async () => {
    const ll = almacenDeLlavero("darwin", async () => ({ codigo: 44, stdout: "", vencido: false }))!;
    expect(await ll.leer(PROD)).toBeNull();
    await expect(ll.borrar(PROD)).resolves.toBeUndefined();
    const roto = almacenDeLlavero("darwin", async () => ({ codigo: 51, stdout: "", vencido: false }))!;
    await expect(roto.leer(PROD)).rejects.toThrow();
    await expect(roto.borrar(PROD)).rejects.toThrow();
  });
  it("Linux: secret-tool se busca por ruta absoluta, nunca por el PATH, y sin ninguna es AUSENTE", async () => {
    const vistas: string[] = [];
    const correr: Correr = async (bin) => { vistas.push(bin); return { codigo: 0, stdout: "", vencido: false }; };
    const consultadas: string[] = [];
    const sin = almacenDeLlavero("linux", correr, (r) => { consultadas.push(r); return false; })!;
    await expect(sin.leer(PROD)).rejects.toBeInstanceOf(LlaveroAusente);
    expect(vistas).toEqual([]);
    expect(consultadas).toEqual(["/usr/bin/secret-tool", "/bin/secret-tool", "/usr/local/bin/secret-tool"]);
    const ultima = almacenDeLlavero("linux", correr, (r) => r === "/usr/local/bin/secret-tool")!;
    await ultima.borrar(PROD);
    expect(vistas).toEqual(["/usr/local/bin/secret-tool"]);
  });
  it("Linux: código 1 sin salida es no encontrado; ausente lanza LlaveroAusente", async () => {
    const ll = almacenDeLinux(async () => ({ codigo: 1, stdout: "", vencido: false }))!;
    expect(await ll.leer(PROD)).toBeNull();
    await expect(ll.borrar(PROD)).resolves.toBeUndefined();
    const sin = almacenDeLinux(async () => ({ codigo: null, stdout: "", vencido: false, ausente: true }))!;
    await expect(sin.leer(PROD)).rejects.toBeInstanceOf(LlaveroAusente);
  });
  it("las cuentas: la clave es el origen, el pendiente y la lista por revocar llevan sufijo", async () => {
    const { g, llavero } = armar();
    await g.guardarClave(PROD, A);
    await g.guardarPendiente(PROD, { deviceCode: "e".repeat(64), userCode: "BCDF-GHJK", verificationUriComplete: "u", venceEn: 9, intervaloS: 5, ultimoSondeoEn: null });
    await g.anotarPorRevocar(PROD, B);
    expect([...llavero!.datos.keys()].sort()).toEqual([PROD, `${PROD}#pendiente`, `${PROD}#por_revocar`].sort());
    expect(await g.leerPendiente(PROD)).toMatchObject({ userCode: "BCDF-GHJK", ultimoSondeoEn: null });
  });
  it("escribir en el llavero limpia la misma cuenta del archivo", async () => {
    const { g, llavero, archivo } = armar();
    llavero!.roto = true;
    await g.guardarClave(PROD, A);
    expect(archivo.datos.has(PROD)).toBe(true);
    llavero!.roto = false;
    await g.guardarClave(PROD, B);
    expect(archivo.datos.has(PROD)).toBe(false);
  });
  it("un llavero que acaba de fallar no se vuelve a esperar para limpiar", async () => {
    const vistas: { bin: string; args: string[]; stdin: string | null; techo: number }[] = [];
    let t = 0; const archivo = memoria("archivo");
    const llavero = almacenDeLinux(registrador(vistas, () => ({ codigo: null, stdout: "", vencido: true })));
    const g = crearGuardado({ env: {}, llavero, archivo, rutaDelArchivo: RUTA, fs: sinEnlaces(), ahora: () => ++t, avisar: () => {} });
    expect(await g.guardarClave(PROD, A)).toEqual({ donde: "archivo" });
    expect(vistas.length).toBe(1);
  });
  it("el techo es de la operación entera: las llamadas al llavero se reparten un solo plazo (Review Focus 10)", async () => {
    const vistas: { bin: string; args: string[]; stdin: string | null; techo: number }[] = [];
    let t = 0; const archivo = memoria("archivo");
    // Cada llamada al reloj avanza 1 s: el plazo que le queda a la segunda llamada es menor.
    const llavero = almacenDeLinux(registrador(vistas, (args) => ({ codigo: args[0] === "lookup" ? 1 : 0, stdout: "", vencido: false })));
    const g = crearGuardado({ env: {}, llavero, archivo, rutaDelArchivo: RUTA, fs: sinEnlaces(), ahora: () => (t += 1_000), avisar: () => {} });
    await g.anotarPorRevocar(PROD, A, 4_000);
    expect(vistas.map((v) => v.args[0])).toEqual(["lookup", "store"]);
    expect(vistas[0]!.techo).toBeLessThanOrEqual(4_000);
    expect(vistas[1]!.techo).toBeLessThan(vistas[0]!.techo);
    expect(vistas.every((v) => v.techo > 0)).toBe(true);
  });
  it("un plazo agotado no llama al llavero: cae al archivo", async () => {
    const vistas: { bin: string; args: string[]; stdin: string | null; techo: number }[] = [];
    let t = 0; const archivo = memoria("archivo");
    const llavero = almacenDeLinux(registrador(vistas, () => ({ codigo: 0, stdout: "", vencido: false })));
    const g = crearGuardado({ env: {}, llavero, archivo, rutaDelArchivo: RUTA, fs: sinEnlaces(), ahora: () => (t += 10_000), avisar: () => {} });
    expect(await g.guardarClave(PROD, A, 5_000)).toEqual({ donde: "archivo" });
    expect(vistas.length).toBe(0);
  });
  it("leerPorRevocar con el llavero AUSENTE es completa (ausente no es fallido, Review Focus 12)", async () => {
    let t = 0; const archivo = memoria("archivo");
    const llavero = almacenDeLinux(async () => ({ codigo: null, stdout: "", vencido: false, ausente: true }));
    const g = crearGuardado({ env: {}, llavero, archivo, rutaDelArchivo: RUTA, fs: sinEnlaces(), ahora: () => ++t, avisar: () => {} });
    await g.anotarPorRevocar(PROD, A);
    expect(await g.leerPorRevocar(PROD)).toEqual({ claves: [A], completa: true });
    expect(await g.quitarPorRevocar(PROD, A)).toEqual({ completo: true });
  });
  it("anotarPorRevocar no pisa la lista del otro almacén", async () => {
    const { g, llavero, archivo } = armar();
    llavero!.roto = true;
    await g.anotarPorRevocar(PROD, A); // al archivo
    llavero!.roto = false;
    await g.anotarPorRevocar(PROD, B); // al llavero, sin tocar la del archivo
    expect(JSON.parse(archivo.datos.get(`${PROD}#por_revocar`)!.valor)).toEqual([A]);
    expect(JSON.parse(llavero!.datos.get(`${PROD}#por_revocar`)!.valor)).toEqual([B]);
    expect((await g.leerPorRevocar(PROD)).claves.sort()).toEqual([A, B].sort());
  });
  it("anotarPorRevocar lanza si no puede escribir en ninguno", async () => {
    const { g, llavero, archivo } = armar();
    llavero!.roto = true; archivo.roto = true;
    await expect(g.anotarPorRevocar(PROD, A)).rejects.toThrow();
  });
  it("el aviso y los errores nunca llevan la clave", async () => {
    const { g, avisos } = armar({ llavero: null });
    await g.guardarClave(PROD, A);
    await g.anotarPorRevocar(PROD, B);
    expect(avisos.join("\n")).not.toContain(A);
    expect(avisos.join("\n")).not.toContain(B);
  });
});

describe("almacenDeArchivo: ida y vuelta", () => {
  function fsEnMemoria() {
    const archivos = new Map<string, string>();
    const fs: FsMinimo = {
      leer: (p) => archivos.get(p) ?? null,
      crearDir: () => {}, chmod: () => {},
      borrarSiExiste: (p) => { archivos.delete(p); },
      escribirExclusivo: (p, s) => { if (archivos.has(p)) throw new Error("EEXIST"); archivos.set(p, s); },
      renombrar: (a, b) => { archivos.set(b, archivos.get(a)!); archivos.delete(a); },
      realpath: (p) => p, existe: (p) => archivos.has(p),
    };
    return { fs, archivos };
  }
  it("guarda varias cuentas en un JSON y borra una sin tocar las otras", async () => {
    const { fs, archivos } = fsEnMemoria();
    const a = almacenDeArchivo("/h/c.json", fs);
    await a.escribir(PROD, { valor: A, escritoEn: 1 });
    await a.escribir(LOCAL, { valor: B, escritoEn: 2 });
    await a.borrar(PROD);
    await a.borrar("https://nunca.estuvo");
    expect(await a.leer(PROD)).toBeNull();
    expect(await a.leer(LOCAL)).toEqual({ valor: B, escritoEn: 2 });
    expect(archivos.has("/h/c.json.tmp")).toBe(false);
  });
  it("un archivo corrupto es un fallo, no un vacío", async () => {
    const { fs, archivos } = fsEnMemoria();
    archivos.set("/h/c.json", "{no es json");
    await expect(almacenDeArchivo("/h/c.json", fs).leer(PROD)).rejects.toThrow();
  });
});

// Una lectura que no respondió no es «no hay clave» (Review Focus 12): con la clave A en un llavero
// bloqueado, decir «no hay» deja que un login la pise sin revocarla, viva y olvidada en el motor.
describe("leerClaveGuardadaCompleta: ausente no es fallido", () => {
  it("llavero caído y archivo vacío → sin valor e INCOMPLETA", async () => {
    const { g, llavero } = armar();
    await g.guardarClave(PROD, A);
    llavero!.roto = true;
    expect(await g.leerClaveGuardadaCompleta(PROD)).toEqual({ valor: null, completa: false });
    // La de siempre no cambia: sigue diciendo null.
    expect(await g.leerClaveGuardada(PROD)).toBeNull();
  });
  it("llavero caído y B en el archivo → B, pero incompleta (no se sabe si hay una más nueva)", async () => {
    const { g, llavero, archivo } = armar();
    archivo.datos.set(PROD, { valor: B, escritoEn: 5 });
    llavero!.roto = true;
    expect(await g.leerClaveGuardadaCompleta(PROD)).toEqual({ valor: { clave: B, fuente: "archivo" }, completa: false });
  });
  it("sin llavero (null) o con el binario AUSENTE es completa", async () => {
    const sinLl = armar({ llavero: null });
    expect(await sinLl.g.leerClaveGuardadaCompleta(PROD)).toEqual({ valor: null, completa: true });
    let t = 0;
    const g = crearGuardado({
      env: {}, llavero: almacenDeLinux(async () => ({ codigo: null, stdout: "", vencido: false, ausente: true })),
      archivo: memoria("archivo"), rutaDelArchivo: RUTA, fs: sinEnlaces(), ahora: () => ++t, avisar: () => {},
    });
    expect(await g.leerClaveGuardadaCompleta(PROD)).toEqual({ valor: null, completa: true });
  });
  it("los dos responden → completa, y gana el escritoEn más alto", async () => {
    const { g, llavero, archivo } = armar();
    llavero!.datos.set(PROD, { valor: A, escritoEn: 1 });
    archivo.datos.set(PROD, { valor: B, escritoEn: 2 });
    expect(await g.leerClaveGuardadaCompleta(PROD)).toEqual({ valor: { clave: B, fuente: "archivo" }, completa: true });
  });
  it("un archivo que no se entiende también deja la lectura incompleta", async () => {
    const { g, archivo } = armar();
    archivo.leer = async () => { throw new Error("No entiendo el archivo"); };
    expect(await g.leerClaveGuardadaCompleta(PROD)).toEqual({ valor: null, completa: false });
  });
  it("leerClaveCompleta: SUPCOFLOW_TOKEN manda, completa y sin tocar los almacenes", async () => {
    const { g, llavero } = armar({ env: { SUPCOFLOW_TOKEN: A } });
    llavero!.roto = true;
    expect(await g.leerClaveCompleta(PROD)).toEqual({ valor: { clave: A, fuente: "env" }, completa: true });
    const sin = armar();
    sin.llavero!.roto = true;
    expect(await sin.g.leerClaveCompleta(PROD)).toEqual({ valor: null, completa: false });
  });
  it("borrarClaveDe borra SÓLO del almacén pedido", async () => {
    const { g, llavero, archivo } = armar();
    llavero!.datos.set(PROD, { valor: A, escritoEn: 1 });
    archivo.datos.set(PROD, { valor: B, escritoEn: 2 });
    await g.borrarClaveDe(PROD, "archivo");
    expect(archivo.datos.has(PROD)).toBe(false);
    expect(llavero!.datos.get(PROD)?.valor).toBe(A);
    llavero!.roto = true;
    await expect(g.borrarClaveDe(PROD, "llavero")).rejects.toMatchObject({ error: "no_se_pudo_borrar" });
  });
});

// `secret-tool` sale 1 sin salida tanto si no encuentra nada como si no hay D-Bus o el anillo está
// bloqueado; lo que los separa es stderr. Tomar la segunda por la primera es Review Focus 12 al revés.
describe("Linux: «no encontrado» exige stderr vacío", () => {
  const sinBus = "Cannot autolaunch D-Bus without X11 $DISPLAY";
  it("código 1 con stderr vacío o ausente → no encontrado", async () => {
    for (const stderr of [undefined, "", "  \n"]) {
      const ll = almacenDeLinux(async () => ({ codigo: 1, stdout: "", stderr, vencido: false }))!;
      expect(await ll.leer(PROD)).toBeNull();
      await expect(ll.borrar(PROD)).resolves.toBeUndefined();
    }
  });
  it("código 1 con stderr de D-Bus → falla al leer y al borrar, sin el stderr en el mensaje", async () => {
    const ll = almacenDeLinux(async () => ({ codigo: 1, stdout: "", stderr: sinBus, vencido: false }))!;
    await expect(ll.leer(PROD)).rejects.toThrow();
    await expect(ll.borrar(PROD)).rejects.toThrow();
    await ll.leer(PROD).catch((e: Error) => {
      expect(e).not.toBeInstanceOf(LlaveroAusente);
      expect(e.message).not.toContain("D-Bus");
    });
  });
  it("en el guardado: la lista por revocar queda incompleta y borrar la clave lanza no_se_pudo_borrar", async () => {
    let t = 0; const archivo = memoria("archivo");
    const llavero = almacenDeLinux(async () => ({ codigo: 1, stdout: "", stderr: sinBus, vencido: false }));
    const g = crearGuardado({ env: {}, llavero, archivo, rutaDelArchivo: RUTA, fs: sinEnlaces(), ahora: () => ++t, avisar: () => {} });
    expect(await g.leerPorRevocar(PROD)).toEqual({ claves: [], completa: false });
    expect(await g.leerClaveGuardadaCompleta(PROD)).toEqual({ valor: null, completa: false });
    await expect(g.borrarClave(PROD)).rejects.toMatchObject({ error: "no_se_pudo_borrar" });
  });
  it("macOS no cambia: 44 es no encontrado aunque haya stderr", async () => {
    const ll = almacenDeLlavero("darwin", async () => ({ codigo: 44, stdout: "", stderr: "could not be found", vencido: false }))!;
    expect(await ll.leer(PROD)).toBeNull();
  });
});
