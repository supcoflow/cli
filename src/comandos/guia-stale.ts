// src/comandos/guia-stale.ts
// `supcoflow guide stale --base <ref>` (guía MVP 2/3): el detector de documentos viejos. SIN IA, SIN motor y sin sesión:
// sólo lee git y el disco del clon. Cruza lo que tocó el cambio (contra la base) con los `sources` de cada documento de
// `.supcoflow/knowledge/` y avisa «tocaste X y no tocaste el documento que lo explica» (las reglas, en `../stale.ts`).
//
// Una regla manda sobre las demás: NUNCA dice «nada que avisar» si no pudo mirar. Un mapa vacío o roto, una fuente que ya
// no coincide con nada y una base que no está (o un clon superficial) son avisos con nombre propio, distintos entre sí.
// Sale 0 siempre (sólo avisa) salvo con `--strict`, que sale 4 si hay algún aviso (las notas no cuentan).
import type { Flags } from "../argumentos.ts";
import { SALIDA, type Resultado } from "../contrato.ts";
import { limpiarTodo, limpio } from "../limpio.ts";
import type { Git } from "../repo-local.ts";
import { avisosDelCambio, avisosDelMapa, leerElMapa, type Aviso, type Cambio, type DocumentoDelMapa } from "../stale.ts";
import { esCandidatoDeDocumento, RUTA_DE_LA_CARPETA } from "../guia.ts";
import { leerLaCarpeta, type DepsDeCarpeta } from "./carpeta-de-la-guia.ts";

export type DepsDeStale = DepsDeCarpeta & { git: Git; cwd: string };

const fallo = (error: string, message: string): Resultado => ({ codigo: SALIDA.entradaInvalida, json: { ok: false, error, message }, texto: message });

// Un ref de git no empieza con `-` (sería un flag para git) ni lleva espacios o control.
const BASE_VALIDA = /^[^\s\u0000-\u001f\u007f-\u009f-][^\s\u0000-\u001f\u007f-\u009f]*$/;

const salida = (r: { stdout: string }): string[] => r.stdout.split("\u0000").filter((x) => x !== "");

type Comparacion =
  | { ok: true; baseCommit: string; cambios: Cambio[]; mapaBase: DocumentoDelMapa[] }
  | { ok: false; motivo: "base_no_encontrada" | "clon_superficial" | "sin_historia_comun" | "git_no_pudo_listar"; mensaje: string };

const COMO_TRAER_LA_HISTORIA = "In GitHub Actions use `actions/checkout` with `fetch-depth: 0`; elsewhere fetch the base (`git fetch origin <branch>`) and, if the clone is shallow, `git fetch --unshallow`.";

