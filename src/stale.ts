// El detector de documentos viejos de la carpeta `.supcoflow/knowledge/` (guía MVP 2/3), SIN IA y sin llamar al motor:
// cruza los archivos que tocó un cambio con los `sources` (globs de código) que cada documento dice que explica, y
// avisa «tocaste X y no tocaste el documento que lo explica». Este archivo es la parte pura (globs y reglas); lo que
// lee de git y de disco vive en `comandos/guia-stale.ts`.
//
// Qué promete y qué no: cero omisiones DENTRO de su cobertura estructural (qué se tocó y qué no). No puede saber si un
// texto es verdadero o suficiente, ni lo promete: un documento «actualizado» con otro texto equivocado queda en verde.
// Lo que el mapa no cubre se dice aparte (`fuera_del_mapa`, una nota) en vez de callarse.
import { leerCabecera, type ErrorDeCabecera } from "./cabecera.ts";
import { lineasDeLaGuia, ordenarDocumentos } from "./guia.ts";

// ─── Los globs de `sources` ───
// `*` y `?` no cruzan una `/`; `**` sí; `{a,b}` y `[abc]` / `[!abc]`. Sin dependencias: lo que viene de un repo ajeno
// nunca se evalúa como regex tal cual, se traduce carácter por carácter. Un patrón sin comodines vale por el archivo y
// por todo lo que haya adentro si es una carpeta (`app/billing` = `app/billing/**`).
const MAGIA = /[*?{[]/;

function cierreDeLlave(p: string, desde: number): number {
  let nivel = 0;
  for (let i = desde; i < p.length; i++) {
    if (p[i] === "{") nivel++;
    else if (p[i] === "}" && --nivel === 0) return i;
  }
  return -1;
}

function partirAlternativas(cuerpo: string): string[] {
  const partes: string[] = [];
  let nivel = 0;
  let actual = "";
  for (const c of cuerpo) {
    if (c === "{") nivel++;
    else if (c === "}") nivel--;
    if (c === "," && nivel === 0) {
      partes.push(actual);
      actual = "";
    } else actual += c;
  }
  partes.push(actual);
  return partes;
}

const escapar = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function aRegex(p: string): string {
  let r = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === "*") {
      let j = i;
      while (p[j + 1] === "*") j++;
      const entero = j > i && (i === 0 || p[i - 1] === "/");
      if (entero && p[j + 1] === "/") { r += "(?:.*/)?"; i = j + 1; } // `**/`: cero o más carpetas
      else if (entero && j + 1 === p.length) { r += ".*"; i = j; } // `/**` al final: todo lo de adentro
      else { r += "[^/]*"; i = j; } // `*` suelto, o `**` pegado a otras letras: no cruza `/`
    } else if (c === "?") r += "[^/]";
    else if (c === "{") {
      const fin = cierreDeLlave(p, i);
      if (fin === -1) r += escapar(c); // una llave sin cerrar es literal
      else {
        r += `(?:${partirAlternativas(p.slice(i + 1, fin)).map(aRegex).join("|")})`;
        i = fin;
      }
    } else if (c === "[") {
      const fin = p.indexOf("]", i + 2);
      if (fin === -1) r += escapar(c);
      else {
        const clase = p.slice(i + 1, fin);
        r += `[${clase.startsWith("!") ? "^" : ""}${(clase.startsWith("!") ? clase.slice(1) : clase).replace(/[\\\]^]/g, "\\$&")}]`;
        i = fin;
      }
    } else r += escapar(c);
  }
  return r;
}

const compilados = new Map<string, (ruta: string) => boolean>();
function compilar(patron: string): (ruta: string) => boolean {
  const sinPuntoBarra = patron.replace(/^(?:\.\/)+/, "").replace(/^\/+/, "");
  const sinBarraFinal = sinPuntoBarra.replace(/\/+$/, "");
  if (!MAGIA.test(sinPuntoBarra)) {
    return (ruta) => ruta === sinBarraFinal || ruta.startsWith(`${sinBarraFinal}/`);
  }
  const glob = sinBarraFinal === sinPuntoBarra ? sinPuntoBarra : `${sinBarraFinal}/**`;
  try {
    const re = new RegExp(`^${aRegex(glob)}$`, "u");
    return (ruta) => re.test(ruta);
  } catch {
    return (ruta) => ruta === sinPuntoBarra; // un patrón que no se puede leer como glob vale sólo por su texto
  }
}

/** ¿Este camino del repo (con `/`, sin `./`) lo cubre el patrón de `sources`? */
export function coincide(patron: string, ruta: string): boolean {
  let f = compilados.get(patron);
  if (f === undefined) {
    f = compilar(patron);
    compilados.set(patron, f);
  }
  return f(ruta);
}

