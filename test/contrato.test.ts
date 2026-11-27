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

describe("etapa 2c: la clave de un agente y el pase no salen en un texto de afuera", () => {
  const AGENTE = "scf_ag_clainv01_ejemplo-de-clave-de-investigacion-no-real";
  const PASE = "pse_ejemplo0001.ejemplo-de-pase-no-real";
  it("taparSecretos cubre `scf_ag_…` y `pse_…`, también pegados a otro texto", () => {
    expect(taparSecretos(`x ${AGENTE} y`)).toBe("x scf_ag_… y");
    expect(taparSecretos(`la clave ${AGENTE}.`)).toBe("la clave scf_ag_….");
    expect(taparSecretos(`pase ${PASE}, listo`)).toBe("pase pse_…, listo");
    expect(taparSecretos(`${AGENTE}${PASE}`)).not.toMatch(/clainv01|ejemplo0001/);
  });
  it("un error cualquiera con la clave de un agente es 1 y no la filtra", () => {
    const r = resultadoDeFallo(new Error(`falló con ${AGENTE} y ${PASE}`));
    expect(r.codigo).toBe(1);
    expect(JSON.stringify(r)).not.toContain("clainv01");
    expect(JSON.stringify(r)).not.toContain("ejemplo-de-pase");
  });
  it("lo de antes no cambia: la clave de una persona y los 64 hexadecimales siguen tapados", () => {
    expect(taparSecretos(`x ${CLAVE} y`)).toBe("x scf_… y");
    expect(taparSecretos(`d ${"c".repeat(64)}`)).toBe("d [device_code]");
  });
});
