import { expect, it } from "vitest";
import { leerArgumentos } from "../src/argumentos.ts";

it("lee comando y flags", () => {
  expect(leerArgumentos(["login", "--start", "--json"])).toEqual({
    comando: "login",
    flags: { json: true, dryRun: false, help: false, start: true, wait: false, repo: null, install: null, test: null },
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
it("un comando de dos palabras", () => {
  expect(leerArgumentos(["repo", "conectar", "--start", "--json"]).comando).toBe("repo conectar");
  expect(leerArgumentos(["proyecto", "crear", "--install", "pnpm i", "--test", "pnpm test"]).flags)
    .toMatchObject({ install: "pnpm i", test: "pnpm test" });
});
it("--repo lleva valor", () => {
  expect(leerArgumentos(["proyecto", "ver", "--repo", "duenio/repo"]).flags.repo).toBe("duenio/repo");
  expect(() => leerArgumentos(["proyecto", "ver", "--repo", ""])).toThrowError(expect.objectContaining({ codigo: 3 }));
});
it("un flag con valor repetido o sin valor es entrada inválida", () => {
  expect(() => leerArgumentos(["proyecto", "ver", "--repo", "a/b", "--repo", "c/d"])).toThrowError(
    expect.objectContaining({ codigo: 3, error: "argumentos_invalidos" }),
  );
  expect(() => leerArgumentos(["proyecto", "ver", "--repo"])).toThrowError(expect.objectContaining({ codigo: 3 }));
});
it("tres posicionales son de más", () => {
  expect(() => leerArgumentos(["repo", "conectar", "ya"])).toThrowError(expect.objectContaining({ codigo: 3, error: "argumentos_de_mas" }));
});
it("una palabra sola de un compuesto queda como comando (el despacho la rechaza)", () => {
  expect(leerArgumentos(["repo"]).comando).toBe("repo");
  expect(leerArgumentos(["repo", "borrar"]).comando).toBe("repo");
});
