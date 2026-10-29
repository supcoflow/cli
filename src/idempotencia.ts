// La clave de idempotencia de los pedidos que crean algo en el motor (`proyecto crear`), guardada en
// `~/.config/supcoflow/idempotencia.json` (Review Focus 4): si la respuesta se pierde en el camino, el
// reintento tiene que mandar la MISMA clave para que el motor devuelva lo que ya hizo en vez de
// hacerlo dos veces. Por eso se escribe ANTES de devolverla, y sólo se olvida cuando el motor ya dio
// un desenlace que no hace falta repetir.
import path from "node:path";
import { FalloDeLaTerminal, SALIDA } from "./contrato.ts";
import type { Almacen } from "./guardado/index.ts";
import { dentroDeUnWorkingTree } from "./guardado/repo.ts";

export type RegistroDeIdempotencia = {
  claveDe(operacion: string, alcance: string, opciones?: { estricta?: boolean }): Promise<string>;
  /** ¿Hay un intento a medias guardado? Lanza `idempotencia_no_guardada` si no puede leer. */
  tiene(operacion: string, alcance: string): Promise<boolean>;
  olvidar(operacion: string, alcance: string): Promise<void>;
};

export function crearRegistroDeIdempotencia(d: {
  origen: string;
  almacen: Almacen;
  rutaDelArchivo: string;
  fs: { realpath(p: string): string; existe(p: string): boolean };
  generar: () => string;
  ahora: () => number;
  avisar: (s: string) => void;
}): RegistroDeIdempotencia {
  // Por origen, como la clave (un motor local y producción no comparten claves), y el alcance en
  // minúsculas: `D/r` y `d/r` son el mismo repo para GitHub y para el motor.
  const cuenta = (operacion: string, alcance: string) => `${d.origen}#${operacion}#${alcance.toLowerCase()}`;

  // ─── El modo estricto (`claves crear`; primera revisión externa del 2026-10-16, hallazgo 6) ───
  // `proyecto crear` puede seguir con una clave sin guardar porque el proyecto tiene clave natural (el
  // repo) y el motor lo reusa. Una clave de consulta no tiene clave natural: sin la de idempotencia
  // guardada, el reintento tras una respuesta perdida crea OTRA fila. Mejor no mandar nada y decir qué
  // arreglar. Por eso, en estricto, cada «aviso y sigo» de abajo lanza.
  const noGuardada = () => new FalloDeLaTerminal(
    SALIDA.inesperado, "idempotencia_no_guardada",
    `I couldn't save the retry key in ${d.rutaDelArchivo}; without it, a retry would create another key. Check that file (it can't be inside a repo) and try again.`,
  );

  return {
    async claveDe(operacion, alcance, opciones = {}) {
      const c = cuenta(operacion, alcance);
      try {
        const guardada = await d.almacen.leer(c);
        if (guardada !== null) return guardada.valor;
      } catch {
        if (opciones.estricta) throw noGuardada();
        // Un archivo que no se entiende no se reescribe (perdería otras claves); se sigue sin guardar.
        const nueva = d.generar();
        d.avisar(`I couldn't read ${d.rutaDelArchivo}: I'm going on with an idempotency key that isn't saved.`);
        return nueva;
      }
      const nueva = d.generar();
      // Perder la clave no duplica nada: el motor reusa el proyecto por su repo. Por eso un destino
      // dentro de un repo (misma regla que las credenciales: un `git add -A` la publicaría) o un disco
      // que falla avisan y siguen, en vez de frenar el comando.
      // `realpath` lanza con un tramo que es un enlace roto (`~/.config/supcoflow` apuntando a un repo
      // de dotfiles que ya no está): no saber dónde cae el destino es otro «no se puede guardar».
      let raiz: string | null;
      try {
        raiz = dentroDeUnWorkingTree(path.dirname(d.rutaDelArchivo), d.fs);
      } catch {
        if (opciones.estricta) throw noGuardada();
        d.avisar(`I couldn't resolve the path of ${d.rutaDelArchivo}: I'm going on with an idempotency key that isn't saved.`);
        return nueva;
      }
      if (raiz !== null) {
        if (opciones.estricta) throw noGuardada();
        d.avisar(`I'm not saving the idempotency key inside a git repo (${raiz}): a retry will send a different one.`);
        return nueva;
      }
      try {
        await d.almacen.escribir(c, { valor: nueva, escritoEn: d.ahora() });
      } catch {
        if (opciones.estricta) throw noGuardada();
        d.avisar(`I couldn't save the idempotency key in ${d.rutaDelArchivo}: a retry will send a different one.`);
      }
      return nueva;
    },
    async tiene(operacion, alcance) {
      // Sólo lo usa el modo estricto: «no sé si hay un intento a medias» no puede leerse como «no hay».
      try {
        return (await d.almacen.leer(cuenta(operacion, alcance))) !== null;
      } catch {
        throw noGuardada();
      }
    },
    async olvidar(operacion, alcance) {
      // Best-effort: una clave que queda guardada nunca da un proyecto de más. Tras un 2xx el próximo
      // `crear` encuentra el proyecto por su repo antes de mandarla; tras un rechazo el motor ya la
      // soltó; y un 409 `idempotency_key_reusada` la vuelve a olvidar.
      try {
        await d.almacen.borrar(cuenta(operacion, alcance));
      } catch {
        d.avisar(`I couldn't delete the idempotency key from ${d.rutaDelArchivo}.`);
      }
    },
  };
}
