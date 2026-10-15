// Las piezas reales de src/entorno.ts que no son el archivo: el `Correr` que habla con el llavero
// (probado con hijos inofensivos, NUNCA con `security`) y las perillas de prueba.
import { describe, expect, it } from "vitest";
import { correrReal, entornoReal } from "../src/entorno.ts";

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
