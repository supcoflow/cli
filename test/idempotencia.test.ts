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
it("M2: si resolver la ruta lanza (un enlace roto en ~/.config), avisa y devuelve una clave igual", async () => {
  const avisos: string[] = [];
  const almacen = memoria();
  const r = crearRegistroDeIdempotencia({
    origen: "http://localhost:3000", almacen, rutaDelArchivo: "/h/.config/supcoflow/idempotencia.json",
    fs: { realpath: () => { throw new Error("ENOENT"); }, existe: () => false },
    generar: () => "k-roto", ahora: () => 1, avisar: (s) => avisos.push(s),
  });
  expect(await r.claveDe("proyecto_crear", "d/r")).toBe("k-roto");
  expect(avisos).toHaveLength(1);
  expect(almacen.datos.size).toBe(0);
});

// ---- Modo estricto (`claves crear`, Review Focus 15) ----
const estricto = (almacen = memoria(), existe = fs.existe, avisos: string[] = []) => crearRegistroDeIdempotencia({
  origen: "http://localhost:3000", almacen, rutaDelArchivo: "/h/.config/supcoflow/idempotencia.json",
  fs: { ...fs, existe }, generar: () => `k-${++n}`, ahora: () => 1, avisar: (s) => avisos.push(s),
});
it("Review Focus 15: estricta + escritura que falla → lanza idempotencia_no_guardada", async () => {
  await expect(estricto(memoria(true)).claveDe("clave_crear", "proj#ci", { estricta: true }))
    .rejects.toMatchObject({ error: "idempotencia_no_guardada", codigo: 1 });
});
it("estricta + destino dentro de un repo, ruta irresoluble o archivo ilegible → lanza igual", async () => {
  await expect(estricto(memoria(), (p) => p === "/h/.git").claveDe("clave_crear", "proj#ci", { estricta: true }))
    .rejects.toMatchObject({ error: "idempotencia_no_guardada", codigo: 1 });
  const irresoluble = crearRegistroDeIdempotencia({
    origen: "http://localhost:3000", almacen: memoria(), rutaDelArchivo: "/h/.config/supcoflow/idempotencia.json",
    fs: { realpath: () => { throw new Error("ENOENT"); }, existe: () => false }, generar: () => "k", ahora: () => 1, avisar: () => {},
  });
  await expect(irresoluble.claveDe("clave_crear", "proj#ci", { estricta: true })).rejects.toMatchObject({ error: "idempotencia_no_guardada" });
  const ilegible = { ...memoria(), async leer(): Promise<never> { throw new Error("no entiendo"); } };
  await expect(estricto(ilegible).claveDe("clave_crear", "proj#ci", { estricta: true })).rejects.toMatchObject({ error: "idempotencia_no_guardada" });
  await expect(estricto(ilegible).tiene("clave_crear", "proj#ci")).rejects.toMatchObject({ error: "idempotencia_no_guardada" });
});
it("estricta + todo sano: guarda; `tiene` dice true; el mismo reintento devuelve la MISMA clave; olvidar → tiene false", async () => {
  const r = estricto();
  const a = await r.claveDe("clave_crear", "proj#ci", { estricta: true });
  expect(await r.tiene("clave_crear", "proj#ci")).toBe(true);
  expect(await r.claveDe("clave_crear", "proj#ci", { estricta: true })).toBe(a);
  await r.olvidar("clave_crear", "proj#ci");
  expect(await r.tiene("clave_crear", "proj#ci")).toBe(false);
});
it("sin estricta, el comportamiento de siempre no cambia (avisa y sigue)", async () => {
  const avisos: string[] = [];
  expect(await estricto(memoria(true), fs.existe, avisos).claveDe("proyecto_crear", "d/r")).toMatch(/^k-/);
  expect(avisos).toHaveLength(1);
});
