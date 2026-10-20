import { describe, expect, it } from "vitest";
import { FalloDeLaTerminal } from "../src/contrato.ts";
import type { Almacen, Registro } from "../src/guardado/index.ts";
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
const fs = { realpath: (p: string) => p, existe: () => false };
const armar = (almacen: Almacen, existe = fs.existe, origen = "http://localhost:3000") => crearRegistroDePruebas({
  origen, almacen, rutaDelArchivo: "/h/.config/supcoflow/pruebas.json", fs: { ...fs, existe }, ahora: () => 1, avisar: () => {},
});
const INTENTO = { clave: "k-1", mensaje: null, techoUsd: 2 };

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
    await armar(m, fs.existe, "http://127.0.0.1:4555").abrir("proj_1", INTENTO);
    expect(await armar(m, fs.existe, "https://app.supcoflow.dev").leer("proj_1")).toEqual({ intento: null, ultima: null });
  });

  it("estricto: dentro de un repo no guarda y lanza; un disco que falla lanza", async () => {
    const m = memoria();
    await expect(armar(m, (p) => p === "/h/.git").abrir("proj_1", INTENTO)).rejects.toMatchObject({ error: "prueba_no_guardada" });
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

  it("un archivo que no se lee no es «no hay intento»: lanza", async () => {
    await expect(armar(memoria({ leerLanza: true })).leer("proj_1")).rejects.toMatchObject({ error: "prueba_no_guardada" });
  });

  it("un registro con otra forma tampoco es «vacío»: lanza", async () => {
    const m = memoria();
    m.datos.set("http://localhost:3000#prueba#proj_1", { valor: "{\"intento\": 3}", escritoEn: 1 });
    await expect(armar(m).leer("proj_1")).rejects.toMatchObject({ error: "prueba_no_guardada" });
  });
});
