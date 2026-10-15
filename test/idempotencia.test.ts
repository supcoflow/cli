import { expect, it } from "vitest";
import { crearRegistroDeIdempotencia } from "../src/idempotencia.ts";
import type { Almacen, Registro } from "../src/guardado/index.ts";

function memoria(roto = false): Almacen & { datos: Map<string, Registro> } {
  const datos = new Map<string, Registro>();
  return {
    nombre: "archivo", datos,
    async leer(c) { return datos.get(c) ?? null; },
    async escribir(c, r) { if (roto) throw new Error("disco"); datos.set(c, r); },
    async borrar(c) { datos.delete(c); },
  };
}
const fs = { realpath: (p: string) => p, existe: () => false };
let n = 0;
const armar = (almacen = memoria(), existe = fs.existe) => crearRegistroDeIdempotencia({
  origen: "http://localhost:3000", almacen, rutaDelArchivo: "/h/.config/supcoflow/idempotencia.json",
  fs: { ...fs, existe }, generar: () => `k-${++n}`, ahora: () => 1, avisar: () => {},
});

it("la misma operación y repo devuelven la MISMA clave hasta olvidarla (Review Focus 4)", async () => {
  const r = armar();
  const a = await r.claveDe("proyecto_crear", "D/r");
  expect(await r.claveDe("proyecto_crear", "d/r")).toBe(a);
  await r.olvidar("proyecto_crear", "d/r");
  expect(await r.claveDe("proyecto_crear", "d/r")).not.toBe(a);
});
it("si no se puede guardar, avisa y devuelve una igual", async () => {
  expect(await armar(memoria(true)).claveDe("proyecto_crear", "d/r")).toMatch(/^k-/);
});
it("dentro de un repo no escribe nada", async () => {
  const almacen = memoria();
  await armar(almacen, (p) => p === "/h/.git").claveDe("proyecto_crear", "d/r");
  expect(almacen.datos.size).toBe(0);
});
