// src/comandos/instalacion.ts
// `install record --skill <versión> [--app <carpeta>] [--file <ruta>] [--dry-run]` (bloque 6 y 0.8.0): deja en
// `.supcoflow/instalacion.json` con qué versiones se instaló el chat y, desde la 0.8.0 (v2), en qué archivo quedó
// (`--file`). Lee la configuración del motor y los `package.json` de la app y del paquete instalado; nunca ejecuta
// nada del repo (ni `npm ls` ni `node`).
//
// La regla de §13 («no pisa archivos ni cambios sin commit») adaptada a un archivo que tiene que poder cambiar
// (decisión 11): se reescribe sólo si git ya guarda el anterior. El control se hace ANTES de escribir; si la
// persona edita el archivo entre el control y el `rename`, su cambio se pierde. Esa carrera se acepta: es una
// persona instalando, y el archivo lo escribe sólo este comando.
import { lstatSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { Flags } from "../argumentos.ts";
import { resultadoDeFallo, SALIDA, taparSecretos, type Resultado } from "../contrato.ts";
import { archivoAnotado, armarInstalacion, esSemver, PAQUETE_DEL_CHAT, RUTA_DE_LA_INSTALACION, serializar, validarElArchivoDelChat, type Configuracion, type Instalacion } from "../instalacion.ts";
import { NO_LEIDO } from "../lectura.ts";
import { repoPedido } from "../repo-local.ts";
import { fallo } from "./configurar.ts";
import { proyectoDelRepo, type DepsDelProyectoDelRepo } from "./proyecto-del-repo.ts";

export type DepsDeInstalacion = DepsDelProyectoDelRepo & {
  leerConfiguracion(api: URL, clave: string, proyectoId: string): Promise<Configuracion>;
  leerArchivoChico(p: string, tope: number): { bytes: Uint8Array } | { error: string };
  // La ruta real (enlaces resueltos) o null si no existe; un enlace roto tampoco existe, como para Node.
  rutaReal(p: string): string | null;
  esCarpeta(p: string): boolean;
  // ¿Es un enlace simbólico? (`lstat`: no lo sigue). Un archivo que no existe no lo es.
  esEnlace(p: string): boolean;
  // Temporal + rename en una carpeta común (`archivosDelRepo(...).escribir`, el mismo de `proyecto crear`).
  escribir(p: string, s: string): void;
  avisar(s: string): void;
  terminal: string; // la versión de esta terminal
};

export type FlagsDeInstalacion = Pick<Flags, "repo" | "dryRun"> & { skill: string | null; app: string | null; file?: string | null };

export function esEnlaceReal(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

export function esCarpetaReal(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function rutaRealOEnNada(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

// Los package.json son chicos; uno de más de 1 MB no es el de una app ni el de un paquete.
const TOPE_DEL_PACKAGE_JSON = 1024 * 1024;
const TOPE_DEL_ARCHIVO = 64 * 1024;

const adentro = (raiz: string, p: string) => p === raiz || p.startsWith(raiz + path.sep);
const limpio = (t: string) => taparSecretos(t.replace(/[\u0000-\u001f\u007f-\u009f]/g, ""));

function leerJson(d: DepsDeInstalacion, p: string, nombre: string): { ok: true; valor: unknown } | { ok: false; noExiste: true } | { ok: false; noExiste: false; resultado: Resultado } {
  const leido = d.leerArchivoChico(p, TOPE_DEL_PACKAGE_JSON);
  if ("error" in leido) {
    if (leido.error === NO_LEIDO.noExiste) return { ok: false, noExiste: true };
    return { ok: false, noExiste: false, resultado: fallo(SALIDA.inesperado, "paquete_ilegible", `I can't read ${nombre}: ${limpio(leido.error)}.`) };
  }
  try {
    return { ok: true, valor: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(leido.bytes)) };
  } catch {
    return { ok: false, noExiste: false, resultado: fallo(SALIDA.inesperado, "paquete_ilegible", `${nombre} isn't valid JSON.`) };
  }
}

// Como lo resuelve Node desde la app (revisión externa, hallazgo 4): el primer `node_modules/@supcoflow/chat`
// subiendo desde <app> hasta la raíz del repo. En un monorepo npm lo deja en la raíz; pnpm enlaza a
// `node_modules/.pnpm/…`, adentro del repo. Si la ruta real sale del repo, no se lee: lo que hay afuera no es
// de esta instalación y la terminal no lee fuera del repo por un enlace que el repo eligió.
function paqueteInstalado(d: DepsDeInstalacion, raiz: string, app: string, avisos: string[]): { ok: true; valor: unknown } | { ok: false; resultado: Resultado } {
  for (let dir = app; ; dir = path.dirname(dir)) {
    const candidato = path.join(dir, "node_modules", ...PAQUETE_DEL_CHAT.split("/"), "package.json");
    const real = d.rutaReal(candidato);
    if (real !== null) {
      if (!adentro(raiz, real)) {
        const aviso = `${path.relative(raiz, candidato)} points outside the repo; I don't read it and I record the installed chat as null.`;
        avisos.push(aviso);
        d.avisar(aviso);
        return { ok: true, valor: null };
      }
      const j = leerJson(d, real, `the installed package.json of ${PAQUETE_DEL_CHAT}`);
      if (j.ok) return j;
      // Existía hace un instante: si ahora no está, tampoco se anota «no está».
      return { ok: false, resultado: j.noExiste ? fallo(SALIDA.inesperado, "paquete_ilegible", `I can't read the installed package.json of ${PAQUETE_DEL_CHAT}.`) : j.resultado };
    }
    if (dir === raiz || path.dirname(dir) === dir) return { ok: true, valor: null };
  }
}

// ─── El estado del archivo en git (revisión externa, hallazgo 3) ───
// El `status` va SIEMPRE y primero: un borrado con `git rm` (en el índice, sin commit) ya no sale en `ls-files`,
// y mirar sólo `ls-files` lo trataba como «no versionado y no existe» y recreaba un archivo borrado a propósito.
// Cualquier línea que no sea `??`/`!!` (` D`, `D `, `M `, `A `…) es un cambio sin commit. `--ignored` hace que
// uno ignorado salga como `!!`. Sin salida, `ls-files` desempata: un `status` vacío solo no prueba que el archivo
// esté en un commit.
type Estado = "escribir" | "cambios_sin_commit" | "archivo_no_versionado";
async function estadoDelArchivo(d: DepsDeInstalacion, raizGit: string, existe: boolean): Promise<Estado> {
  const git = async (args: string[]) => {
    const r = await d.git(args, raizGit);
    if (r.codigo !== 0) throw new Error(`git ${args[0]} failed; I'm not writing ${RUTA_DE_LA_INSTALACION} without knowing whether it has changes.`);
    return r.stdout;
  };
  const lineas = (await git(["status", "--porcelain", "--ignored", "--", RUTA_DE_LA_INSTALACION])).split("\n").filter((l) => l.trim() !== "");
  if (lineas.some((l) => !l.startsWith("??") && !l.startsWith("!!"))) return "cambios_sin_commit";
  if (lineas.length > 0) return "archivo_no_versionado";
  const versionado = (await git(["ls-files", "--", RUTA_DE_LA_INSTALACION])).trim() !== "";
  return versionado || !existe ? "escribir" : "archivo_no_versionado";
}

// Un diff de líneas (LCS) para el texto: los dos lados son chicos. El anterior lo escribió quien sea, así que
// sale limpio de control y de secretos; el JSON nunca lo lleva.
function diff(antes: string | null, despues: string): string {
  if (antes === null) return ["--- (there was no file)", "+++ " + RUTA_DE_LA_INSTALACION, ...despues.trimEnd().split("\n").map((l) => "+ " + l)].join("\n");
  const a = antes.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n").map(limpio);
  const b = despues.trimEnd().split("\n");
  const n = a.length, m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const lineas = ["--- " + RUTA_DE_LA_INSTALACION + " (before)", "+++ " + RUTA_DE_LA_INSTALACION];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) lineas.push("  " + a[i++]), j++;
    else if (j < m && (i === n || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) lineas.push("+ " + b[j++]);
    else lineas.push("- " + a[i++]);
  }
  return lineas.join("\n");
}

const resumen = (x: Instalacion) =>
  `skill ${x.skill}, terminal ${x.terminal}, chat declared ${x.chat.declarado ?? "—"} / installed ${x.chat.instalado ?? "—"}${x.archivo !== null ? `, file ${x.archivo}` : ""}`;

export async function instalacionAnotar(d: DepsDeInstalacion, flags: FlagsDeInstalacion): Promise<Resultado> {
  if (flags.skill === null) return fallo(SALIDA.entradaInvalida, "falta_skill", "The skill version is missing: `supcoflow install record --skill 0.1.0`.");
  if (!esSemver(flags.skill)) return fallo(SALIDA.entradaInvalida, "skill_invalida", "--skill goes with a semver version (for example 0.1.0).");

  // El archivo del chat se mira antes de cualquier pedido: una ruta imposible no gasta una vuelta al motor.
  let archivoPedido: string | null = null;
  if (flags.file !== undefined && flags.file !== null) {
    const v = validarElArchivoDelChat(flags.file);
    if (!v.ok) return fallo(SALIDA.entradaInvalida, "archivo_invalido", v.motivo);
    archivoPedido = v.ruta;
  }

  // ─── La raíz y la app, antes de cualquier pedido ───
  let raizGit: string | null;
  let sinClon: string | undefined;
  try {
    ({ raiz: raizGit, sinClon } = await repoPedido({ flagRepo: flags.repo, git: d.git, cwd: d.cwd }));
  } catch (e) {
    return resultadoDeFallo(e);
  }
  if (raizGit === null) return fallo(SALIDA.entradaInvalida, "sin_clon", `${sinClon ?? "I don't have that repo's clone here."} ${RUTA_DE_LA_INSTALACION} goes in the repo's clone: stand in it.`);
  const raiz = d.rutaReal(raizGit);
  if (raiz === null) return fallo(SALIDA.inesperado, "inesperado", "I couldn't resolve the repo's root.");
  // `realpath` DESPUÉS de resolver: un `--app` que es un enlace hacia afuera tiene que quedar afuera (Review Focus 4).
  const app = d.rutaReal(path.resolve(raiz, flags.app ?? "."));
  if (app === null) return fallo(SALIDA.entradaInvalida, "app_inexistente", "The --app folder doesn't exist (it's relative to the repo root).");
  if (!adentro(raiz, app)) return fallo(SALIDA.entradaInvalida, "app_fuera_del_repo", "--app has to be a folder inside the repo (relative to its root).");
  // Un archivo no es una app: sin esto, leer `<archivo>/package.json` daba ENOTDIR y salía `paquete_ilegible`.
  if (!d.esCarpeta(app)) return fallo(SALIDA.entradaInvalida, "app_inexistente", "--app has to be a folder (the app's), not a file.");

  // `--file`: ni un enlace simbólico ni un camino que pase por uno (saldría del repo sin que se vea). El archivo todavía
  // puede no existir (con `--dry-run` se anota antes de escribirlo), pero ninguna carpeta del camino puede ser un enlace.
  if (archivoPedido !== null) {
    const partes = archivoPedido.split("/");
    for (let i = 1; i <= partes.length; i++) {
      if (d.esEnlace(path.join(raiz, ...partes.slice(0, i)))) {
        return fallo(SALIDA.entradaInvalida, "archivo_invalido", `--file can't be (or go through) a symlink: ${partes.slice(0, i).join("/")} is one.`);
      }
    }
  }

  // ─── Proyecto → configuración → package.json de la app → paquete instalado → armar ───
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  let configuracion: Configuracion;
  try {
    configuracion = await d.leerConfiguracion(d.api, p.clave, p.proyecto.id);
  } catch (e) {
    return resultadoDeFallo(e);
  }
  const deLaApp = leerJson(d, path.join(app, "package.json"), "the app's package.json");
  if (!deLaApp.ok && !deLaApp.noExiste) return deLaApp.resultado;
  const avisos: string[] = [];
  const instalado = paqueteInstalado(d, raiz, app, avisos);
  if (!instalado.ok) return instalado.resultado;
  // ─── El archivo de ahora: se lee antes de armar, porque `--file` ausente conserva el `archivo` ya anotado ───
  const archivo = path.join(raiz, RUTA_DE_LA_INSTALACION);
  // Una `.supcoflow` que es un enlace hacia afuera: ni se lee (el diff mostraría un archivo de afuera) ni se escribe.
  const carpeta = d.rutaReal(path.dirname(archivo));
  if (carpeta !== null && !adentro(raiz, carpeta)) return fallo(SALIDA.inesperado, "inesperado", `${path.dirname(RUTA_DE_LA_INSTALACION)} isn't a folder of the repo (a symlink?); I'm not writing there.`);
  const actual = d.leerArchivoChico(archivo, TOPE_DEL_ARCHIVO);
  const existe = !("error" in actual) || actual.error !== NO_LEIDO.noExiste;
  const antes = "bytes" in actual ? Buffer.from(actual.bytes).toString("utf8") : null;
  // Re-correr sin `--file` no borra el archivo que ya se anotó; un v1 (sin `archivo`) da null, sin error.
  const archivoDelChat = archivoPedido ?? archivoAnotado(antes);
  let x: Instalacion;
  try {
    x = armarInstalacion({ skill: flags.skill, terminal: d.terminal, paqueteDeLaApp: deLaApp.ok ? deLaApp.valor : null, paqueteInstalado: instalado.valor, configuracion, archivo: archivoDelChat });
  } catch (e) {
    return resultadoDeFallo(e);
  }
  const nuevo = serializar(x);

  // ─── ¿Se puede escribir? ───
  const json = { ok: true, ruta: RUTA_DE_LA_INSTALACION, instalacion: x, archivo: x.archivo, ...(avisos.length > 0 ? { avisos } : {}) };
  if ("bytes" in actual && Buffer.from(actual.bytes).equals(Buffer.from(nuevo, "utf8"))) {
    return { codigo: SALIDA.ok, json: { ...json, ...(flags.dryRun ? { dry_run: true } : {}), sin_cambios: true }, texto: `${RUTA_DE_LA_INSTALACION} already says that (${resumen(x)}); I didn't touch it.` };
  }
  let estado: Estado;
  try {
    estado = await estadoDelArchivo(d, raizGit, existe);
  } catch (e) {
    return resultadoDeFallo(e);
  }
  if (estado === "cambios_sin_commit") {
    return fallo(SALIDA.haceFaltaUnaPersona, "cambios_sin_commit", `${RUTA_DE_LA_INSTALACION} has uncommitted changes (or was deleted without a commit); I didn't touch it. Commit or discard them and run again.`);
  }
  if (estado === "archivo_no_versionado") {
    return fallo(SALIDA.haceFaltaUnaPersona, "archivo_no_versionado", `There's already a ${RUTA_DE_LA_INSTALACION} that git doesn't track (uncommitted or ignored); I didn't overwrite it. Commit or delete it and run again.`);
  }
  const cambios = existe && antes === null ? `(the previous file can't be read)\n${diff(null, nuevo)}` : diff(antes, nuevo);
  if (flags.dryRun) {
    return { codigo: SALIDA.ok, json: { ...json, dry_run: true, sin_cambios: false }, texto: `With --dry-run I don't write; without it I'd record (${resumen(x)}):\n${cambios}` };
  }
  try {
    d.escribir(archivo, nuevo);
  } catch {
    return fallo(SALIDA.inesperado, "archivo_no_escrito", `I couldn't write ${RUTA_DE_LA_INSTALACION}. Run \`supcoflow install record\` again.`);
  }
  return { codigo: SALIDA.ok, json: { ...json, sin_cambios: false }, texto: `Recorded ${RUTA_DE_LA_INSTALACION} (${resumen(x)}); commit it whenever you like.\n${cambios}` };
}