async function comparar(d: DepsDeStale, raiz: string, base: string, mapa: readonly DocumentoDelMapa[], textos: ReadonlyMap<string, string>): Promise<Comparacion> {
  const git = (args: string[]) => d.git(args, raiz);
  const existe = await git(["rev-parse", "--verify", "--quiet", `${base}^{commit}`]);
  const superficial = (await git(["rev-parse", "--is-shallow-repository"])).stdout.trim() === "true";
  if (existe.codigo !== 0) {
    return {
      ok: false, motivo: superficial ? "clon_superficial" : "base_no_encontrada",
      mensaje: superficial
        ? `This clone is shallow and doesn't have \`${base}\`, so I could not compare the change. ${COMO_TRAER_LA_HISTORIA}`
        : `I could not find \`${base}\` in this clone, so I could not compare the change. ${COMO_TRAER_LA_HISTORIA}`,
    };
  }
  const mb = await git(["merge-base", base, "HEAD"]);
  const comun = mb.stdout.trim();
  if (mb.codigo !== 0 || !/^[0-9a-f]{40,64}$/.test(comun)) {
    return {
      ok: false, motivo: superficial ? "clon_superficial" : "sin_historia_comun",
      mensaje: superficial
        ? `This clone is shallow: \`${base}\` and HEAD have no common commit in the history I have, so I could not compare the change. ${COMO_TRAER_LA_HISTORIA}`
        : `\`${base}\` and HEAD share no history, so I could not compare the change. Pick a base this branch comes from.`,
    };
  }
  // Lo tocado desde el ancestro común hasta lo que hay ahora en disco (lo ya commiteado, lo preparado y lo modificado) y
  // los archivos nuevos sin seguimiento: sirve igual en un CI (árbol limpio) que a un asistente antes de commitear.
  // `--no-renames`: un movido es un borrado y un archivo nuevo, y los dos cuentan.
  const diff = await git(["diff", "--name-status", "--no-renames", "-z", comun]);
  const nuevos = await git(["ls-files", "--others", "--exclude-standard", "-z"]);
  if (diff.codigo !== 0 || nuevos.codigo !== 0) {
    return { ok: false, motivo: "git_no_pudo_listar", mensaje: "git could not list the changed files, so I could not compare the change." };
  }
  const cambios: Cambio[] = [];
  const t = salida(diff);
  for (let i = 0; i + 1 < t.length; i += 2) {
    const letra = t[i]![0];
    cambios.push({ ruta: t[i + 1]!, estado: letra === "A" ? "A" : letra === "D" ? "D" : "M" });
  }
  for (const ruta of salida(nuevos)) cambios.push({ ruta, estado: "A" });

  // Un documento «actualizado» sólo con espacios no se actualizó: se compara lo que dice sin contar los espacios.
  for (const c of cambios) {
    const actual = c.estado === "M" ? textos.get(c.ruta) : undefined;
    if (actual === undefined || !mapa.some((m) => m.ruta === c.ruta)) continue;
    const antes = await git(["show", `${comun}:${c.ruta}`]);
    if (antes.codigo === 0 && antes.stdout.replace(/\s+/g, "") === actual.replace(/\s+/g, "")) c.soloEspacios = true;
  }

  // El mapa del ancestro común: lo que cubría antes del cambio, para no perder una fuente que el cambio borró o quitó.
  const arbol = await git(["ls-tree", "-z", comun, "--", `${RUTA_DE_LA_CARPETA}/`]);
  if (arbol.codigo !== 0) return { ok: false, motivo: "git_no_pudo_listar", mensaje: "git could not read the map at the base, so I could not compare the change." };
  const documentosBase: { nombre: string; texto: string }[] = [];
  for (const entrada of salida(arbol)) {
    const [info, ruta] = entrada.split("\t") as [string, string | undefined];
    const nombre = ruta?.slice(RUTA_DE_LA_CARPETA.length + 1) ?? "";
    if (!/^100(?:644|755) blob /.test(info) || !esCandidatoDeDocumento(nombre)) continue;
    const texto = await git(["show", `${comun}:${ruta}`]);
    if (texto.codigo !== 0) return { ok: false, motivo: "git_no_pudo_listar", mensaje: "git could not read the map at the base, so I could not compare the change." };
    documentosBase.push({ nombre, texto: texto.stdout });
  }
  return { ok: true, baseCommit: comun, cambios, mapaBase: leerElMapa(RUTA_DE_LA_CARPETA, documentosBase) };
}

const sinSeveridad = ({ severidad: _s, ...resto }: Aviso) => resto;

