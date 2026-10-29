// Las piezas reales de src/entorno.ts que no son el archivo: el `Correr` que habla con el llavero
// (probado con hijos inofensivos, NUNCA con `security`), las perillas de prueba y lo que se lee y se
// escribe dentro del repo.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ARCHIVO_QUE_NO_SE_LEE, archivosDelRepo, leerArchivoChico, correrReal, entornoReal, TOPE_DEL_ARCHIVO_DEL_REPO } from "../src/entorno.ts";
import { NO_LEIDO } from "../src/lectura.ts";

describe("el Correr real", () => {
  it("mata al hijo en el techo y lo dice", async () => {
    const t0 = Date.now();
    const r = await correrReal("/bin/sleep", ["10"], null, 200);
    expect(r.vencido).toBe(true);
    expect(Date.now() - t0).toBeLessThan(3_000);
  });

  it("un binario que no existe es AUSENTE, no un fallo", async () => {
    const r = await correrReal("/no/existe/security", [], null, 1_000);
    expect(r.ausente).toBe(true);
    expect(r.vencido).toBe(false);
  });

  it("el secreto va por stdin y vuelve el stdout y el código", async () => {
    const r = await correrReal(process.execPath, ["-e", "process.stdin.pipe(process.stdout); process.stdin.on('end', () => process.exitCode = 7)"], "secreto", 5_000);
    expect(r).toMatchObject({ codigo: 7, stdout: "secreto", vencido: false });
  });

  it("el hijo no hereda SUPCOFLOW_TOKEN y sí el PATH", async () => {
    const antes = process.env.SUPCOFLOW_TOKEN;
    process.env.SUPCOFLOW_TOKEN = "scf_secreto";
    try {
      const r = await correrReal(process.execPath, ["-e", "console.log(JSON.stringify(process.env))"], null, 5_000);
      const env = JSON.parse(r.stdout) as Record<string, string>;
      expect(env.SUPCOFLOW_TOKEN).toBeUndefined();
      expect(env.PATH).toBe(process.env.PATH);
    } finally {
      if (antes === undefined) delete process.env.SUPCOFLOW_TOKEN; else process.env.SUPCOFLOW_TOKEN = antes;
    }
  });

  it("captura el stderr del hijo (para saber si dijo algo), recortado, y no lo pone en el stdout", async () => {
    const r = await correrReal(process.execPath, ["-e", "process.stderr.write('Cannot autolaunch D-Bus ' + 'x'.repeat(10000)); process.exitCode = 1"], null, 5_000);
    expect(r).toMatchObject({ codigo: 1, stdout: "", vencido: false });
    expect(r.stderr).toContain("Cannot autolaunch D-Bus");
    expect(r.stderr!.length).toBeLessThanOrEqual(2_048);
    // Y el llavero que lo recibe no lo repite en su error.
    const { almacenDeLlavero } = await import("../src/guardado/llavero.ts");
    const ll = almacenDeLlavero("linux", (_b, _a, s, t) => correrReal(process.execPath, ["-e", "process.stderr.write('Cannot autolaunch D-Bus'); process.exitCode = 1"], s, t), (x) => x === "/usr/bin/secret-tool")!;
    const e = await ll.leer("https://app.supcoflow.dev").then(() => null, (x: Error) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e!.message).not.toContain("D-Bus");
  });

  it("sin stdin, el hijo ve el fin enseguida y no se cuelga esperándolo", async () => {
    const r = await correrReal(process.execPath, ["-e", "process.stdin.resume(); process.stdin.on('end', () => console.log('fin'))"], null, 5_000);
    expect(r).toMatchObject({ codigo: 0, stdout: "fin\n", vencido: false });
  });
});

describe("las perillas de prueba", () => {
  it("contra localhost, SUPCOFLOW_SIN_LLAVERO y SUPCOFLOW_TRAMO_MS valen", () => {
    const e = entornoReal({ SUPCOFLOW_API_URL: "http://127.0.0.1:4000", SUPCOFLOW_SIN_LLAVERO: "1", SUPCOFLOW_TRAMO_MS: "3000" });
    expect(e.llavero).toBeNull();
    expect(e.login.tramoMs).toBe(3000);
  });

  it("contra producción se ignoran", () => {
    const e = entornoReal({ SUPCOFLOW_SIN_LLAVERO: "1", SUPCOFLOW_TRAMO_MS: "3000" });
    expect(e.api.origin).toBe("https://app.supcoflow.dev");
    expect(e.llavero !== null).toBe(process.platform === "darwin" || process.platform === "linux");
    expect(e.login.tramoMs).toBeUndefined();
  });

  it("ni contra un https que no es producción", () => {
    const e = entornoReal({ SUPCOFLOW_API_URL: "https://otra.example", SUPCOFLOW_SIN_LLAVERO: "1", SUPCOFLOW_TRAMO_MS: "3000" });
    expect(e.login.tramoMs).toBeUndefined();
  });

  it("un tramo fuera de rango no achica ni agranda nada", () => {
    for (const v of ["0", "-5", "abc", "120000", "1.5"]) {
      const e = entornoReal({ SUPCOFLOW_API_URL: "http://localhost:4000", SUPCOFLOW_TRAMO_MS: v });
      expect(e.login.tramoMs).toBeUndefined();
    }
  });

  it("la ruta del archivo sigue a XDG_CONFIG_HOME", () => {
    const e = entornoReal({ XDG_CONFIG_HOME: "/x/conf" });
    expect(e.rutaDelArchivo).toBe("/x/conf/supcoflow/credenciales.json");
  });
});

