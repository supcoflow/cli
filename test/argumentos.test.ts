import { describe, expect, it } from "vitest";
import { leerArgumentos } from "../src/argumentos.ts";

it("lee comando y flags", () => {
  expect(leerArgumentos(["login", "--start", "--json"])).toEqual({
    comando: "login",
    flags: { json: true, dryRun: false, help: false, start: true, wait: false, repo: null, install: null, test: null,
      sitio: null, titulo: null, saludo: null, archivo: null, permitir: null, modo: null, nombre: null, guardarEn: null, id: null, origen: null, tema: [] },
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

describe("flags de configurar", () => {
  it("los comandos nuevos de dos palabras", () => {
    for (const c of ["chat prender", "chat apagar", "chat marca", "chat logo", "sitios agregar", "sitios quitar",
      "datos fijar", "politica fijar", "claves crear", "claves listar", "claves revocar",
      "guia revisar", "guia publicar", "guia ver", "guia usar"]) {
      expect(leerArgumentos(c.split(" ")).comando).toBe(c);
    }
  });
  it("--tema se puede repetir y se junta en orden", () => {
    expect(leerArgumentos(["chat", "marca", "--tema", "acento=#000", "--tema", "fondo=#fff"]).flags.tema).toEqual(["acento=#000", "fondo=#fff"]);
  });
  it("Review Focus 10: --tema vacío o --sitio repetido salen 3", () => {
    expect(() => leerArgumentos(["chat", "marca", "--tema", ""])).toThrowError(expect.objectContaining({ codigo: 3 }));
    expect(() => leerArgumentos(["sitios", "agregar", "--sitio", "https://a", "--sitio", "https://b"])).toThrowError(expect.objectContaining({ codigo: 3 }));
  });
  it("--origen llega como origen, y repetido o vacío sale 3", () => {
    expect(leerArgumentos(["guia", "usar", "--origen", "repo"]).flags.origen).toBe("repo");
    expect(leerArgumentos(["guia", "ver"]).flags.origen).toBeNull();
    expect(() => leerArgumentos(["guia", "usar", "--origen", "repo", "--origen", "agente"])).toThrowError(expect.objectContaining({ codigo: 3 }));
    expect(() => leerArgumentos(["guia", "usar", "--origen", ""])).toThrowError(expect.objectContaining({ codigo: 3 }));
  });
  it("--guardar-en llega como guardarEn", () => {
    expect(leerArgumentos(["claves", "crear", "--guardar-en", "/tmp/k"]).flags.guardarEn).toBe("/tmp/k");
  });
});
