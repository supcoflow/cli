// Dónde vive la clave de la terminal (§5.2): el llavero del sistema; si no hay, un archivo 0600
// avisando; `SUPCOFLOW_TOKEN` por encima de los dos; y nunca un destino dentro de un repo de git.
import path from "node:path";
import { FalloDeLaTerminal, SALIDA } from "../contrato.ts";
import { LlaveroAusente, TECHO_DEL_LLAVERO_MS } from "./llavero.ts";
import { dentroDeUnWorkingTree } from "./repo.ts";

export type Pendiente = {
  deviceCode: string; userCode: string; verificationUriComplete: string; venceEn: number; intervaloS: number; ultimoSondeoEn: number | null;
};
export type Registro = { valor: string; escritoEn: number };

export interface Almacen {
  nombre: "llavero" | "archivo";
  leer(cuenta: string, techoMs?: number): Promise<Registro | null>;
  escribir(cuenta: string, r: Registro, techoMs?: number): Promise<void>;
  borrar(cuenta: string, techoMs?: number): Promise<void>;
}

export type Fuente = "env" | "llavero" | "archivo";

export type Guardado = {
  leerClave(origen: string): Promise<{ clave: string; fuente: Fuente } | null>;
  leerClaveGuardada(origen: string): Promise<{ clave: string; fuente: "llavero" | "archivo" } | null>;
  guardarClave(origen: string, clave: string, techoMs?: number): Promise<{ donde: "llavero" | "archivo" }>;
  borrarClave(origen: string): Promise<void>;
  leerPendiente(origen: string): Promise<Pendiente | null>;
  guardarPendiente(origen: string, p: Pendiente, techoMs?: number): Promise<void>;
  borrarPendiente(origen: string, techoMs?: number): Promise<boolean>;
  leerPorRevocar(origen: string): Promise<{ claves: string[]; completa: boolean }>;
  anotarPorRevocar(origen: string, clave: string, techoMs?: number): Promise<void>;
  quitarPorRevocar(origen: string, clave: string): Promise<{ completo: boolean }>;
};

// La cuenta ES el origen de la API que emitió lo guardado (Review Focus 3): una clave acuñada por
// un motor en `localhost` queda en otra cuenta que la de producción, y la terminal apuntada a
// producción simplemente no la encuentra (sale 2) en vez de mandarla a un servidor que no la emitió.
// Y la clave y el login en curso son cuentas DISTINTAS (Review Focus 7): empezar o abandonar un login
// escribe sólo `#pendiente` y nunca puede pisar la clave vigente.
const cuentaDeClave = (origen: string) => origen;
const cuentaDePendiente = (origen: string) => `${origen}#pendiente`;
const cuentaPorRevocar = (origen: string) => `${origen}#por_revocar`;

type Intento<T> = { estado: "ok"; valor: T } | { estado: "ausente" } | { estado: "fallo" };
type Queda = () => number;

function esPendiente(v: unknown): v is Pendiente {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  return typeof p.deviceCode === "string" && typeof p.userCode === "string" && typeof p.verificationUriComplete === "string"
    && typeof p.venceEn === "number" && typeof p.intervaloS === "number"
    && (p.ultimoSondeoEn === null || typeof p.ultimoSondeoEn === "number");
}
function listaDeClaves(s: string): string[] | null {
  try {
    const v: unknown = JSON.parse(s);
    return Array.isArray(v) && v.every((x) => typeof x === "string") ? v : null;
  } catch {
    return null;
  }
}

