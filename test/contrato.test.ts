import { describe, expect, it } from "vitest";
import { emitir, FalloDeLaTerminal, resultadoDeFallo, SALIDA, taparSecretos } from "../src/contrato.ts";

const CLAVE = `scf_${"a".repeat(16)}_${"b".repeat(64)}`;

describe("el contrato de salida (§13)", () => {
  it("con --json sale UNA línea de JSON", () => {
    const vistos: string[] = [];
    emitir({ codigo: 0, json: { ok: true, a: "x\ny" }, texto: "hola" }, true, (s) => vistos.push(s));
    expect(vistos).toHaveLength(1);
    expect(vistos[0]!.trimEnd().split("\n")).toHaveLength(1);
    expect(JSON.parse(vistos[0]!)).toEqual({ ok: true, a: "x\ny" });
  });
  it("un fallo conocido conserva su código y su error", () => {
    const r = resultadoDeFallo(new FalloDeLaTerminal(SALIDA.faltaLogin, "sin_sesion", "Iniciá sesión."));
    expect(r.codigo).toBe(2);
    expect(r.json).toEqual({ ok: false, error: "sin_sesion", message: "Iniciá sesión." });
  });
  it("un error cualquiera es 1 y nunca filtra una clave ni un device_code", () => {
    const r = resultadoDeFallo(new Error(`falló con ${CLAVE} y ${"c".repeat(64)}`));
    expect(r.codigo).toBe(1);
    expect(JSON.stringify(r)).not.toContain(CLAVE);
    expect(JSON.stringify(r)).not.toContain("c".repeat(64));
  });
  it("taparSecretos deja el resto del texto", () => {
    expect(taparSecretos(`x ${CLAVE} y`)).toBe("x scf_… y");
  });
});
