// src/comandos/instalacion.ts
// `install record --skill <versión> [--app <carpeta>] [--file <ruta>]... [--shape widget|own-interface] [--dry-run]`
// (bloque 6, 0.8.0 y 0.9.0): deja en `.supcoflow/instalacion.json` con qué versiones se instaló el chat y, desde la 0.9.0
// (v3, T8), qué se instaló (`--shape`: el widget o una interfaz propia de la app), en qué archivos quedó (`--file`, repetible)
// y qué versión del contrato de presentación trae el paquete instalado (su `contract.json`). Lee la configuración del motor y
// los `package.json` y `contract.json` de la app y del paquete instalado; nunca ejecuta nada del repo (ni `npm ls` ni `node`).
//
// La regla de §13 («no pisa archivos ni cambios sin commit») adaptada a un archivo que tiene que poder cambiar
// (decisión 11): se reescribe sólo si git ya guarda el anterior. El control se hace ANTES de escribir; si la
// persona edita el archivo entre el control y el `rename`, su cambio se pierde. Esa carrera se acepta: es una
// persona instalando, y el archivo lo escribe sólo este comando.
import { lstatSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { Flags } from "../argumentos.ts";
import { resultadoDeFallo, SALIDA, taparSecretos, type Resultado } from "../contrato.ts";
import { anotadoEn, armarInstalacion, esSemver, PAQUETE_DEL_CHAT, RUTA_DE_LA_INSTALACION, serializar, validarLosArchivos, type Configuracion, type Forma, type Instalacion } from "../instalacion.ts";
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

// `files` (todos los `--file`, en orden) manda sobre `file` (el primero, de antes de la 0.9.0); `shape` es lo que dijo la persona.
export type FlagsDeInstalacion = Pick<Flags, "repo" | "dryRun"> & {
  skill: string | null; app: string | null; file?: string | null; files?: string[]; shape?: string | null;
};

// `--shape` en inglés; al archivo va el nombre de la API (como `--mode save` y `guardar`).
const FORMA_DE_LA_FLAG: Record<string, Forma> = { widget: "widget", "own-interface": "interfaz_propia" };

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
// El `contract.json` (T8) se lee del MISMO paquete, al lado de su `package.json`: sin él (un paquete anterior al contrato)
// es null; si es un enlace que sale del repo tampoco se lee.
type Instalado = { ok: true; valor: unknown; contrato: unknown } | { ok: false; resultado: Resultado };

function contratoDelPaquete(d: DepsDeInstalacion, raiz: string, carpetaReal: string, avisos: string[]): { ok: true; valor: unknown } | { ok: false; resultado: Resultado } {
  const candidato = path.join(carpetaReal, "contract.json");
  const real = d.rutaReal(candidato);
  if (real === null) return { ok: true, valor: null };
  if (!adentro(raiz, real)) {
    const aviso = `${path.relative(raiz, candidato)} points outside the repo; I don't read it and I record the contract as null.`;
    avisos.push(aviso);
    d.avisar(aviso);
    return { ok: true, valor: null };
  }
  const j = leerJson(d, real, `the contract.json of ${PAQUETE_DEL_CHAT}`);
  if (j.ok) return j;
  return { ok: false, resultado: j.noExiste ? fallo(SALIDA.inesperado, "paquete_ilegible", `I can't read the contract.json of ${PAQUETE_DEL_CHAT}.`) : j.resultado };
}

function paqueteInstalado(d: DepsDeInstalacion, raiz: string, app: string, avisos: string[]): Instalado {
  for (let dir = app; ; dir = path.dirname(dir)) {
    const candidato = path.join(dir, "node_modules", ...PAQUETE_DEL_CHAT.split("/"), "package.json");
    const real = d.rutaReal(candidato);
    if (real !== null) {
      if (!adentro(raiz, real)) {
        const aviso = `${path.relative(raiz, candidato)} points outside the repo; I don't read it and I record the installed chat as null.`;
        avisos.push(aviso);
        d.avisar(aviso);
        return { ok: true, valor: null, contrato: null };
      }
      const j = leerJson(d, real, `the installed package.json of ${PAQUETE_DEL_CHAT}`);
      if (!j.ok) {
        // Existía hace un instante: si ahora no está, tampoco se anota «no está».
        return { ok: false, resultado: j.noExiste ? fallo(SALIDA.inesperado, "paquete_ilegible", `I can't read the installed package.json of ${PAQUETE_DEL_CHAT}.`) : j.resultado };
      }
      const c = contratoDelPaquete(d, raiz, path.dirname(real), avisos);
      return c.ok ? { ok: true, valor: j.valor, contrato: c.valor } : c;
    }
    if (dir === raiz || path.dirname(dir) === dir) return { ok: true, valor: null, contrato: null };
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
  `skill ${x.skill}, terminal ${x.terminal}, chat declared ${x.chat.declarado ?? "—"} / installed ${x.chat.instalado ?? "—"}`
  + `${x.forma === null ? "" : `, ${x.forma === "widget" ? "widget" : "own interface"}`}`
  + `${x.archivos.length === 0 ? "" : `, ${x.archivos.length === 1 ? "file" : "files"} ${x.archivos.join(", ")}`}`
  + `${x.contrato === null ? "" : `, contract ${x.contrato}`}`;

export async function instalacionAnotar(d: DepsDeInstalacion, flags: FlagsDeInstalacion): Promise<Resultado> {
  if (flags.skill === null) return fallo(SALIDA.entradaInvalida, "falta_skill", "The skill version is missing: `supcoflow install record --skill 0.1.0`.");
  if (!esSemver(flags.skill)) return fallo(SALIDA.entradaInvalida, "skill_invalida", "--skill goes with a semver version (for example 0.1.0).");

  // La forma y los archivos del chat se miran antes de cualquier pedido: algo imposible no gasta una vuelta al motor.
  let formaPedida: Forma | null = null;
  if (flags.shape !== undefined && flags.shape !== null) {
    formaPedida = Object.hasOwn(FORMA_DE_LA_FLAG, flags.shape) ? FORMA_DE_LA_FLAG[flags.shape]! : null;
    if (formaPedida === null) return fallo(SALIDA.entradaInvalida, "forma_invalida", "--shape goes with `widget` (the packaged widget) or `own-interface` (a chat the app builds with its own components).");
  }
  const crudos = flags.files !== undefined && flags.files.length > 0 ? flags.files : flags.file !== undefined && flags.file !== null ? [flags.file] : [];
  let archivosPedidos: string[] | null = null;
  if (crudos.length > 0) {
    const v = validarLosArchivos(crudos);
    if (!v.ok) return fallo(SALIDA.entradaInvalida, "archivo_invalido", v.motivo);
    archivosPedidos = v.rutas;
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
  for (const archivoPedido of archivosPedidos ?? []) {
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
  // Re-correr sin `--shape` ni `--file` no borra lo que ya se anotó (v2: su `archivo` es el widget; v1: nada, sin error).
  // `--file` reemplaza la lista entera y `--shape` la forma: lo que se pide manda, lo que no, se conserva.
  const anotado = anotadoEn(antes);
  let x: Instalacion;
  try {
    x = armarInstalacion({
      skill: flags.skill, terminal: d.terminal, paqueteDeLaApp: deLaApp.ok ? deLaApp.valor : null, paqueteInstalado: instalado.valor, configuracion,
      forma: formaPedida ?? anotado.forma, archivos: archivosPedidos ?? anotado.archivos, contrato: instalado.contrato,
    });
  } catch (e) {
    return resultadoDeFallo(e);
  }
  const nuevo = serializar(x);

  // ─── ¿Se puede escribir? ───
  // `archivo` (el primero) sigue en el JSON por las skills de antes de la 0.9.0; lo nuevo es `archivos`, `forma` y `contrato`.
  const json = {
    ok: true, ruta: RUTA_DE_LA_INSTALACION, instalacion: x, archivo: x.archivos[0] ?? null, archivos: x.archivos, forma: x.forma, contrato: x.contrato,
    ...(avisos.length > 0 ? { avisos } : {}),
  };
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
