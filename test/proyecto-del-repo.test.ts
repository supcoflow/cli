import { describe, expect, it } from "vitest";
import { proyectoDelRepo } from "../src/comandos/proyecto-del-repo.ts";

const CLAVE = `scf_${"a".repeat(16)}_${"b".repeat(64)}`;
const PROY = { id: "proj_r-1", slug: "r", repo: "d/r", rama: "main", installCommand: "npm ci", testCommand: "npm test" };
const base = {
  api: new URL("http://localhost:3000"),
  guardado: { leerClaveCompleta: async () => ({ valor: { clave: CLAVE, fuente: "llavero" }, completa: true }) } as never,
  git: async (args: string[]) => (args[0] === "rev-parse" ? { codigo: 0, stdout: "/w/r\n" } : { codigo: 0, stdout: "git@github.com:d/r.git\n" }),
  cwd: "/w/r",
};

describe("proyectoDelRepo", () => {
  it("encuentra el proyecto del origin", async () => {
    expect(await proyectoDelRepo({ ...base, buscarProyecto: async () => PROY }, { repo: null })).toEqual({ ok: true, clave: CLAVE, proyecto: PROY });
  });
  it("sin proyecto: 4 sin_proyecto con la pista", async () => {
    const r = await proyectoDelRepo({ ...base, buscarProyecto: async () => null }, { repo: null });
    expect(r).toMatchObject({ ok: false, resultado: { codigo: 4, json: { error: "sin_proyecto" } } });
    if (!r.ok) expect(r.resultado.texto).toContain("supcoflow proyecto crear");
  });
});
