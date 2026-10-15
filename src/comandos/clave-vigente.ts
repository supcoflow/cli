// La clave con la que la terminal le habla al motor, leída igual para todo comando que la necesite
// (`quien-soy`, `repo conectar`, …): un solo lugar decide qué es «sin sesión» y qué es «no pude mirar».
import { SALIDA, type Resultado } from "../contrato.ts";
import type { Guardado } from "../guardado/index.ts";

export type ClaveVigente = { clave: string; fuente: "env" | "llavero" | "archivo"; completa: boolean };

export async function claveVigente(guardado: Guardado, origen: string): Promise<{ ok: true; vigente: ClaveVigente } | { ok: false; resultado: Resultado }> {
  const lectura = await guardado.leerClaveCompleta(origen);
  const vigente = lectura.valor;
  // «Iniciá sesión» con la clave guardada en un llavero que no contestó invita a un login que la
  // pisaría: no es «sin sesión», es «no pude mirar» (Review Focus 12).
  if (vigente === null && !lectura.completa) {
    const message = "No pude leer la clave guardada (el llavero no respondió). Desbloquealo y probá de nuevo.";
    return { ok: false, resultado: { codigo: SALIDA.inesperado, json: { ok: false, error: "llavero_no_responde", message }, texto: message } };
  }
  if (vigente === null) {
    const message = "Iniciá sesión con `supcoflow login`.";
    return { ok: false, resultado: { codigo: SALIDA.faltaLogin, json: { ok: false, error: "sin_sesion", message }, texto: message } };
  }
  return { ok: true, vigente: { clave: vigente.clave, fuente: vigente.fuente, completa: lectura.completa } };
}
