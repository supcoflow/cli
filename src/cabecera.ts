// La cabecera opcional de un documento de la carpeta `.supcoflow/knowledge/*.md` (guía MVP 2/3):
//
//     ---
//     title: Billing
//     summary: Invoices, payments and refunds.
//     sources:
//       - app/billing/**
//       - src/billing/**
//     ---
//
// Copia declarada de `src/guia/cabecera.ts` del motor (PR 197): la terminal lee las MISMAS cabeceras que el motor,
// con una sola definición y los mismos casos (`test/cabecera.test.ts`) y el mismo corpus de motivos
// (`test/vectores/motivos-de-la-carpeta.json`). El motor sólo GUARDA `sources`; quien las usa es `guide stale`, que las
// cruza con lo que tocó un PR. Una cabecera que el motor rechazaría acá es «mapa roto»: nunca se lee a medias.
//
// Un YAML mínimo escrito a mano, como en el motor: sólo hay tres claves y una lista, y el texto viene de un repo
// ajeno. Lo que no sea `clave: valor`, o una clave desconocida, es un error con su línea: una errata como `source:`
// no puede pasar callada y dejar al detector sin mapa.

export type CabeceraDeLaGuia = { title?: string; summary?: string; sources: string[] };
export type ErrorDeCabecera = { linea: number; motivo: string };

export const MAX_TITULO_DE_CABECERA = 120;
export const MAX_RESUMEN_DE_CABECERA = 600;
export const MAX_FUENTES_DE_CABECERA = 50;
export const MAX_LARGO_DE_FUENTE = 200;

const CLAVES = ["title", "summary", "sources"] as const;
const MARCA = "---";

const sinComillas = (v: string): string => {
  const t = v.trim();
  return t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0] ? t.slice(1, -1).trim() : t;
};

/** Parte `a, "b, c", src/{d,e}/**` por las comas de afuera: una coma dentro de llaves o comillas es parte del glob. */
const partirLista = (texto: string): string[] => {
  const partes: string[] = [];
  let actual = "";
  let llaves = 0;
  let comilla = "";
  for (const c of texto) {
    if (comilla) {
      if (c === comilla) comilla = "";
    } else if ((c === '"' || c === "'") && actual.trim() === "") comilla = c;
    else if (c === "{") llaves++;
    else if (c === "}" && llaves > 0) llaves--;
    else if (c === "," && llaves === 0) {
      partes.push(actual);
      actual = "";
      continue;
    }
    actual += c;
  }
  partes.push(actual);
  return partes;
};

/**
 * Lee la cabecera si la primera línea no vacía es `---`. `hasta` es el índice (0-based) de la primera línea que ya
 * NO es cabecera. Sin cabecera, `hasta` es 0 y no se toca nada. Una cabecera sin cerrar se come el resto del archivo.
 */
export function leerCabecera(lineas: string[]): { cabecera?: CabeceraDeLaGuia; hasta: number; errores: ErrorDeCabecera[] } {
  const apertura = lineas.findIndex((l) => l.trim() !== "");
  if (apertura === -1 || lineas[apertura]!.trim() !== MARCA) return { hasta: 0, errores: [] };

  const errores: ErrorDeCabecera[] = [];
  const err = (linea: number, motivo: string) => errores.push({ linea, motivo });

  const cierre = lineas.findIndex((l, i) => i > apertura && l.trim() === MARCA);
  if (cierre === -1) {
    err(apertura + 1, "the header opened with --- is never closed");
    return { hasta: lineas.length, errores };
  }

  const cabecera: CabeceraDeLaGuia = { sources: [] };
  const vistas = new Set<string>();
  let enLista = false;
  let lineaDeFuentes = 0;
  const sumarFuente = (n: number, valor: string) => {
    const t = valor.trim();
    const v = sinComillas(valor);
    if ((t[0] === '"' || t[0] === "'") && (t.length < 2 || t[t.length - 1] !== t[0])) err(n, "a «sources» entry opens a quote it never closes");
    else if (v === "") err(n, "a «sources» entry is empty");
    else if (v.length > MAX_LARGO_DE_FUENTE) err(n, `a «sources» entry is over ${MAX_LARGO_DE_FUENTE} characters`);
    else cabecera.sources.push(v);
  };

  for (let i = apertura + 1; i < cierre; i++) {
    const n = i + 1;
    const l = lineas[i]!.trim();
    if (l === "") continue;
    // `trim()` ya se comió el espacio de un «- » sin valor: ese `-` solo es una entrada vacía, no una clave mal escrita.
    if (enLista && (l === "-" || l.startsWith("- "))) {
      sumarFuente(n, l.slice(1));
      continue;
    }
    enLista = false;
    const m = /^([A-Za-z_]+):(.*)$/.exec(l);
    if (!m) {
      err(n, "the header lines are «key: value» (title, summary, sources)");
      continue;
    }
    const clave = m[1]!;
    const valor = m[2]!.trim();
    if (!(CLAVES as readonly string[]).includes(clave)) {
      err(n, `unknown header key «${clave}» (allowed: title, summary, sources)`);
      continue;
    }
    if (vistas.has(clave)) err(n, `the header key «${clave}» is repeated`);
    vistas.add(clave);

    if (clave === "sources") {
      lineaDeFuentes = n;
      if (valor === "") enLista = true; // lista en bloque: las líneas «- x» siguientes
      else if (valor.startsWith("[") && !valor.endsWith("]")) err(n, "the «sources» list opened with [ is never closed");
      else if (valor.startsWith("[")) {
        for (const parte of partirLista(valor.slice(1, -1))) if (parte.trim() !== "") sumarFuente(n, parte);
      } else sumarFuente(n, valor); // `sources: app/**` sin lista = una sola fuente
      continue;
    }
    const v = sinComillas(valor);
    const tope = clave === "title" ? MAX_TITULO_DE_CABECERA : MAX_RESUMEN_DE_CABECERA;
    if (v === "") err(n, `the header key «${clave}» is empty`);
    else if (v.length > tope) err(n, `the header key «${clave}» is over ${tope} characters`);
    else if (clave === "title") cabecera.title = v;
    else cabecera.summary = v;
  }
  // El tope se avisa UNA vez, en la línea de la clave, no por cada entrada de más.
  if (cabecera.sources.length > MAX_FUENTES_DE_CABECERA) err(lineaDeFuentes, `at most ${MAX_FUENTES_DE_CABECERA} «sources» per document`);
  return { cabecera, hasta: cierre + 1, errores };
}