// ─── El mapa: qué documento explica qué ───
export type DocumentoDelMapa = { nombre: string; ruta: string; sources: string[]; errores: ErrorDeCabecera[] };

/** Lee la cabecera de cada documento. Una cabecera con errores queda SIN fuentes: nunca se lee a medias. */
export function leerElMapa(carpeta: string, documentos: readonly { nombre: string; texto: string }[]): DocumentoDelMapa[] {
  return ordenarDocumentos(documentos).map((d) => {
    const { cabecera, errores } = leerCabecera(lineasDeLaGuia(d.texto));
    return { nombre: d.nombre, ruta: `${carpeta}/${d.nombre}`, sources: errores.length > 0 ? [] : (cabecera?.sources ?? []), errores };
  });
}

export type Severidad = "aviso" | "nota";
export type TipoDeAviso =
  | "mapa_vacio" | "mapa_roto" | "documento_sin_fuentes" | "fuente_sin_archivos"
  | "documento_sin_tocar" | "cambio_cosmetico" | "cobertura_quitada" | "fuera_del_mapa" | "no_se_pudo_comparar";
export type Aviso = {
  tipo: TipoDeAviso;
  /** `aviso`: algo que el cambio debería arreglar (cuenta para `--strict`). `nota`: información, no bloquea. */
  severidad: Severidad;
  mensaje: string;
  documento?: string;
  patron?: string;
  patrones?: string[];
  archivos?: string[];
  documentos_tocados?: string[];
  errores?: ErrorDeCabecera[];
  /** Sólo en `no_se_pudo_comparar`: por qué (`base_no_encontrada`, `clon_superficial`, `sin_historia_comun`, `git_no_pudo_listar`). */
  motivo?: string;
};

const MUESTRA = 5;
const lista = (xs: string[], tope = MUESTRA) => (xs.length <= tope ? xs.join(", ") : `${xs.slice(0, tope).join(", ")} and ${xs.length - tope} more`);
const esDeSupcoflow = (ruta: string) => ruta.startsWith(".supcoflow/");

/** Lo que se ve del mapa solo, sin mirar ningún cambio. `archivos` = los del repo ahora; `null` si no se pudieron listar. */
export function avisosDelMapa(mapa: readonly DocumentoDelMapa[], archivos: readonly string[] | null): Aviso[] {
  const avisos: Aviso[] = [];
  if (mapa.length === 0) {
    avisos.push({ tipo: "mapa_vacio", severidad: "aviso", mensaje: "The map is empty: `.supcoflow/knowledge/` has no documents, so there is nothing to compare the change against. Write the documents (`/supcoflow guide`) and give each one its `sources`." });
    return avisos;
  }
  for (const d of mapa) {
    if (d.errores.length === 0) continue;
    const lineas = d.errores.map((e) => `line ${e.linea}: ${e.motivo}`);
    avisos.push({ tipo: "mapa_roto", severidad: "aviso", documento: d.ruta, errores: d.errores, mensaje: `The header of ${d.ruta} is broken, so I can't read which code it explains (${lineas.join("; ")}). Fix the header; \`supcoflow guide check\` says the same.` });
  }
  const validos = mapa.filter((d) => d.errores.length === 0);
  if (validos.every((d) => d.sources.length === 0)) {
    avisos.push({ tipo: "mapa_vacio", severidad: "aviso", mensaje: "The map is empty: no document declares `sources` in its header, so I can't tell which code each one explains. Add `sources:` (globs of code) to each document's header." });
    return avisos;
  }
  const delRepo = archivos === null ? null : archivos.filter((f) => !esDeSupcoflow(f));
  for (const d of validos) {
    if (d.sources.length === 0) {
      avisos.push({ tipo: "documento_sin_fuentes", severidad: "nota", documento: d.ruta, mensaje: `${d.ruta} has no \`sources\`, so a change to the code it explains can't be linked to it. Add \`sources:\` to its header.` });
      continue;
    }
    if (delRepo === null) continue;
    for (const patron of d.sources) {
      if (delRepo.some((f) => coincide(patron, f))) continue;
      avisos.push({ tipo: "fuente_sin_archivos", severidad: "aviso", documento: d.ruta, patron, mensaje: `The source \`${patron}\` of ${d.ruta} matches no file in the repo: it was moved or deleted. Point it at where that code lives now (or remove it).` });
    }
  }
  return avisos;
}

/** `A` agregado (o nuevo sin seguimiento), `M` modificado, `D` borrado (un movido es un `D` y un `A`). */
export type Cambio = { ruta: string; estado: "A" | "M" | "D"; soloEspacios?: boolean };

/**
 * Lo que dice el cambio frente al mapa. Sólo documentos con cabecera sana y fuentes entran a la comparación.
 * `mapaBase` es el mapa en el ancestro común: una fuente que estaba ahí y ya no está en ningún documento (documento
 * borrado o patrón quitado) es `cobertura_quitada` si el cambio tocó código que esa fuente cubría y que hoy ningún documento cubre.
 */
