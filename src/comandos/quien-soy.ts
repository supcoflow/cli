// `supcoflow quien-soy`: con qué clave anda la terminal y a nombre de quién. Es de sólo lectura
// (§13): ni siquiera reintenta las claves anotadas «por revocar», sólo dice que están.
import type { Yo } from "../api.ts";
import { FalloDeLaTerminal, resultadoDeFallo, SALIDA, type Resultado } from "../contrato.ts";
import type { Guardado } from "../guardado/index.ts";
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
    const otro = vigente.fuente === "archivo" ? "el llavero del sistema" : "el archivo de credenciales";
    d.avisar(`Uso la clave de ${vigente.fuente}, pero no pude leer ${otro}: puede haber guardada otra más nueva.`);
  }

  // Leer no cuesta nada y avisa de algo que la persona no vería de otro modo: claves viejas vivas.
  try {
    const { claves, completa } = await d.guardado.leerPorRevocar(origen);
    if (claves.length > 0) {
      d.avisar(`Hay ${claves.length} clave(s) anterior(es) anotadas para revocar; se reintenta en el próximo login o logout.`);
    }
    if (!completa) d.avisar("No pude leer entera la lista de claves por revocar.");
  } catch {
    d.avisar("No pude leer entera la lista de claves por revocar.");
  }

  let yo: Yo;
  try {
    yo = await d.quienSoy(d.api, vigente.clave);
  } catch (e) {
    // Con la variable definida, «iniciá sesión de nuevo» no arregla nada: la variable sigue
    // ganándole a la clave nueva. Hay que decir cuál es la que no vale.
    if (e instanceof FalloDeLaTerminal && e.codigo === SALIDA.faltaLogin && vigente.fuente === "env") {
      return resultadoDeFallo(new FalloDeLaTerminal(e.codigo, e.error,
        "La clave de SUPCOFLOW_TOKEN no vale: sacala de tu entorno o reemplazala por una vigente."));
    }
    return resultadoDeFallo(e);
  }

  const quien = yo.usuario?.login ?? yo.usuario?.email ?? yo.via;
  return {
    codigo: SALIDA.ok,
    json: { ok: true, via: yo.via, equipo: yo.equipo, usuario: yo.usuario, proyecto: yo.proyecto, fuente: vigente.fuente },
    texto: `${quien} en el equipo ${yo.equipo} (clave en ${vigente.fuente})`,
  };
}
