// El llavero del sistema: Keychain en macOS (`security`), Secret Service en Linux (`secret-tool`).
// Sin dependencias: se habla con el binario del sistema, inyectado como `Correr` para los tests.
import { existsSync } from "node:fs";
import { esRegistro } from "./archivo.ts";
import type { Almacen, Registro } from "./index.ts";

// Un anillo bloqueado que pide desbloqueo, o un Linux sin D-Bus, deja al binario esperando para
// siempre: cada llamada tiene techo y vencerlo es una falla, nunca un comando colgado (Review Focus 2).
export const TECHO_DEL_LLAVERO_MS = 5_000;

export type Correr = (
  bin: string, args: string[], stdin: string | null, techoMs: number,
) => Promise<{ codigo: number | null; stdout: string; stderr?: string; vencido: boolean; ausente?: boolean }>;

// AUSENTE no es FALLIDO (Review Focus 12): un binario que no existe no guarda nada, así que no hay
// nada que borrar en él; uno que está y falla puede tener datos adentro.
export class LlaveroAusente extends Error {
  constructor(bin: string) {
    super(`No hay llavero del sistema (falta ${bin}).`);
    this.name = "LlaveroAusente";
  }
}

const SERVICIO = "supcoflow";

// El base64url no tiene espacios: el modo `-i` de `security` parte la línea por espacios, y una
// clave en JSON los tiene (o podría tenerlos). Con base64url el secreto es un único argumento.
const codificar = (r: Registro): string => Buffer.from(JSON.stringify(r)).toString("base64url");
function decodificar(s: string): Registro {
  let v: unknown;
  try {
    v = JSON.parse(Buffer.from(s.trim(), "base64url").toString("utf8"));
  } catch {
    v = undefined;
  }
  if (!esRegistro(v)) throw new Error("El llavero devolvió algo que no entiendo.");
  return { valor: v.valor, escritoEn: v.escritoEn };
}

// La cuenta viaja en una línea de `security -i`, que también parte por espacios y entiende comillas:
// una cuenta con algo de eso se leería distinta de lo que se escribió. Un origen nunca lo tiene.
function cuentaSegura(cuenta: string): string {
  if (!/^[A-Za-z0-9:/.\[\]#_-]+$/.test(cuenta)) throw new Error("Cuenta del llavero inválida.");
  return cuenta;
}

type Comandos = {
  // Candidatas en orden: se usa la primera que exista. Ninguna existe → el llavero está AUSENTE.
  bins: string[];
  escribir(cuenta: string, secreto: string): { args: string[]; stdin: string };
  leer(cuenta: string): string[];
  borrar(cuenta: string): string[];
  noEncontrado(codigo: number | null, stdout: string, stderr: string): boolean;
};

// La ruta ABSOLUTA: un `security` del PATH podría ser otro programa (un `node_modules/.bin`, un
// directorio del repo en el PATH) y recibiría la clave. El secreto va con `-i` por stdin porque en
// `argv` lo ve cualquiera con `ps` mientras el comando corre; leer y borrar no llevan secreto.
const MACOS: Comandos = {
  bins: ["/usr/bin/security"],
  escribir: (cuenta, secreto) => ({
    args: ["-i"],
    stdin: `add-generic-password -U -s ${SERVICIO} -a ${cuenta} -w ${secreto}\n`,
  }),
  leer: (cuenta) => ["find-generic-password", "-s", SERVICIO, "-a", cuenta, "-w"],
  borrar: (cuenta) => ["delete-generic-password", "-s", SERVICIO, "-a", cuenta],
  // 44 = errSecItemNotFound.
  noEncontrado: (codigo) => codigo === 44,
};

// `secret-tool store` lee el secreto de stdin cuando no hay terminal: nunca en `argv`.
//
// Rutas ABSOLUTAS y no `secret-tool` por el PATH, por la misma razón que `security` arriba: un
// `node_modules/.bin/secret-tool` plantado recibiría cada clave por stdin.
const LINUX: Comandos = {
  bins: ["/usr/bin/secret-tool", "/bin/secret-tool", "/usr/local/bin/secret-tool"],
  escribir: (cuenta, secreto) => ({
    args: ["store", "--label=Supcoflow", "servicio", SERVICIO, "cuenta", cuenta],
    stdin: secreto,
  }),
  leer: (cuenta) => ["lookup", "servicio", SERVICIO, "cuenta", cuenta],
  borrar: (cuenta) => ["clear", "servicio", SERVICIO, "cuenta", cuenta],
  // `secret-tool` sale 1 sin salida también sin D-Bus o con el anillo bloqueado: lo único que
  // distingue «no está» de «no pude mirar» es que, cuando no está, no dice nada por stderr.
  noEncontrado: (codigo, stdout, stderr) => codigo === 1 && stdout.trim() === "" && stderr.trim() === "",
};

export function almacenDeLlavero(
  plataforma: NodeJS.Platform, correr: Correr, existe: (ruta: string) => boolean = existsSync,
): Almacen | null {
  const c = plataforma === "darwin" ? MACOS : plataforma === "linux" ? LINUX : null;
  if (c === null) return null;

  // Ni el stdout, ni el stdin, ni el stderr van al mensaje: pueden llevar el secreto.
  async function ejecutar(args: string[], stdin: string | null, techoMs: number) {
    const bin = c!.bins.find((b) => existe(b));
    if (bin === undefined) throw new LlaveroAusente(c!.bins[0]!);
    const r = await correr(bin, args, stdin, techoMs);
    if (r.ausente) throw new LlaveroAusente(bin);
    if (r.vencido) throw new Error(`El llavero no contestó en ${Math.round(techoMs / 1000)} s.`);
    return r;
  }
  const fallo = (codigo: number | null) => new Error(`El llavero falló (código ${codigo}).`);

  return {
    nombre: "llavero",
    async leer(cuenta, techoMs = TECHO_DEL_LLAVERO_MS) {
      const r = await ejecutar(c.leer(cuentaSegura(cuenta)), null, techoMs);
      if (c.noEncontrado(r.codigo, r.stdout, r.stderr ?? "")) return null;
      if (r.codigo !== 0) throw fallo(r.codigo);
      return decodificar(r.stdout);
    },
    async escribir(cuenta, registro, techoMs = TECHO_DEL_LLAVERO_MS) {
      const { args, stdin } = c.escribir(cuentaSegura(cuenta), codificar(registro));
      const r = await ejecutar(args, stdin, techoMs);
      if (r.codigo !== 0) throw fallo(r.codigo);
    },
    async borrar(cuenta, techoMs = TECHO_DEL_LLAVERO_MS) {
      const r = await ejecutar(c.borrar(cuentaSegura(cuenta)), null, techoMs);
      if (c.noEncontrado(r.codigo, r.stdout, r.stderr ?? "")) return;
      if (r.codigo !== 0) throw fallo(r.codigo);
    },
  };
}
