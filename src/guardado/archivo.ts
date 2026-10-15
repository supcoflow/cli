// El archivo de credenciales, para cuando no hay llavero: un JSON `{ "<cuenta>": Registro }`.
import path from "node:path";
import type { Almacen, Registro } from "./index.ts";

export type FsMinimo = {
  leer(p: string): string | null;
  crearDir(p: string, modo: number): void;
  chmod(p: string, modo: number): void;
  borrarSiExiste(p: string): void;
  escribirExclusivo(p: string, s: string, modo: number): void;
  renombrar(a: string, b: string): void;
  realpath(p: string): string;
  existe(p: string): boolean;
};

export function esRegistro(v: unknown): v is Registro {
  return typeof v === "object" && v !== null
    && typeof (v as Registro).valor === "string" && typeof (v as Registro).escritoEn === "number";
}

export function almacenDeArchivo(ruta: string, fs: FsMinimo): Almacen {
  const dir = path.dirname(ruta);
  const temporal = ruta + ".tmp";

  // Un archivo que no se entiende es un FALLO, no un vacío: tratarlo como vacío y reescribirlo
  // perdería claves por revocar que quizás siguen ahí.
  function todo(): Record<string, Registro> {
    const crudo = fs.leer(ruta);
    if (crudo === null) return {};
    let v: unknown;
    try {
      v = JSON.parse(crudo);
    } catch {
      v = undefined;
    }
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
      throw new Error(`No entiendo el archivo de credenciales ${ruta}; borralo y volvé a iniciar sesión.`);
    }
    return v as Record<string, Registro>;
  }

  // El `mkdir` no corrige los permisos de una carpeta que ya existía: por eso el `chmod` aparte.
  // El `.tmp` viejo (o un enlace dejado ahí) se borra y el nuevo se crea en exclusiva, así nunca se
  // escribe a través de un enlace ni se hereda un `0644`; el `rename` es atómico y, si `ruta` era un
  // enlace, reemplaza el enlace y no su destino (Review Focus 6).
  function persistir(t: Record<string, Registro>): void {
    fs.crearDir(dir, 0o700);
    fs.chmod(dir, 0o700);
    fs.borrarSiExiste(temporal);
    fs.escribirExclusivo(temporal, JSON.stringify(t, null, 2) + "\n", 0o600);
    fs.renombrar(temporal, ruta);
  }

  return {
    nombre: "archivo",
    async leer(cuenta) {
      const t = todo();
      if (!Object.hasOwn(t, cuenta)) return null;
      const r = t[cuenta];
      if (!esRegistro(r)) throw new Error(`No entiendo el archivo de credenciales ${ruta}; borralo y volvé a iniciar sesión.`);
      return { valor: r.valor, escritoEn: r.escritoEn };
    },
    async escribir(cuenta, r) {
      const t = todo();
      t[cuenta] = { valor: r.valor, escritoEn: r.escritoEn };
      persistir(t);
    },
    async borrar(cuenta) {
      const t = todo();
      if (!Object.hasOwn(t, cuenta)) return;
      delete t[cuenta];
      persistir(t);
    },
  };
}
