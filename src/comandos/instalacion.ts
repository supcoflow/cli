// src/comandos/instalacion.ts
// `instalacion anotar --skill <versión> [--app <carpeta>] [--dry-run]` (bloque 6): deja en
// `.supcoflow/instalacion.json` con qué versiones se instaló el chat. Lee la configuración del motor y los
// `package.json` de la app y del paquete instalado; nunca ejecuta nada del repo (ni `npm ls` ni `node`).
//
// La regla de §13 («no pisa archivos ni cambios sin commit») adaptada a un archivo que tiene que poder cambiar
// (decisión 11): se reescribe sólo si git ya guarda el anterior. El control se hace ANTES de escribir; si la
// persona edita el archivo entre el control y el `rename`, su cambio se pierde. Esa carrera se acepta: es una
// persona instalando, y el archivo lo escribe sólo este comando.
import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { Flags } from "../argumentos.ts";
import { resultadoDeFallo, SALIDA, taparSecretos, type Resultado } from "../contrato.ts";
import { armarInstalacion, esSemver, PAQUETE_DEL_CHAT, RUTA_DE_LA_INSTALACION, serializar, type Configuracion, type Instalacion } from "../instalacion.ts";
import { repoPedido } from "../repo-local.ts";
import { fallo } from "./configurar.ts";
import { proyectoDelRepo, type DepsDelProyectoDelRepo } from "./proyecto-del-repo.ts";

export type DepsDeInstalacion = DepsDelProyectoDelRepo & {
  leerConfiguracion(api: URL, clave: string, proyectoId: string): Promise<Configuracion>;
  leerArchivoChico(p: string, tope: number): { bytes: Uint8Array } | { error: string };
  // La ruta real (enlaces resueltos) o null si no existe; un enlace roto tampoco existe, como para Node.
  rutaReal(p: string): string | null;
  esCarpeta(p: string): boolean;
  // Temporal + rename en una carpeta común (`archivosDelRepo(...).escribir`, el mismo de `proyecto crear`).
  escribir(p: string, s: string): void;
  avisar(s: string): void;
  terminal: string; // la versión de esta terminal
};

export type FlagsDeInstalacion = Pick<Flags, "repo" | "dryRun"> & { skill: string | null; app: string | null };

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
    if (leido.error === "no existe") return { ok: false, noExiste: true };
    return { ok: false, noExiste: false, resultado: fallo(SALIDA.inesperado, "paquete_ilegible", `No leo ${nombre}: ${limpio(leido.error)}.`) };
  }
  try {
    return { ok: true, valor: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(leido.bytes)) };
  } catch {
    return { ok: false, noExiste: false, resultado: fallo(SALIDA.inesperado, "paquete_ilegible", `${nombre} no es JSON válido.`) };
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
        const aviso = `${path.relative(raiz, candidato)} apunta fuera del repo; no lo leo y anoto el chat instalado como null.`;
        avisos.push(aviso);
        d.avisar(aviso);
        return { ok: true, valor: null };
      }
      const j = leerJson(d, real, `el package.json de ${PAQUETE_DEL_CHAT} instalado`);
      if (j.ok) return j;
      // Existía hace un instante: si ahora no está, tampoco se anota «no está».
      return { ok: false, resultado: j.noExiste ? fallo(SALIDA.inesperado, "paquete_ilegible", `No leo el package.json de ${PAQUETE_DEL_CHAT} instalado.`) : j.resultado };
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
    if (r.codigo !== 0) throw new Error(`git ${args[0]} falló; no escribo ${RUTA_DE_LA_INSTALACION} sin saber si tiene cambios.`);
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
  if (antes === null) return ["--- (no había archivo)", "+++ " + RUTA_DE_LA_INSTALACION, ...despues.trimEnd().split("\n").map((l) => "+ " + l)].join("\n");
  const a = antes.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n").map(limpio);
  const b = despues.trimEnd().split("\n");
  const n = a.length, m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const lineas = ["--- " + RUTA_DE_LA_INSTALACION + " (antes)", "+++ " + RUTA_DE_LA_INSTALACION];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) lineas.push("  " + a[i++]), j++;
    else if (j < m && (i === n || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) lineas.push("+ " + b[j++]);
    else lineas.push("- " + a[i++]);
  }
  return lineas.join("\n");
}

const resumen = (x: Instalacion) =>
  `skill ${x.skill}, terminal ${x.terminal}, chat declarado ${x.chat.declarado ?? "—"} / instalado ${x.chat.instalado ?? "—"}`;

