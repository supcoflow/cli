// La etapa 2c se documenta en el README y en el CHANGELOG («Unreleased»), y no sube la versión: el release lo hace el dueño aparte.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DESCRIPCION } from "../src/comandos/describir.ts";

const leer = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const COMANDOS = ["reports list", "reports show", "reports investigate", "gate status", "gate read", "gate pass", "gate deliver", "gate fail"];

describe("etapa 2c: documentación", () => {
  it("el README nombra cada comando nuevo con su forma, y dice que es de la versión sin publicar", () => {
    const readme = leer("README.md");
    for (const c of COMANDOS) expect(readme, c).toContain(`supcoflow ${c}`);
    expect(readme).toContain("## Reports and the agents' gate");
    expect(readme).toMatch(/Unreleased: not in the published 0\.12\.0/);
  });

  it("el README dice cómo entra la clave del agente y que no se guarda, y deja pendiente el almacén y el listado", () => {
    const readme = leer("README.md");
    expect(readme).toContain("SUPCOFLOW_AGENT_KEY");
    expect(readme).toMatch(/not saved anywhere/);
    expect(readme).toMatch(/`--key`: it would be `flag_desconocido`|there is no `--key`/);
    expect(readme).toMatch(/almacen_url/);
    expect(readme).toMatch(/name that doesn't clash with `agents`/);
    expect(readme).toMatch(/«open anyway»/);
  });

  it("el CHANGELOG lo anota en «Unreleased» (no en 0.12.0) y la versión no se movió", () => {
    const cambios = leer("CHANGELOG.md");
    const sinPublicar = cambios.slice(cambios.indexOf("## Unreleased"), cambios.indexOf("## 0.12.0"));
    for (const c of ["`reports list`", "`reports investigate`", "`gate deliver`", "`gate fail`", "`gate pass`", "SUPCOFLOW_AGENT_KEY".slice(0, 0) + "scf_ag_"]) expect(sinPublicar, c).toContain(c);
    const publicada = cambios.slice(cambios.indexOf("## 0.12.0"));
    expect(publicada).not.toContain("gate deliver");
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