export async function guiaStale(d: DepsDeStale, flags: Pick<Flags, "base" | "strict">): Promise<Resultado> {
  if (flags.base === null) return fallo("falta_base", "Say which ref to compare against: `supcoflow guide stale --base origin/main`.");
  const base = flags.base;
  if (!BASE_VALIDA.test(base)) return fallo("base_invalida", "--base is a git ref such as origin/main (no spaces, and it can't start with -).");
  const top = await d.git(["rev-parse", "--show-toplevel"], d.cwd);
  const raiz = top.codigo === 0 ? top.stdout.trim() : "";
  if (raiz === "") return fallo("sin_repo", "I couldn't find a git repo here: stand in the repo's clone.");

  // El mapa: los documentos de la carpeta y las fuentes de cada cabecera. Una carpeta que no se puede leer no se
  // omite: es un mapa roto con su motivo.
  const carpeta = leerLaCarpeta(d, raiz);
  const documentos = carpeta.tipo === "carpeta" ? carpeta.documentos : [];
  const mapa = leerElMapa(RUTA_DE_LA_CARPETA, documentos);
  const textos = new Map(documentos.map((x) => [`${RUTA_DE_LA_CARPETA}/${x.nombre}`, x.texto]));

  // El inventario de archivos del repo ahora. Las DOS lecturas tienen que salir bien: si una falla, no se reemplaza por una
  // lista vacía (ni se asume que no hay borrados): sin inventario fiable no se afirma nada de los patrones que no coinciden con
  // ningún archivo, y se avisa que la comprobación quedó incompleta.
  const lista = await d.git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"], raiz);
  const borrados = await d.git(["ls-files", "--deleted", "-z"], raiz);
  const fallidas = [lista.codigo === 0 ? null : "`git ls-files`", borrados.codigo === 0 ? null : "`git ls-files --deleted`"].filter((x) => x !== null);
  const inventarioCompleto = fallidas.length === 0;
  const sinBorrados = new Set(inventarioCompleto ? salida(borrados) : []);
  const archivos = inventarioCompleto ? salida(lista).filter((f) => !sinBorrados.has(f)) : null;

  const avisos: Aviso[] = [];
  if (carpeta.tipo === "error") {
    const m = carpeta.resultado.json.message;
    avisos.push({ tipo: "mapa_roto", severidad: "aviso", mensaje: `I can't read the map: ${typeof m === "string" ? m : "the folder is unreadable"}` });
  } else {
    avisos.push(...avisosDelMapa(mapa, archivos));
  }

  let comparacion: Comparacion | null = null;
  let resumen = { cambiados: null as number | null, cubiertos: null as number | null, sin_cubrir: null as number | null };
  let baseCommit: string | null = null;
  const hayMapaUsable = mapa.some((m) => m.errores.length === 0 && m.sources.length > 0);
  if (hayMapaUsable) {
    comparacion = await comparar(d, raiz, base, mapa, textos);
    if (comparacion.ok) {
      const r = avisosDelCambio(mapa, comparacion.cambios, comparacion.mapaBase);
      avisos.push(...r.avisos);
      resumen = { cambiados: r.cambiados, cubiertos: r.cubiertos, sin_cubrir: r.sin_cubrir };
      baseCommit = comparacion.baseCommit;
    } else {
      avisos.push({ tipo: "no_se_pudo_comparar", severidad: "aviso", mensaje: comparacion.mensaje, motivo: comparacion.motivo });
    }
  }
  if (!inventarioCompleto) {
    avisos.push({
      tipo: "no_se_pudo_comparar", severidad: "aviso", motivo: "git_no_pudo_listar",
      mensaje: `git could not list the files of the repo (${fallidas.join(" and ")} failed), so I could not complete the check: I can't tell which \`sources\` patterns still match a file. Run it again; if it keeps failing, check that git works in this clone.`,
    });
  }
  // `comparado` dice que la comprobación se COMPLETÓ: el diff contra la base Y el inventario de archivos. Lo que sí se calculó
  // (los avisos del diff, `cambiados`, `cubiertos`) se conserva aunque `comparado` sea false.
  const diffComparado = comparacion?.ok === true;
  const comparado = diffComparado && inventarioCompleto;

  // Lo que viene del repo (rutas, globs, nombres) se limpia ANTES de armar el texto: limpiar el texto entero se llevaría
  // también los saltos de línea del propio mensaje.
  const limpios = limpiarTodo(avisos);
  const reales = limpios.filter((a) => a.severidad === "aviso");
  const notas = limpios.filter((a) => a.severidad === "nota");
  const estricto = flags.strict && reales.length > 0;

  // El texto: lo que se hizo, cada aviso con qué hacer, y NUNCA «nada que avisar» si no se pudo mirar.
  const lineas: string[] = [];
  const n = documentos.length;
  const baseLimpia = limpio(base);
  if (comparado) {
    lineas.push(resumen.cambiados === 0
      ? `Compared with \`${baseLimpia}\`: no files changed (map of ${n} ${n === 1 ? "document" : "documents"}).`
      : `Compared ${resumen.cambiados} changed ${resumen.cambiados === 1 ? "file" : "files"} with \`${baseLimpia}\` against the map of ${n} ${n === 1 ? "document" : "documents"}.`);
  } else if (diffComparado) {
    lineas.push(`Compared ${resumen.cambiados} changed ${resumen.cambiados === 1 ? "file" : "files"} with \`${baseLimpia}\`, but I could not complete the check (see below).`);
  } else if (hayMapaUsable) lineas.push(`I could not compare the change with \`${baseLimpia}\`.`);
  else lineas.push("I could not compare the change: there is no usable map (see below).");
  if (reales.length === 0 && comparado) lineas.push("Nothing to warn.");
  if (reales.length > 0) lineas.push(`${reales.length} ${reales.length === 1 ? "warning" : "warnings"}:`, ...reales.map((a, i) => `${i + 1}. ${a.mensaje}`));
  if (notas.length > 0) lineas.push(`${notas.length} ${notas.length === 1 ? "note" : "notes"} (they don't fail --strict):`, ...notas.map((a) => `- ${a.mensaje}`));
  if (estricto) lineas.push("--strict: exiting 4 because of the warnings above.");

  const json = {
    ok: !estricto, comparado, base: baseLimpia, base_commit: baseCommit, documentos: n, ...resumen,
    avisos: reales.map(sinSeveridad), notas: notas.map(sinSeveridad),
    ...(estricto ? { error: "guia_desactualizada", message: `${reales.length} ${reales.length === 1 ? "warning" : "warnings"} with --strict.` } : {}),
  };
  return { codigo: estricto ? SALIDA.haceFaltaUnaPersona : SALIDA.ok, json, texto: lineas.join("\n") };
}