export function crearGuardado(d: {
  env: Record<string, string | undefined>;
  llavero: Almacen | null;
  archivo: Almacen;
  rutaDelArchivo: string;
  fs: { realpath(p: string): string; existe(p: string): boolean };
  ahora: () => number;
  avisar: (s: string) => void;
}): Guardado {
  const almacenes = (): Almacen[] => (d.llavero ? [d.llavero, d.archivo] : [d.archivo]);

  // El techo es de la operación ENTERA (Review Focus 10): un vencimiento absoluto calculado al
  // entrar, que leer, escribir y limpiar se reparten. Si cada llamada tuviera su propio techo, una
  // operación «de 5 s» podían ser 10 y la reserva del tramo del login no cerraba.
  function plazo(techoMs = TECHO_DEL_LLAVERO_MS): Queda {
    const fin = d.ahora() + techoMs;
    return () => fin - d.ahora();
  }

  // El plazo sólo corta al llavero: el archivo es local y no se cuelga, y es el último recurso para
  // guardar una clave que no tiene otra copia. Un plazo agotado no espera al llavero: es una falla.
  async function intentar<T>(a: Almacen | null, queda: Queda, op: (a: Almacen, techoMs: number) => Promise<T>): Promise<Intento<T>> {
    if (a === null) return { estado: "ausente" };
    const techo = queda();
    if (a.nombre === "llavero" && techo <= 0) return { estado: "fallo" };
    try {
      return { estado: "ok", valor: await op(a, Math.max(techo, 1)) };
    } catch (e) {
      return e instanceof LlaveroAusente ? { estado: "ausente" } : { estado: "fallo" };
    }
  }

  // Gana el `escritoEn` más alto, no el almacén (Review Focus 8): si el llavero falla una vez, la
  // clave nueva cae al archivo; cuando el llavero vuelve, todavía tiene la VIEJA. Preferir el
  // llavero por ser el llavero devolvería una clave ya reemplazada (y quizás revocada).
  async function leerCuenta(cuenta: string, queda: Queda): Promise<{ r: Registro; fuente: "llavero" | "archivo" } | null> {
    let mejor: { r: Registro; fuente: "llavero" | "archivo" } | null = null;
    for (const a of almacenes()) {
      const i = await intentar(a, queda, (x, t) => x.leer(cuenta, t));
      if (i.estado === "ok" && i.valor !== null && (mejor === null || i.valor.escritoEn > mejor.r.escritoEn)) {
        mejor = { r: i.valor, fuente: a.nombre };
      }
    }
    return mejor;
  }

  // El chequeo del repo va ANTES de escribir (Review Focus 1): una vez escrita, la clave ya está a
  // un `git add -A` de publicarse, y borrarla después no deshace un commit. Mira la ruta REAL además
  // de la escrita (Review Focus 6): con `~/.config` enlazado a un repo de dotfiles, la escrita no
  // cae en ningún repo y la real sí.
  async function escribirEnArchivo(cuenta: string, r: Registro, que: string): Promise<void> {
    const raiz = dentroDeUnWorkingTree(path.dirname(d.rutaDelArchivo), d.fs);
    if (raiz !== null) {
      throw new FalloDeLaTerminal(
        SALIDA.inesperado, "destino_dentro_de_un_repo",
        `No guardo ${que} dentro de un repo de git (${raiz}). Usá el llavero del sistema o exportá SUPCOFLOW_TOKEN.`,
      );
    }
    await d.archivo.escribir(cuenta, r);
    d.avisar(`No hay llavero del sistema: guardé ${que} en ${d.rutaDelArchivo} con permisos 0600.`);
  }

  async function escribirCuenta(cuenta: string, valor: string, que: string, techoMs?: number): Promise<"llavero" | "archivo"> {
    const queda = plazo(techoMs);
    const r: Registro = { valor, escritoEn: d.ahora() };
    const ll = await intentar(d.llavero, queda, (x, t) => x.escribir(cuenta, r, t));
    if (ll.estado === "ok") {
      // Best-effort: si queda algo viejo en el archivo, la regla del `escritoEn` lo deja atrás.
      await intentar(d.archivo, queda, (x, t) => x.borrar(cuenta, t));
      return "llavero";
    }
    await escribirEnArchivo(cuenta, r, que);
    // No se limpia el llavero: si acaba de fallar (o vencer su techo) no se lo vuelve a esperar, y
    // si está ausente no tiene nada. Lo viejo que quede ahí pierde por `escritoEn`.
    return "archivo";
  }

  // Devuelve de qué almacenes PRESENTES no se pudo borrar; un llavero ausente no guarda nada.
  async function borrarCuenta(cuenta: string, techoMs?: number): Promise<Almacen["nombre"][]> {
    const queda = plazo(techoMs);
    const fallidos: Almacen["nombre"][] = [];
    for (const a of almacenes()) {
      if ((await intentar(a, queda, (x, t) => x.borrar(cuenta, t))).estado === "fallo") fallidos.push(a.nombre);
    }
    return fallidos;
  }

  async function leerLista(a: Almacen | null, cuenta: string, queda: Queda): Promise<Intento<string[]>> {
    const i = await intentar(a, queda, (x, t) => x.leer(cuenta, t));
    if (i.estado !== "ok") return i;
    if (i.valor === null) return { estado: "ok", valor: [] };
    const lista = listaDeClaves(i.valor.valor);
    return lista === null ? { estado: "fallo" } : { estado: "ok", valor: lista };
  }

  const guardado: Guardado = {
    async leerClave(origen) {
      // Quien exporta la variable decide: se usa sin mirar el origen.
      const env = d.env.SUPCOFLOW_TOKEN;
      if (env) return { clave: env, fuente: "env" };
      return guardado.leerClaveGuardada(origen);
    },
    async leerClaveGuardada(origen) {
      const l = await leerCuenta(cuentaDeClave(origen), plazo());
      return l === null ? null : { clave: l.r.valor, fuente: l.fuente };
    },
    async guardarClave(origen, clave, techoMs) {
      return { donde: await escribirCuenta(cuentaDeClave(origen), clave, "la clave", techoMs) };
    },
    async borrarClave(origen) {
      // Un borrado a medias de una clave no se informa como hecho: la que quedó sigue sirviendo.
      const fallidos = await borrarCuenta(cuentaDeClave(origen));
      if (fallidos.length > 0) {
        const donde = fallidos.map((n) => (n === "llavero" ? "del llavero del sistema" : `de ${d.rutaDelArchivo}`)).join(" ni ");
        throw new FalloDeLaTerminal(SALIDA.inesperado, "no_se_pudo_borrar", `No pude borrar la clave guardada ${donde}.`);
      }
    },
    async leerPendiente(origen) {
      const l = await leerCuenta(cuentaDePendiente(origen), plazo());
      if (l === null) return null;
      try {
        const v: unknown = JSON.parse(l.r.valor);
        return esPendiente(v) ? v : null;
      } catch {
        return null;
      }
    },
    async guardarPendiente(origen, p, techoMs) {
      await escribirCuenta(cuentaDePendiente(origen), JSON.stringify(p), "el inicio de sesión en curso", techoMs);
    },
    async borrarPendiente(origen, techoMs) {
      // Nunca lanza: un pendiente viejo es inofensivo (su device_code ya se consumió o vence en
      // 10 min; el próximo `--start` lo pisa y un `--wait` sobre él recibe `invalid_grant` y lo limpia).
      try {
        return (await borrarCuenta(cuentaDePendiente(origen), techoMs)).length === 0;
      } catch {
        return false;
      }
    },
    // La lista «por revocar» NO sigue la regla del `escritoEn` (Review Focus 15): es la UNIÓN de los
    // dos almacenes. Con «gana la más reciente», A anotada en el llavero y B en el archivo mientras
    // el llavero no respondía daría [B], y A quedaría vigente para siempre sin que nadie la revoque.
    async leerPorRevocar(origen) {
      const queda = plazo();
      const claves = new Set<string>();
      let completa = true;
      for (const a of almacenes()) {
        const l = await leerLista(a, cuentaPorRevocar(origen), queda);
        if (l.estado === "ok") l.valor.forEach((c) => claves.add(c));
        else if (l.estado === "fallo") completa = false;
      }
      return { claves: [...claves], completa };
    },
    // Se escribe SÓLO en un almacén, sobre la lista que se acaba de leer de ESE almacén: nunca se
    // reemplaza la del otro, que puede tener claves que ahora no se pueden leer. Y un almacén que no
    // se pudo leer no se pisa a ciegas.
    async anotarPorRevocar(origen, clave, techoMs) {
      const queda = plazo(techoMs);
      const cuenta = cuentaPorRevocar(origen);
      for (const a of almacenes()) {
        const l = await leerLista(a, cuenta, queda);
        if (l.estado !== "ok") continue;
        if (l.valor.includes(clave)) return;
        const r: Registro = { valor: JSON.stringify([...l.valor, clave]), escritoEn: d.ahora() };
        if (a.nombre === "archivo") {
          try {
            await escribirEnArchivo(cuenta, r, "las claves por revocar");
            return;
          } catch (e) {
            if (e instanceof FalloDeLaTerminal) throw e;
            break;
          }
        }
        if ((await intentar(a, queda, (x, t) => x.escribir(cuenta, r, t))).estado === "ok") return;
      }
      throw new FalloDeLaTerminal(
        SALIDA.inesperado, "no_se_pudo_anotar",
        "No pude anotar la clave anterior como «por revocar» ni en el llavero ni en el archivo.",
      );
    },
    // Quitar sólo achica la lista, así que no pasa por el control del repo: no agrega ningún secreto.
    // Un almacén presente que falla deja `completo = false`: la clave puede seguir anotada ahí, el
    // próximo reintento la vuelve a revocar, el motor contesta `ya_no_valia` y se quita entonces.
    async quitarPorRevocar(origen, clave) {
      const queda = plazo();
      const cuenta = cuentaPorRevocar(origen);
      let completo = true;
      for (const a of almacenes()) {
        const l = await leerLista(a, cuenta, queda);
        if (l.estado === "fallo") completo = false;
        if (l.estado !== "ok" || !l.valor.includes(clave)) continue;
        const resto = l.valor.filter((c) => c !== clave);
        const op = resto.length === 0
          ? (x: Almacen, t: number) => x.borrar(cuenta, t)
          : (x: Almacen, t: number) => x.escribir(cuenta, { valor: JSON.stringify(resto), escritoEn: d.ahora() }, t);
        if ((await intentar(a, queda, op)).estado !== "ok") completo = false;
      }
      return { completo };
    },
  };
  return guardado;
}