export async function instalacionAnotar(d: DepsDeInstalacion, flags: FlagsDeInstalacion): Promise<Resultado> {
  if (flags.skill === null) return fallo(SALIDA.entradaInvalida, "falta_skill", "Falta la versión de la skill: `supcoflow instalacion anotar --skill 0.1.0`.");
  if (!esSemver(flags.skill)) return fallo(SALIDA.entradaInvalida, "skill_invalida", "--skill va con una versión semver (por ejemplo 0.1.0).");

  // ─── La raíz y la app, antes de cualquier pedido ───
  let raizGit: string | null;
  try {
    raizGit = (await repoPedido({ flagRepo: flags.repo, git: d.git, cwd: d.cwd })).raiz;
  } catch (e) {
    return resultadoDeFallo(e);
  }
  if (raizGit === null) return fallo(SALIDA.entradaInvalida, "sin_clon", `No tengo el clon de ese repo acá, y ${RUTA_DE_LA_INSTALACION} va en el clon: parate en el clon del repo.`);
  const raiz = d.rutaReal(raizGit);
  if (raiz === null) return fallo(SALIDA.inesperado, "inesperado", "No pude resolver la raíz del repo.");
  // `realpath` DESPUÉS de resolver: un `--app` que es un enlace hacia afuera tiene que quedar afuera (Review Focus 4).
  const app = d.rutaReal(path.resolve(raiz, flags.app ?? "."));
  if (app === null) return fallo(SALIDA.entradaInvalida, "app_inexistente", "La carpeta de --app no existe (va relativa a la raíz del repo).");
  if (!adentro(raiz, app)) return fallo(SALIDA.entradaInvalida, "app_fuera_del_repo", "--app tiene que ser una carpeta dentro del repo (relativa a su raíz).");
  // Un archivo no es una app: sin esto, leer `<archivo>/package.json` daba ENOTDIR y salía `paquete_ilegible`.
  if (!d.esCarpeta(app)) return fallo(SALIDA.entradaInvalida, "app_inexistente", "--app tiene que ser una carpeta (la de la app), no un archivo.");

  // ─── Proyecto → configuración → package.json de la app → paquete instalado → armar ───
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  let configuracion: Configuracion;
  try {
    configuracion = await d.leerConfiguracion(d.api, p.clave, p.proyecto.id);
  } catch (e) {
    return resultadoDeFallo(e);
  }
  const deLaApp = leerJson(d, path.join(app, "package.json"), "el package.json de la app");
  if (!deLaApp.ok && !deLaApp.noExiste) return deLaApp.resultado;
  const avisos: string[] = [];
  const instalado = paqueteInstalado(d, raiz, app, avisos);
  if (!instalado.ok) return instalado.resultado;
  let x: Instalacion;
  try {
    x = armarInstalacion({ skill: flags.skill, terminal: d.terminal, paqueteDeLaApp: deLaApp.ok ? deLaApp.valor : null, paqueteInstalado: instalado.valor, configuracion });
  } catch (e) {
    return resultadoDeFallo(e);
  }
  const nuevo = serializar(x);

  // ─── ¿Se puede escribir? ───
  const archivo = path.join(raiz, RUTA_DE_LA_INSTALACION);
  // Una `.supcoflow` que es un enlace hacia afuera: ni se lee (el diff mostraría un archivo de afuera) ni se escribe.
  const carpeta = d.rutaReal(path.dirname(archivo));
  if (carpeta !== null && !adentro(raiz, carpeta)) return fallo(SALIDA.inesperado, "inesperado", `${path.dirname(RUTA_DE_LA_INSTALACION)} no es una carpeta del repo (¿un enlace?); no escribo ahí.`);
  const actual = d.leerArchivoChico(archivo, TOPE_DEL_ARCHIVO);
  const existe = !("error" in actual) || actual.error !== "no existe";
  const json = { ok: true, ruta: RUTA_DE_LA_INSTALACION, instalacion: x, ...(avisos.length > 0 ? { avisos } : {}) };
  if ("bytes" in actual && Buffer.from(actual.bytes).equals(Buffer.from(nuevo, "utf8"))) {
    return { codigo: SALIDA.ok, json: { ...json, ...(flags.dryRun ? { dry_run: true } : {}), sin_cambios: true }, texto: `${RUTA_DE_LA_INSTALACION} ya dice eso (${resumen(x)}); no lo toqué.` };
  }
  let estado: Estado;
  try {
    estado = await estadoDelArchivo(d, raizGit, existe);
  } catch (e) {
    return resultadoDeFallo(e);
  }
  if (estado === "cambios_sin_commit") {
    return fallo(SALIDA.haceFaltaUnaPersona, "cambios_sin_commit", `${RUTA_DE_LA_INSTALACION} tiene cambios sin commit (o se borró sin commit); no lo toqué. Commitealos o descartalos y volvé a correr.`);
  }
  if (estado === "archivo_no_versionado") {
    return fallo(SALIDA.haceFaltaUnaPersona, "archivo_no_versionado", `Ya hay un ${RUTA_DE_LA_INSTALACION} que git no guarda (sin commit o ignorado); no lo pisé. Commitealo o borralo y volvé a correr.`);
  }
  const antes = "bytes" in actual ? Buffer.from(actual.bytes).toString("utf8") : null;
  const cambios = existe && antes === null ? `(el archivo anterior no se lee)\n${diff(null, nuevo)}` : diff(antes, nuevo);
  if (flags.dryRun) {
    return { codigo: SALIDA.ok, json: { ...json, dry_run: true, sin_cambios: false }, texto: `Con --dry-run no escribo; sin él anotaría (${resumen(x)}):\n${cambios}` };
  }
  try {
    d.escribir(archivo, nuevo);
  } catch {
    return fallo(SALIDA.inesperado, "archivo_no_escrito", `No pude escribir ${RUTA_DE_LA_INSTALACION}. Volvé a correr \`supcoflow instalacion anotar\`.`);
  }
  return { codigo: SALIDA.ok, json: { ...json, sin_cambios: false }, texto: `Anoté ${RUTA_DE_LA_INSTALACION} (${resumen(x)}); commitealo cuando quieras.\n${cambios}` };
}
