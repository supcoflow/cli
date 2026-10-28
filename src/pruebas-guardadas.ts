// Lo que `probar` guarda en esta máquina, por origen y por proyecto (bloque 7, hallazgo 5): el INTENTO
// (`{clave, mensaje, techo_usd}`) y la última prueba confirmada. Fuera del repo, al lado de las credenciales.
//
// Por qué no alcanza el registro de idempotencia (src/idempotencia.ts): ése guarda sólo la clave. El motor
// compara la huella del pedido (proyecto, techo, mensaje) y una misma clave con otro mensaje es
// `idempotency_key_reusada`; para que el reintento tras una respuesta perdida recupere la MISMA prueba hay
// que reenviar la clave con el mensaje y el techo que llevó. Por eso se guarda el intento entero.
//
// Por qué una sola cuenta con las dos cosas: «guardar el id» y «cerrar el intento» son UNA escritura
// atómica (el `rename` del almacén). Si falla, el archivo queda como estaba: el intento sigue abierto, el
// próximo comando reenvía la misma clave, recibe la misma prueba y vuelve a intentar (R14d). Con dos
// escrituras, un corte entre medio dejaba la última guardada y el intento abierto, y la próxima «prueba
// nueva» sería en realidad un reintento de la vieja.
//
// Estricto en todo, como `claves crear` en el registro de idempotencia: una prueba no tiene clave natural
// del lado de la terminal, así que mandar sin el intento guardado arriesga una segunda prueba (que gasta).
import path from "node:path";
import { FalloDeLaTerminal, SALIDA } from "./contrato.ts";
import type { Almacen } from "./guardado/index.ts";
import { dentroDeUnWorkingTree } from "./guardado/repo.ts";

// `politicaEsperada` es la que la persona vio al autorizar (valor de la API); null si no se pasó (alias viejo) o si el
// intento lo guardó la 0.7.0, que no la mandaba. El reintento reenvía el mismo cuerpo, así que se guarda con el intento.
export type PoliticaEsperada = "relevar" | "guardar";
export type Intento = { clave: string; mensaje: string | null; techoUsd: number; politicaEsperada: PoliticaEsperada | null };
export type LoGuardado = { intento: Intento | null; ultima: string | null };

export type RegistroDePruebas = {
  /** Lanza `prueba_no_guardada` si no puede leer: «no sé» no es «no hay intento». */
  leer(proyectoId: string): Promise<LoGuardado>;
  /** Guarda el intento entero; lanza si no puede (y entonces no se manda nada). */
  abrir(proyectoId: string, intento: Intento): Promise<void>;
  /** La última prueba = `pruebaId` y el intento cerrado, en una escritura. Lanza si no puede. */
  confirmar(proyectoId: string, pruebaId: string): Promise<void>;
  /** Cierra el intento tras un rechazo definitivo, sin tocar la última. Lanza si no puede. */
  descartar(proyectoId: string): Promise<void>;
};

type IntentoGuardado = { clave: string; mensaje: string | null; techo_usd: number; politica_esperada?: PoliticaEsperada | null };

function esIntento(v: unknown): v is IntentoGuardado {
  if (typeof v !== "object" || v === null) return false;
  const i = v as Record<string, unknown>;
  const politica = i.politica_esperada === undefined || i.politica_esperada === null || i.politica_esperada === "relevar" || i.politica_esperada === "guardar";
  return typeof i.clave === "string" && i.clave.length > 0 && (i.mensaje === null || typeof i.mensaje === "string") && typeof i.techo_usd === "number" && politica;
}

export function crearRegistroDePruebas(d: {
  origen: string;
  almacen: Almacen;
  rutaDelArchivo: string;
  fs: { realpath(p: string): string; existe(p: string): boolean };
  ahora: () => number;
  avisar: (s: string) => void;
}): RegistroDePruebas {
  // Por origen, como la clave y el registro de idempotencia: un motor local (o el proxy de P4) y
  // producción no comparten intentos. Cambiar de origen entre dos comandos es otra clave.
  const cuenta = (proyectoId: string) => `${d.origen}#prueba#${proyectoId}`;
  const noGuardada = (que: string) => new FalloDeLaTerminal(
    SALIDA.inesperado, "prueba_no_guardada",
    `No pude ${que} ${d.rutaDelArchivo}; sin eso, un reintento podría pedir otra prueba (y gastar dos veces). Revisá ese archivo (no puede estar dentro de un repo) y probá de nuevo.`,
  );

  async function leer(proyectoId: string): Promise<LoGuardado> {
    let crudo: string | null;
    try {
      crudo = (await d.almacen.leer(cuenta(proyectoId)))?.valor ?? null;
    } catch {
      throw noGuardada("leer");
    }
    if (crudo === null) return { intento: null, ultima: null };
    let v: unknown;
    try {
      v = JSON.parse(crudo);
    } catch {
      throw noGuardada("entender");
    }
    const o = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
    const intentoOk = o.intento === null || esIntento(o.intento);
    const ultimaOk = o.ultima === null || typeof o.ultima === "string";
    if (!intentoOk || !ultimaOk) throw noGuardada("entender");
    const i = o.intento as IntentoGuardado | null;
    return {
      intento: i === null ? null : { clave: i.clave, mensaje: i.mensaje, techoUsd: i.techo_usd, politicaEsperada: i.politica_esperada ?? null },
      ultima: o.ultima as string | null,
    };
  }

  async function escribir(proyectoId: string, g: LoGuardado): Promise<void> {
    // Misma regla que las credenciales: un destino dentro de un repo se publicaría con un `git add -A`.
    // No saber dónde cae (un enlace roto) es otro «no se puede guardar».
    let raiz: string | null;
    try {
      raiz = dentroDeUnWorkingTree(path.dirname(d.rutaDelArchivo), d.fs);
    } catch {
      throw noGuardada("resolver la ruta de");
    }
    if (raiz !== null) {
      throw new FalloDeLaTerminal(SALIDA.inesperado, "prueba_no_guardada",
        `No guardo el pedido de la prueba dentro de un repo de git (${raiz}); sin guardarlo no lo mando. Apuntá XDG_CONFIG_HOME fuera de un repo.`);
    }
    const valor = JSON.stringify({
      intento: g.intento === null
        ? null
        : { clave: g.intento.clave, mensaje: g.intento.mensaje, techo_usd: g.intento.techoUsd, politica_esperada: g.intento.politicaEsperada },
      ultima: g.ultima,
    });
    try {
      await d.almacen.escribir(cuenta(proyectoId), { valor, escritoEn: d.ahora() });
    } catch {
      throw noGuardada("guardar en");
    }
  }

  return {
    leer,
    async abrir(proyectoId, intento) {
      const antes = await leer(proyectoId);
      await escribir(proyectoId, { intento, ultima: antes.ultima });
    },
    async confirmar(proyectoId, pruebaId) {
      await leer(proyectoId);
      await escribir(proyectoId, { intento: null, ultima: pruebaId });
    },
    async descartar(proyectoId) {
      const antes = await leer(proyectoId);
      await escribir(proyectoId, { intento: null, ultima: antes.ultima });
    },
  };
}
