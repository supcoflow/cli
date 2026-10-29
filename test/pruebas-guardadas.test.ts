import { describe, expect, it } from "vitest";
import { FalloDeLaTerminal } from "../src/contrato.ts";
import type { Almacen, Registro } from "../src/guardado/index.ts";
import { SinProteccionDeGit } from "../src/guardado/protegido.ts";
import { crearRegistroDePruebas } from "../src/pruebas-guardadas.ts";

function memoria(o: { escribirLanza?: (valor: string) => boolean; leerLanza?: boolean } = {}): Almacen & { datos: Map<string, Registro> } {
  const datos = new Map<string, Registro>();
  return {
    nombre: "archivo", datos,
    async leer(c) { if (o.leerLanza) throw new Error("ilegible"); return datos.get(c) ?? null; },
    async escribir(c, r) { if (o.escribirLanza?.(r.valor)) throw new Error("disco"); datos.set(c, r); },
    async borrar(c) { datos.delete(c); },
  };
}
const armar = (almacen: Almacen, origen = "http://localhost:3000") => crearRegistroDePruebas({
  origen, almacen, rutaDelArchivo: "/h/.config/supcoflow/pruebas.json", ahora: () => 1, avisar: () => {},
});
const INTENTO = { clave: "k-1", mensaje: null, techoUsd: 2, politicaEsperada: null };

describe("lo guardado de las pruebas (intento + última, por origen y proyecto)", () => {
  it("vacío al principio; abrir guarda el intento ENTERO; confirmar deja la última y cierra el intento en una sola escritura", async () => {
    const m = memoria();
    const r = armar(m);
    expect(await r.leer("proj_1")).toEqual({ intento: null, ultima: null });
    await r.abrir("proj_1", INTENTO);
    expect(await r.leer("proj_1")).toEqual({ intento: INTENTO, ultima: null });
    await r.confirmar("proj_1", "prb_0123456789abcdef");
    expect(await r.leer("proj_1")).toEqual({ intento: null, ultima: "prb_0123456789abcdef" });
    expect(await r.leer("proj_2")).toEqual({ intento: null, ultima: null });
  });

  it("descartar cierra el intento sin tocar la última", async () => {
    const r = armar(memoria());
    await r.abrir("proj_1", INTENTO);
    await r.confirmar("proj_1", "prb_aaaaaaaaaaaaaaaa");
    await r.abrir("proj_1", { ...INTENTO, clave: "k-2" });
    await r.descartar("proj_1");
    expect(await r.leer("proj_1")).toEqual({ intento: null, ultima: "prb_aaaaaaaaaaaaaaaa" });
  });

  it("separa por origen: lo pedido contra un motor local no existe para producción", async () => {
    const m = memoria();
    await armar(m, "http://127.0.0.1:4555").abrir("proj_1", INTENTO);
    expect(await armar(m, "https://app.supcoflow.dev").leer("proj_1")).toEqual({ intento: null, ultima: null });
  });

  it("estricto: un almacén que git no deja proteger no guarda y lanza con lo que hay que hacer; un disco que falla lanza", async () => {
    const m = memoria({ escribirLanza: () => { throw new SinProteccionDeGit({ codigo: "git_lo_sigue", detalle: "Git tracks /h/.config/supcoflow/pruebas.json in the repo /h. Take it out of the repo with `git -C /h rm --cached -- .config/supcoflow/pruebas.json` or have git ignore it." }); } });
    await expect(armar(m).abrir("proj_1", INTENTO)).rejects.toMatchObject({
      error: "prueba_no_guardada", codigo: 1,
      message: expect.stringMatching(/^I'm not saving the test request in \/h\/.config\/supcoflow\/pruebas.json; without saving it I won't send it\. Git tracks .*git -C \/h rm --cached/),
    });
    expect(m.datos.size).toBe(0);
    await expect(armar(memoria({ escribirLanza: () => true })).abrir("proj_1", INTENTO)).rejects.toBeInstanceOf(FalloDeLaTerminal);
  });

  it("si confirmar falla, el intento sigue abierto (R14d)", async () => {
    let romper = false;
    const m = memoria({ escribirLanza: () => romper });
    const r = armar(m);
    await r.abrir("proj_1", INTENTO);
    romper = true;
    await expect(r.confirmar("proj_1", "prb_0123456789abcdef")).rejects.toMatchObject({ error: "prueba_no_guardada" });
    romper = false;
    expect(await r.leer("proj_1")).toEqual({ intento: INTENTO, ultima: null });
  });

  it("la política esperada se guarda con el intento y vuelve igual; un intento de la 0.7.0 (sin ella) vuelve con null", async () => {
    const m = memoria();
    const r = armar(m);
    await r.abrir("proj_1", { ...INTENTO, politicaEsperada: "guardar" });
    expect((await r.leer("proj_1")).intento).toEqual({ ...INTENTO, politicaEsperada: "guardar" });
    m.datos.set("http://localhost:3000#prueba#proj_2", { valor: JSON.stringify({ intento: { clave: "k-9", mensaje: null, techo_usd: 2 }, ultima: null }), escritoEn: 1 });
    expect((await r.leer("proj_2")).intento).toEqual({ clave: "k-9", mensaje: null, techoUsd: 2, politicaEsperada: null });
    m.datos.set("http://localhost:3000#prueba#proj_3", { valor: JSON.stringify({ intento: { clave: "k-9", mensaje: null, techo_usd: 2, politica_esperada: "otra" }, ultima: null }), escritoEn: 1 });
    await expect(r.leer("proj_3")).rejects.toMatchObject({ error: "prueba_no_guardada" });
  });
  it("un archivo que no se lee no es «no hay intento»: lanza", async () => {
    await expect(armar(memoria({ leerLanza: true })).leer("proj_1")).rejects.toMatchObject({ error: "prueba_no_guardada", message: expect.stringMatching(/^I couldn.t read \/h\/.config\/supcoflow\/pruebas.json; without that, a retry could ask for another test/) });
    await expect(armar(memoria({ leerLanza: true })).leer("proj_1")).rejects.toMatchObject({ error: "prueba_no_guardada" });
  });

  it("un registro con otra forma tampoco es «vacío»: lanza", async () => {
    const m = memoria();
    m.datos.set("http://localhost:3000#prueba#proj_1", { valor: "{\"intento\": 3}", escritoEn: 1 });
    await expect(armar(m).leer("proj_1")).rejects.toMatchObject({ error: "prueba_no_guardada" });
  });
});