export function avisosDelCambio(mapa: readonly DocumentoDelMapa[], cambios: readonly Cambio[], mapaBase: readonly DocumentoDelMapa[] = []): { avisos: Aviso[]; cambiados: number; cubiertos: number; sin_cubrir: number } {
  const codigo = cambios.filter((c) => !esDeSupcoflow(c.ruta));
  const delMapa = mapa.filter((d) => d.errores.length === 0 && d.sources.length > 0);
  const real = new Set(cambios.filter((c) => c.estado !== "D" && c.soloEspacios !== true).map((c) => c.ruta));
  const cosmetico = new Set(cambios.filter((c) => c.estado === "M" && c.soloEspacios === true).map((c) => c.ruta));
  const tocados = mapa.map((d) => d.ruta).filter((r) => real.has(r));
  const avisos: Aviso[] = [];

  for (const d of delMapa) {
    const tocadosPorElCodigo = codigo.filter((c) => d.sources.some((p) => coincide(p, c.ruta)));
    if (tocadosPorElCodigo.length === 0 || real.has(d.ruta)) continue;
    const archivos = tocadosPorElCodigo.map((c) => c.ruta).sort();
    const patrones = d.sources.filter((p) => tocadosPorElCodigo.some((c) => coincide(p, c.ruta)));
    const dicho = lista(tocadosPorElCodigo.map((c) => (c.estado === "D" ? `${c.ruta} (deleted or moved)` : c.ruta)).sort());
    if (cosmetico.has(d.ruta)) {
      avisos.push({ tipo: "cambio_cosmetico", severidad: "aviso", documento: d.ruta, archivos, patrones, mensaje: `You changed ${dicho} and ${d.ruta} changed only in whitespace, which doesn't update what it says. Update the text it gives about that code.` });
      continue;
    }
    avisos.push({
      tipo: "documento_sin_tocar", severidad: "aviso", documento: d.ruta, archivos, patrones,
      ...(tocados.length > 0 ? { documentos_tocados: tocados } : {}),
      mensaje: `You changed ${dicho} (it matches \`${lista(patrones)}\`) and didn't change ${d.ruta}, the document that explains it${tocados.length > 0 ? `; you did change ${lista(tocados)}, which doesn't map to that code` : ""}. Update ${d.ruta} in this same change.`,
    });
  }

  const cubierto = (ruta: string) => delMapa.some((d) => d.sources.some((p) => coincide(p, ruta)));
  const fuentesDeAhora = new Set(delMapa.flatMap((d) => d.sources));
  const rotosAhora = new Set(mapa.filter((m) => m.errores.length > 0).map((m) => m.ruta));
  for (const d of mapaBase.filter((b) => b.errores.length === 0 && !rotosAhora.has(b.ruta))) {
    const quitados = d.sources.filter((p) => !fuentesDeAhora.has(p));
    if (quitados.length === 0) continue;
    const archivos = codigo.filter((c) => !cubierto(c.ruta) && quitados.some((p) => coincide(p, c.ruta))).map((c) => c.ruta).sort();
    if (archivos.length === 0) continue;
    const que = mapa.some((m) => m.ruta === d.ruta) ? `You removed \`${lista(quitados)}\` from the \`sources\` of ${d.ruta}` : `You deleted ${d.ruta} (its \`sources\` had \`${lista(quitados)}\`)`;
    avisos.push({
      tipo: "cobertura_quitada", severidad: "aviso", documento: d.ruta, patrones: quitados, archivos,
      mensaje: `${que}, and this change touches ${lista(archivos)}, which no document covers now. Update the document that explains that code (and put the path in its \`sources\`).`,
    });
  }

  const sinCubrir = codigo.filter((c) => !cubierto(c.ruta));
  const nuevos = sinCubrir.filter((c) => c.estado === "A").map((c) => c.ruta).sort();
  if (nuevos.length > 0) {
    avisos.push({
      tipo: "fuera_del_mapa", severidad: "nota", archivos: nuevos,
      mensaje: `New files that no document's \`sources\` cover: ${lista(nuevos, 20)}. If users can see them, add their path to the \`sources\` of the document that explains them (or write a new document); if they are not visible to users, ignore this note.`,
    });
  }
  // Los de cada documento en orden de nombre y, al final, lo que el mapa no cubre.
  const orden = (a: Aviso) => (a.tipo === "fuera_del_mapa" ? 1 : 0);
  avisos.sort((a, b) => orden(a) - orden(b));
  return { avisos, cambiados: codigo.length, cubiertos: codigo.length - sinCubrir.length, sin_cubrir: sinCubrir.length };
}
