// Un tramo de sondeo del login por dispositivo (§4.5): `login --wait` no espera a la persona
// indefinidamente, sondea un rato y, si todavía no confirmó, sale 5 («volvé a llamarme»).
import type { Canje } from "./api.ts";
import { TECHO_DEL_LLAVERO_MS } from "./guardado/llavero.ts";
import type { Pendiente } from "./guardado/index.ts";

// 90 s para el comando ENTERO, guardado y revocación incluidos, no sólo para los sondeos: quien
// llama suele ser un asistente cuya herramienta de terminal corta a los 2 min (Claude Code), y un
// comando cortado a mitad de cierre puede dejar la clave nueva sin guardar o la vieja sin revocar.
// Por la misma razón (P13 del motor) nada espera en silencio más que eso: se parte en tramos.
export const TRAMO_MAXIMO_MS = 90_000;

// Lo que se aparta del tramo para cerrar después de recibir el token. La secuencia de cierre tiene a
// lo sumo cuatro operaciones lentas, cada una con techo de 5 s: guardar la nueva (el llavero; si
// vence, el archivo es local e inmediato), revocar la anterior en el motor, anotarla «por revocar»
// si no se pudo, y borrar el pendiente. 4 × 5 s + 2 s de margen = 22 s. La clave anterior se lee
// ANTES de sondear (no consume reserva), y el pendiente sólo se persiste tras respuestas no finales.
export const RESERVA_PARA_CERRAR_MS = 22_000;

// Una operación de cierre opcional (revocar la anterior, borrar el pendiente) con menos que esto
// no se intenta: con medio segundo no contesta ni un motor sano, y lo que no se hace queda anotado.
export const PLAZO_MINIMO_MS = 500;

// Un sondeo con menos plazo que esto casi seguro vence sin respuesta: mejor salir 5 y que el
// próximo `--wait` sondee con un tramo entero.
export const PLAZO_MINIMO_DE_SONDEO_MS = 2_000;

const PLAZO_MAXIMO_DE_CANJE_MS = 15_000;

export type FinDelTramo =
  | { tipo: "token"; clave: string; equipo: string }
  | { tipo: "sigue"; pendiente: Pendiente }
  | { tipo: "rechazado" }
  | { tipo: "vencido" }
  | { tipo: "invalido" };

export async function sondearUnTramo(
  inicial: Pendiente,
  d: {
    ahora: () => number;
    dormir: (ms: number) => Promise<void>;
    canjear: (deviceCode: string, plazoMs: number) => Promise<Canje>;
    persistir: (p: Pendiente, techoMs: number) => Promise<void>;
    finDeSondeos: number;
  },
): Promise<FinDelTramo> {
  let p = inicial;
  for (;;) {
    // El intervalo se cuenta desde el último sondeo GUARDADO, no desde que arrancó este comando
    // (Review Focus 4): un `--wait` enseguida de otro espera lo que falta, en vez de ganarse un
    // `slow_down` del motor.
    const ahora = d.ahora();
    const proximo = p.ultimoSondeoEn === null ? ahora : Math.max(ahora, p.ultimoSondeoEn + p.intervaloS * 1000);
    if (proximo >= p.venceEn) return { tipo: "vencido" };
    if (d.finDeSondeos - proximo < PLAZO_MINIMO_DE_SONDEO_MS) return { tipo: "sigue", pendiente: p };
    if (proximo > ahora) await d.dormir(proximo - ahora);

    const c = await d.canjear(p.deviceCode, Math.min(PLAZO_MAXIMO_DE_CANJE_MS, d.finDeSondeos - d.ahora()));
    // El token es la ÚNICA copia de la clave (el motor no la reentrega): no espera a ninguna
    // escritura del pendiente, que podría colgarse o lanzar y perderla (Review Focus 13).
    if (c.tipo === "token") return { tipo: "token", clave: c.clave, equipo: c.equipo };
    if (c.tipo !== "pendiente" && c.tipo !== "slow_down") return { tipo: c.tipo };

    // El último sondeo se fecha con la RESPUESTA: el motor lo vio a más tardar entonces, así que
    // contar desde ahí nunca adelanta el próximo. Y se guarda ANTES de seguir (Review Focus 11):
    // si la red se cae en el sondeo siguiente, el intervalo nuevo de un `slow_down` ya quedó escrito.
    p = { ...p, ultimoSondeoEn: d.ahora(), intervaloS: p.intervaloS + (c.tipo === "slow_down" ? 5 : 0) };
    await d.persistir(p, Math.min(TECHO_DEL_LLAVERO_MS, Math.max(PLAZO_MINIMO_MS, d.finDeSondeos - d.ahora())));
  }
}
