// La clave de idempotencia de los pedidos que crean algo en el motor (`proyecto crear`), guardada en
// `~/.config/supcoflow/idempotencia.json` (Review Focus 4): si la respuesta se pierde en el camino, el
// reintento tiene que mandar la MISMA clave para que el motor devuelva lo que ya hizo en vez de
// hacerlo dos veces. Por eso se escribe ANTES de devolverla, y sólo se olvida cuando el motor ya dio
// un desenlace que no hace falta repetir.
import path from "node:path";
import type { Almacen } from "./guardado/index.ts";
import { dentroDeUnWorkingTree } from "./guardado/repo.ts";

export type RegistroDeIdempotencia = {
  claveDe(operacion: string, alcance: string): Promise<string>;
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

  return {
    async claveDe(operacion, alcance) {
      const c = cuenta(operacion, alcance);
      try {
        const guardada = await d.almacen.leer(c);
        if (guardada !== null) return guardada.valor;
      } catch {
        // Un archivo que no se entiende no se reescribe (perdería otras claves); se sigue sin guardar.
        const nueva = d.generar();
        d.avisar(`No pude leer ${d.rutaDelArchivo}: sigo con una clave de idempotencia sin guardar.`);
        return nueva;
      }
      const nueva = d.generar();
      // Perder la clave no duplica nada: el motor reusa el proyecto por su repo. Por eso un destino
      // dentro de un repo (misma regla que las credenciales: un `git add -A` la publicaría) o un disco
      // que falla avisan y siguen, en vez de frenar el comando.
      const raiz = dentroDeUnWorkingTree(path.dirname(d.rutaDelArchivo), d.fs);
      if (raiz !== null) {
        d.avisar(`No guardo la clave de idempotencia dentro de un repo de git (${raiz}): un reintento mandará otra.`);
        return nueva;
      }
      try {
        await d.almacen.escribir(c, { valor: nueva, escritoEn: d.ahora() });
      } catch {
        d.avisar(`No pude guardar la clave de idempotencia en ${d.rutaDelArchivo}: un reintento mandará otra.`);
      }
      return nueva;
    },
    async olvidar(operacion, alcance) {
      // Best-effort: una clave que queda guardada nunca da un proyecto de más. Tras un 2xx el próximo
      // `crear` encuentra el proyecto por su repo antes de mandarla; tras un rechazo el motor ya la
      // soltó; y un 409 `idempotency_key_reusada` la vuelve a olvidar.
      try {
        await d.almacen.borrar(cuenta(operacion, alcance));
      } catch {
        d.avisar(`No pude borrar la clave de idempotencia de ${d.rutaDelArchivo}.`);
      }
    },
  };
}
