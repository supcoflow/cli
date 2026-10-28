// `supcoflow quien-soy`: con qué clave anda la terminal y a nombre de quién. Es de sólo lectura
// (§13): ni siquiera reintenta las claves anotadas «por revocar», sólo dice que están.
import type { Yo } from "../api.ts";
import { FalloDeLaTerminal, resultadoDeFallo, SALIDA, type Resultado } from "../contrato.ts";
import { NOMBRE_DE_LA_FUENTE, type Guardado } from "../guardado/index.ts";
import { claveVigente } from "./clave-vigente.ts";

export async function comandoQuienSoy(d: {
  api: URL;
  guardado: Guardado;
  quienSoy: (api: URL, clave: string) => Promise<Yo>;
  avisar: (s: string) => void;
}): Promise<Resultado> {
  const origen = d.api.origin;
  const leida = await claveVigente(d.guardado, origen);
  if (!leida.ok) return leida.resultado;
  const vigente = leida.vigente;
  if (!vigente.completa) {
    const otro = vigente.fuente === "archivo" ? NOMBRE_DE_LA_FUENTE.llavero : NOMBRE_DE_LA_FUENTE.archivo;
    d.avisar(`I'm using the key in ${NOMBRE_DE_LA_FUENTE[vigente.fuente]}, but I couldn't read ${otro}: a newer key may be saved there.`);
  }

  // Leer no cuesta nada y avisa de algo que la persona no vería de otro modo: claves viejas vivas.
  try {
    const { claves, completa } = await d.guardado.leerPorRevocar(origen);
    if (claves.length > 0) {
      d.avisar(`${claves.length} previous key(s) are noted down to be revoked; I'll try again on the next login or logout.`);
    }
    if (!completa) d.avisar("I couldn't read the whole list of keys waiting to be revoked.");
  } catch {
    d.avisar("I couldn't read the whole list of keys waiting to be revoked.");
  }

  let yo: Yo;
  try {
    yo = await d.quienSoy(d.api, vigente.clave);
  } catch (e) {
    // Con la variable definida, «iniciá sesión de nuevo» no arregla nada: la variable sigue
    // ganándole a la clave nueva. Hay que decir cuál es la que no vale.
    if (e instanceof FalloDeLaTerminal && e.codigo === SALIDA.faltaLogin && vigente.fuente === "env") {
      return resultadoDeFallo(new FalloDeLaTerminal(e.codigo, e.error,
        "The key in SUPCOFLOW_TOKEN is not valid: remove it from your environment or replace it with a valid one."));
    }
    return resultadoDeFallo(e);
  }

  const quien = yo.usuario?.login ?? yo.usuario?.email ?? yo.via;
  return {
    codigo: SALIDA.ok,
    json: { ok: true, via: yo.via, equipo: yo.equipo, usuario: yo.usuario, proyecto: yo.proyecto, fuente: vigente.fuente },
    texto: `${quien} in team ${yo.equipo} (key in ${NOMBRE_DE_LA_FUENTE[vigente.fuente]})`,
  };
}
