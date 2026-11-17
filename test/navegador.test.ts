import { describe, expect, it } from "vitest";
import { crearAbridor, hayDondeAbrir, ordenParaAbrir, urlAbrible } from "../src/navegador.ts";
import { flagQueNoAplica } from "../src/flags-por-comando.ts";
import { leerArgumentos } from "../src/argumentos.ts";

const URL_OK = "https://app.supcoflow.dev/dispositivo?code=BCDF-GHJK";
const base = { env: {} as Record<string, string | undefined>, plataforma: "darwin" as NodeJS.Platform, enContenedor: () => false };

function abridor(o: { env?: Record<string, string | undefined>; plataforma?: NodeJS.Platform; contenedor?: boolean; resultado?: boolean | "lanza" } = {}) {
  const llamadas: { bin: string; args: string[]; env: Record<string, string> }[] = [];
  const abrir = crearAbridor({
    env: o.env ?? {}, plataforma: o.plataforma ?? "darwin", enContenedor: () => o.contenedor ?? false,
    ejecutar: async (bin, args, env) => {
      llamadas.push({ bin, args, env });
      if (o.resultado === "lanza") throw new Error("boom");
      return o.resultado ?? true;
    },
  });
  return { abrir, llamadas };
}

describe("urlAbrible", () => {
  it.each([URL_OK, "http://localhost:3000/conectar/cnx_1", "http://127.0.0.1:3000/x"])("acepta %s", (u) => expect(urlAbrible(u)).toBe(true));
  it.each([
    "", "file:///etc/passwd", "javascript:alert(1)", "http://app.supcoflow.dev/x", "https://u:p@app.supcoflow.dev/x",
    "https://app.supcoflow.dev/x y", "https://app.supcoflow.dev/x\n", "--help", "no es una url", `https://a.dev/${"a".repeat(3000)}`,
  ])("rechaza %j", (u) => expect(urlAbrible(u)).toBe(false));
});

describe("hayDondeAbrir", () => {
  it("macOS y Windows sin nada raro: sí", () => {
    expect(hayDondeAbrir(base)).toBe(true);
    expect(hayDondeAbrir({ ...base, plataforma: "win32" })).toBe(true);
  });
  it.each([
    ["SUPCOFLOW_NO_BROWSER=1", { SUPCOFLOW_NO_BROWSER: "1" }],
    ["CI", { CI: "true" }],
    ["SSH_CONNECTION", { SSH_CONNECTION: "1.2.3.4 1 5.6.7.8 22" }],
    ["SSH_TTY", { SSH_TTY: "/dev/pts/0" }],
  ])("no con %s", (_n, env) => expect(hayDondeAbrir({ ...base, env })).toBe(false));
  it("CI=false o vacío no cuenta como CI", () => {
    expect(hayDondeAbrir({ ...base, env: { CI: "false" } })).toBe(true);
    expect(hayDondeAbrir({ ...base, env: { CI: "" } })).toBe(true);
  });
  it("Linux: hace falta una pantalla y no estar en un contenedor", () => {
    const linux = { ...base, plataforma: "linux" as const };
    expect(hayDondeAbrir(linux)).toBe(false);
    expect(hayDondeAbrir({ ...linux, env: { DISPLAY: ":0" } })).toBe(true);
    expect(hayDondeAbrir({ ...linux, env: { WAYLAND_DISPLAY: "wayland-0" } })).toBe(true);
    expect(hayDondeAbrir({ ...linux, env: { DISPLAY: ":0" }, enContenedor: () => true })).toBe(false);
    expect(hayDondeAbrir({ ...linux, env: { DISPLAY: ":0", container: "podman" } })).toBe(false);
  });
});

describe("ordenParaAbrir: binario y argumentos aparte, nunca un shell", () => {
  it("open, xdg-open y cmd /c start", () => {
    expect(ordenParaAbrir("darwin", URL_OK)).toEqual({ bin: "open", args: [URL_OK] });
    expect(ordenParaAbrir("linux", URL_OK)).toEqual({ bin: "xdg-open", args: [URL_OK] });
    expect(ordenParaAbrir("win32", URL_OK)).toEqual({ bin: "cmd", args: ["/c", "start", "", URL_OK] });
  });
  it("en Windows una URL con metacaracteres de cmd no se abre", () => {
    expect(ordenParaAbrir("win32", "https://a.dev/x?a=1&b=2")).toBeNull();
    expect(ordenParaAbrir("win32", "https://a.dev/%PATH%")).toBeNull();
  });
});

describe("el abridor", () => {
  it("abre con el binario de la plataforma y dice true", async () => {
    const { abrir, llamadas } = abridor();
    expect(await abrir(URL_OK)).toBe(true);
    expect(llamadas).toEqual([{ bin: "open", args: [URL_OK], env: {} }]);
  });
  it("no le pasa al navegador el token ni otras variables del shell", async () => {
    const { abrir, llamadas } = abridor({ env: { SUPCOFLOW_TOKEN: "scf_x", PATH: "/usr/bin", AWS_SECRET_ACCESS_KEY: "z", HOME: "/h" } });
    await abrir(URL_OK);
    expect(llamadas[0]!.env).toEqual({ PATH: "/usr/bin", HOME: "/h" });
  });
  it.each([
    ["con SUPCOFLOW_NO_BROWSER=1", { env: { SUPCOFLOW_NO_BROWSER: "1" } }],
    ["por SSH", { env: { SSH_CONNECTION: "x" } }],
    ["en Linux sin pantalla", { plataforma: "linux" as const }],
    ["si el binario falla", { resultado: false as const }],
    ["si el binario lanza", { resultado: "lanza" as const }],
  ])("false %s", async (_n, o) => {
    const { abrir, llamadas } = abridor(o);
    expect(await abrir(URL_OK)).toBe(false);
    if ("env" in o || "plataforma" in o) expect(llamadas).toEqual([]);
  });
  it("una URL que no es https (o local) no se pasa al sistema", async () => {
    const { abrir, llamadas } = abridor();
    expect(await abrir("file:///etc/passwd")).toBe(false);
    expect(llamadas).toEqual([]);
  });
});

describe("--no-browser", () => {
  it("se lee y vale para login y repo connect", () => {
    expect(leerArgumentos(["login", "--no-browser"]).flags.noBrowser).toBe(true);
    expect(leerArgumentos(["login"]).flags.noBrowser).toBe(false);
    expect(flagQueNoAplica("login", ["noBrowser"])).toBeNull();
    expect(flagQueNoAplica("repo connect", ["noBrowser"])).toBeNull();
  });
  it("en otro comando sale como flag que no aplica", () => {
    expect(flagQueNoAplica("whoami", ["noBrowser"])).toContain("--no-browser");
  });
});
