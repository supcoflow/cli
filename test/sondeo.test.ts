import { describe, expect, it } from "vitest";
import { sondearUnTramo, TRAMO_MAXIMO_MS, RESERVA_PARA_CERRAR_MS } from "../src/sondeo.ts";
import type { Pendiente } from "../src/guardado/index.ts";
import type { Canje } from "../src/api.ts";

const T0 = 1_000_000;
function reloj() {
  let t = T0; const dormidos: number[] = [];
  return { ahora: () => t, avanzar: (ms: number) => { t += ms; }, dormir: async (ms: number) => { dormidos.push(ms); t += ms; }, dormidos };
}
const pend = (o: Partial<Pendiente> = {}): Pendiente => ({
  deviceCode: "d".repeat(64), userCode: "BCDF-GHJK", verificationUriComplete: "u", venceEn: T0 + 600_000,
  intervaloS: 5, ultimoSondeoEn: null, ...o,
});
const FIN = T0 + TRAMO_MAXIMO_MS - RESERVA_PARA_CERRAR_MS;
const sinPersistir = async () => {};

describe("sondearUnTramo", () => {
  it("el primer sondeo de un pedido nuevo no espera; el token termina el tramo", async () => {
    const r = reloj();
    const fin = await sondearUnTramo(pend(), { ...r, finDeSondeos: FIN, persistir: sinPersistir, canjear: async () => ({ tipo: "token", clave: "scf_x", equipo: "tnt" }) });
    expect(fin).toEqual({ tipo: "token", clave: "scf_x", equipo: "tnt" });
    expect(r.dormidos).toEqual([]);
  });
  it("con el token NO persiste nada, aunque persistir esté roto (Review Focus 13)", async () => {
    const r = reloj(); let llamadas = 0;
    const fin = await sondearUnTramo(pend(), { ...r, finDeSondeos: FIN, persistir: async () => { llamadas++; throw new Error("llavero caído"); }, canjear: async () => ({ tipo: "token", clave: "scf_x", equipo: "tnt" }) });
    expect(fin.tipo).toBe("token");
    expect(llamadas).toBe(0);
  });
  it("respeta el intervalo entre sondeos y suma 5 s por slow_down", async () => {
    const r = reloj(); const respuestas: Canje[] = [{ tipo: "pendiente" }, { tipo: "slow_down" }, { tipo: "token", clave: "k", equipo: "t" }];
    await sondearUnTramo(pend(), { ...r, finDeSondeos: FIN, persistir: sinPersistir, canjear: async () => respuestas.shift()! });
    // primer sondeo sin espera → pendiente; 5 s → slow_down (sube a 10); 10 s → token
    expect(r.dormidos).toEqual([5_000, 10_000]);
  });
  it("un --wait enseguida de otro espera lo que falta del intervalo guardado (Review Focus 4)", async () => {
    const r = reloj();
    await sondearUnTramo(pend({ ultimoSondeoEn: T0 - 2_000, intervaloS: 10 }), {
      ...r, finDeSondeos: FIN, persistir: sinPersistir, canjear: async () => ({ tipo: "token", clave: "k", equipo: "t" }),
    });
    expect(r.dormidos).toEqual([8_000]);
  });
  it("motor Y llavero lentos: cada canje y cada persistir consumen su techo, y igual no pasa el fin + un techo (Review Focus 10)", async () => {
    const r = reloj(); const plazos: number[] = [];
    const canjear = async (_d: string, plazoMs: number) => { plazos.push(plazoMs); r.avanzar(plazoMs); return { tipo: "pendiente" } as Canje; };
    const persistir = async (_p: Pendiente, techo: number) => { r.avanzar(techo); };
    const fin = await sondearUnTramo(pend(), { ...r, finDeSondeos: FIN, persistir, canjear });
    expect(fin.tipo).toBe("sigue");
    expect(r.ahora()).toBeLessThanOrEqual(FIN + 5_000);
    expect(Math.max(...plazos)).toBeLessThanOrEqual(15_000);
  });
  it("slow_down y después la red se cae: el intervalo nuevo ya quedó guardado (Review Focus 11)", async () => {
    const r = reloj(); const guardados: Pendiente[] = [];
    const respuestas: (() => Canje)[] = [() => ({ tipo: "slow_down" }), () => { throw new Error("fetch failed"); }];
    await expect(sondearUnTramo(pend(), { ...r, finDeSondeos: FIN, persistir: async (p) => { guardados.push(p); }, canjear: async () => respuestas.shift()!() })).rejects.toThrow();
    expect(guardados.at(-1)!.intervaloS).toBe(10);
    expect(guardados.at(-1)!.ultimoSondeoEn).toBe(T0);
  });
  it("un pedido que vence dentro del tramo termina en vencido sin sondear de más", async () => {
    const r = reloj();
    const fin = await sondearUnTramo(pend({ venceEn: T0 + 7_000 }), { ...r, finDeSondeos: FIN, persistir: sinPersistir, canjear: async () => ({ tipo: "pendiente" }) });
    expect(fin).toEqual({ tipo: "vencido" });
  });
  it.each([["rechazado"], ["vencido"], ["invalido"]] as const)("%s termina el tramo", async (tipo) => {
    const r = reloj();
    expect(await sondearUnTramo(pend(), { ...r, finDeSondeos: FIN, persistir: sinPersistir, canjear: async () => ({ tipo }) })).toEqual({ tipo });
  });
});