describe("los archivos del repo (`.supcoflow/proyecto.json`)", () => {
  const nuevo = () => mkdtempSync(join(tmpdir(), "supcoflow-archivos-"));

  it("sin la carpeta o sin el archivo, null; con uno común, su contenido", () => {
    const raiz = nuevo();
    const a = archivosDelRepo(() => {});
    const p = join(raiz, ".supcoflow", "proyecto.json");
    expect(a.leer(p)).toBeNull();
    mkdirSync(join(raiz, ".supcoflow"));
    expect(a.leer(p)).toBeNull();
    writeFileSync(p, '{"id":"proj_x"}');
    expect(a.leer(p)).toBe('{"id":"proj_x"}');
  });

  it("uno más grande que el tope no se lee: devuelve la marca y avisa sin el contenido", () => {
    const raiz = nuevo();
    mkdirSync(join(raiz, ".supcoflow"));
    const p = join(raiz, ".supcoflow", "proyecto.json");
    writeFileSync(p, "x".repeat(TOPE_DEL_ARCHIVO_DEL_REPO + 1));
    const avisos: string[] = [];
    expect(archivosDelRepo((s) => avisos.push(s)).leer(p)).toBe(ARCHIVO_QUE_NO_SE_LEE);
    expect(avisos.join("")).not.toContain("xxx");
  });

  it("escribir crea la carpeta y deja sólo el archivo, sin .tmp", () => {
    const raiz = nuevo();
    const p = join(raiz, ".supcoflow", "proyecto.json");
    archivosDelRepo(() => {}).escribir(p, "{}\n");
    expect(readFileSync(p, "utf8")).toBe("{}\n");
    expect(readdirSync(join(raiz, ".supcoflow"))).toEqual(["proyecto.json"]);
    expect(statSync(p).isFile()).toBe(true);
  });

  it("la clave de idempotencia va a idempotencia.json al lado de las credenciales, 0600", async () => {
    const conf = nuevo();
    const e = entornoReal({ XDG_CONFIG_HOME: conf, SUPCOFLOW_API_URL: "http://127.0.0.1:4000", SUPCOFLOW_SIN_LLAVERO: "1" });
    const k = await e.idempotencia.claveDe("proyecto_crear", "d/r");
    expect(k).toMatch(/^[0-9a-f-]{36}$/);
    const ruta = join(conf, "supcoflow", "idempotencia.json");
    expect(statSync(ruta).mode & 0o777).toBe(0o600);
    expect(statSync(join(conf, "supcoflow")).mode & 0o777).toBe(0o700);
    expect(await e.idempotencia.claveDe("proyecto_crear", "D/R")).toBe(k);
  });
});

describe("leerArchivoChico", () => {
  it("común dentro del tope se lee; más grande, enlace o inexistente dan error", () => {
    const raiz = mkdtempSync(join(tmpdir(), "supcoflow-chico-"));
    const p = join(raiz, "l.png");
    writeFileSync(p, "abc");
    expect(leerArchivoChico(p, 10)).toEqual({ bytes: new Uint8Array([97, 98, 99]) });
    expect(leerArchivoChico(p, 2)).toEqual({ error: NO_LEIDO.demasiadoGrande });
    expect(leerArchivoChico(join(raiz, "no"), 10)).toEqual({ error: NO_LEIDO.noExiste });
    symlinkSync(p, join(raiz, "enlace.png"));
    expect(leerArchivoChico(join(raiz, "enlace.png"), 10)).toEqual({ error: NO_LEIDO.esUnEnlace });
  });
});

describe("el control del contexto está enchufado en TODO comando que actúa sobre el proyecto del repo (1A.1)", () => {
  it("cada grupo de dependencias que pasa por proyectoDelRepo trae el lector del archivo del clon, y `proyecto` además quienSoy", () => {
    const e = entornoReal({ SUPCOFLOW_API_URL: "http://127.0.0.1:4000", SUPCOFLOW_SIN_LLAVERO: "1" });
    for (const grupo of ["configurar", "guia", "claves", "widget", "instalacion", "prueba", "proyecto"] as const) {
      expect(typeof (e[grupo] as { archivos?: { leer?: unknown } }).archivos?.leer, grupo).toBe("function");
    }
    expect(typeof e.proyecto.quienSoy).toBe("function");
  });
});
