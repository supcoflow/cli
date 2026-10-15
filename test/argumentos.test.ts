import { expect, it } from "vitest";
import { leerArgumentos } from "../src/argumentos.ts";

it("lee comando y flags", () => {
  expect(leerArgumentos(["login", "--start", "--json"])).toEqual({
    comando: "login",
    flags: { json: true, dryRun: false, help: false, start: true, wait: false },
  });
});
it("sin comando es null (se muestra la ayuda)", () => {
  expect(leerArgumentos([]).comando).toBeNull();
});
it("un flag desconocido es entrada inválida (3), no se ignora", () => {
  expect(() => leerArgumentos(["login", "--estart"])).toThrowError(expect.objectContaining({ codigo: 3, error: "flag_desconocido" }));
});
it("acepta `quien-soy` y `--dry-run`", () => {
  expect(leerArgumentos(["logout", "--dry-run"]).flags.dryRun).toBe(true);
});
