import { expect, it } from "vitest";
import { crearRegistroDeIdempotencia } from "../src/idempotencia.ts";
import type { Almacen, Registro } from "../src/guardado/index.ts";
import { SinProteccionDeGit } from "../src/guardado/protegido.ts";

function memoria(roto = false): Almacen & { datos: Map<string, Registro> } {
  const datos = new Map<string, Registro>();
  return {
    nombre: "archivo", datos,
    async leer(c) { return datos.get(c) ?? null; },
    async escribir(c, r) { if (roto) throw new Error("disco"); datos.set(c, r); },
    async borrar(c) { datos.delete(c); },
  };
}
let n = 0;
const armar = (almacen = memoria()) => crearRegistroDeIdempotencia({
  origen: "http://localhost:3000", almacen, rutaDelArchivo: "/h/.config/supcoflow/idempotencia.json",
  generar: () => `k-${++n}`, ahora: () => 1, avisar: () => {},
});
// Un almacén que git no deja proteger (lo que hace `almacenProtegido`): escribir y borrar lanzan con qué hacer.
const SIN_GIT = new SinProteccionDeGit({ codigo: "git_lo_sigue", detalle: "Git tracks /h/.config/supcoflow/idempotencia.json in the repo /h. Take it out of the repo with `git -C /h rm --cached -- .config/supcoflow/idempotencia.json` or have git ignore it." });
function sinProteccion(): Almacen & { datos: Map<string, Registro> } {
  const m = memoria();
  return { ...m, async escribir() { throw SIN_GIT; }, async borrar() { throw SIN_GIT; } };
}

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
it("un almacén que git no deja proteger no escribe nada: avisa con qué hacer y devuelve una clave igual", async () => {
  const avisos: string[] = [];
  const almacen = sinProteccion();
  const r = crearRegistroDeIdempotencia({
    origen: "http://localhost:3000", almacen, rutaDelArchivo: "/h/.config/supcoflow/idempotencia.json",
    generar: () => "k-sin-git", ahora: () => 1, avisar: (s) => avisos.push(s),
  });
  expect(await r.claveDe("proyecto_crear", "d/r")).toBe("k-sin-git");
  expect(avisos).toHaveLength(1);
  expect(avisos[0]).toMatch(/^I.m not saving the idempotency key in \/h\/.config\/supcoflow\/idempotencia.json: a retry will send a different one\. Git tracks .*git -C \/h rm --cached/);
  expect(almacen.datos.size).toBe(0);
});
it("olvidar con un almacén que git no deja proteger avisa y no reescribe", async () => {
  const avisos: string[] = [];
  const r = crearRegistroDeIdempotencia({
    origen: "http://localhost:3000", almacen: sinProteccion(), rutaDelArchivo: "/h/.config/supcoflow/idempotencia.json",
    generar: () => "k", ahora: () => 1, avisar: (s) => avisos.push(s),
  });
  await r.olvidar("proyecto_crear", "d/r");
  expect(avisos).toHaveLength(1);
  expect(avisos[0]).toMatch(/^I didn.t delete the idempotency key from \/h\/.config\/supcoflow\/idempotencia.json, so as not to rewrite a file git doesn.t ignore\. Git tracks/);
});
// ---- Modo estricto (`claves crear`, Review Focus 15) ----
const estricto = (almacen = memoria(), avisos: string[] = []) => crearRegistroDeIdempotencia({
  origen: "http://localhost:3000", almacen, rutaDelArchivo: "/h/.config/supcoflow/idempotencia.json",
  generar: () => `k-${++n}`, ahora: () => 1, avisar: (s) => avisos.push(s),
});
it("Review Focus 15: estricta + escritura que falla → lanza idempotencia_no_guardada", async () => {
  await expect(estricto(memoria(true)).claveDe("clave_crear", "proj#ci", { estricta: true }))
    .rejects.toMatchObject({ error: "idempotencia_no_guardada", codigo: 1 });
});
it("estricta + un almacén que git no deja proteger (con lo que hay que hacer) o archivo ilegible → lanza igual", async () => {
  await expect(estricto(sinProteccion()).claveDe("clave_crear", "proj#ci", { estricta: true }))
    .rejects.toMatchObject({ error: "idempotencia_no_guardada", codigo: 1, message: expect.stringMatching(/Git tracks .*git -C \/h rm --cached/) });
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
  expect(await estricto(memoria(true), avisos).claveDe("proyecto_crear", "d/r")).toMatch(/^k-/);
  expect(avisos).toHaveLength(1);
});
