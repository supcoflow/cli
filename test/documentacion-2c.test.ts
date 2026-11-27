// La etapa 2c no sube la versión (el release lo hace el dueño aparte), y cada comando nuevo está en `describe`.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DESCRIPCION } from "../src/comandos/describir.ts";

const leer = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const COMANDOS = ["reports list", "reports show", "reports investigate", "gate status", "gate read", "gate pass", "gate deliver", "gate fail"];

describe("etapa 2c: documentación", () => {
  it("la versión no se movió: el release lo hace el dueño aparte", () => {
    expect(JSON.parse(leer("package.json")).version).toBe("0.12.0");
    expect(DESCRIPCION.version).toBe("0.12.0");
  });

  it("cada comando nuevo está en `describe` con sus flags y su código 4, y las facultades lo dicen", () => {
    for (const c of COMANDOS) {
      const d = DESCRIPCION.comandos.find((x) => x.nombre === c)!;
      expect(d, c).toBeDefined();
      expect(d.codigos, c).toContain(4);
      expect(d.ejemplos.length, c).toBeGreaterThan(0);
      expect(d.flags.length, c).toBeGreaterThan(0);
    }
    const gate = DESCRIPCION.comandos.filter((x) => x.nombre.startsWith("gate "));
    for (const c of gate) expect(c.flags.join(" "), c.nombre).not.toContain("--repo");
    for (const c of gate) expect(c.resumen + c.flags.join(" "), c.nombre).toMatch(/SUPCOFLOW_AGENT_KEY|key/);
    expect(DESCRIPCION.facultades.find((f) => f.nombre === "console_only")!.incluye).toMatch(/create or revoke an agent's key/);
    expect(DESCRIPCION.facultades.find((f) => f.nombre === "test")!.incluye).toMatch(/reports investigate/);
  });
});
