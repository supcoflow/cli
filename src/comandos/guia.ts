// src/comandos/guia.ts
// `guia revisar|publicar|ver|usar` (bloque 5): la guía del producto que vive en el repo del cliente
// (`.supcoflow/guia.md`). La terminal NO decide qué es una guía buena —eso lo decide el parser del motor—;
// lee el archivo, manda UN pedido y traduce la respuesta a los códigos de salida del contrato.
import path from "node:path";
import type { CuerpoDePublicar, elegirOrigen, leerGuia, publicarGuia, Respuesta, revisarGuia, Fetch } from "../api.ts";
import type { Flags } from "../argumentos.ts";
import { resultadoDeFallo, SALIDA, taparSecretos, type Resultado } from "../contrato.ts";
import { huellaDeGuia, MAX_BYTES_DE_LA_GUIA, RUTA_DE_LA_GUIA } from "../guia.ts";
import { repoPedido, type Git } from "../repo-local.ts";
import { desenlace, fallo, rutaDe } from "./configurar.ts";
import { proyectoDelRepo, type DepsDelProyectoDelRepo } from "./proyecto-del-repo.ts";

export type DepsDeGuia = DepsDelProyectoDelRepo & {
  leerArchivoChico(p: string, tope: number): { bytes: Uint8Array } | { error: string };
  // Las funciones de `api.ts` piden el `fetch`; se inyecta acá para que el test no toque la red.
  fetch: Fetch;
  // El git de lo que la terminal DECLARA (commit y rama): aparte de `git` para poder darle un plazo corto y para que
  // un test no lance procesos.
  gitDeclarado: Git;
  revisar: typeof revisarGuia; publicar: typeof publicarGuia; ver: typeof leerGuia; elegir: typeof elegirOrigen;
};

// Texto que viene del motor (o del repo, vía el motor) y sale a la terminal de una persona: sin secretos y sin
// caracteres de control (C0, DEL, C1), que un ESC movería el cursor. Texto y JSON salen del mismo texto ya limpio.
// Primero se quita el control y recién después se tapan los secretos: al revés, una clave partida por un
// control (U+0085, por ejemplo) quedaba entera al quitarlo y se imprimía sin tapar.
const limpio = (t: string) => taparSecretos(t.replace(/[\u0000-\u001f\u007f-\u009f]/g, ""));
const cadena = (v: unknown): string => (typeof v === "string" ? limpio(v) : "");
const corto = (commit: unknown) => cadena(commit).slice(0, 7);
const secciones = (n: unknown) => (typeof n === "number" ? `${n} ${n === 1 ? "sección" : "secciones"}` : "secciones sin contar");
const NOMBRE_DEL_ORIGEN = { repo: "la del repo", agente: "la de nuestro agente" } as const;

// ─── El archivo local ───
// Se busca en la raíz de ESTE clon, nunca en el cwd: parado en una subcarpeta sigue siendo la guía del repo.
// Con `--repo` y sin clon de ese repo no hay dónde leerla (publicar lee la rama, pero la huella sale del archivo).
async function leerLaGuia(d: DepsDeGuia, flags: { repo: string | null }): Promise<{ ok: true; texto: string; raiz: string } | { ok: false; resultado: Resultado }> {
  let raiz: string | null;
  try {
    raiz = (await repoPedido({ flagRepo: flags.repo, git: d.git, cwd: d.cwd })).raiz;
  } catch (e) {
    return { ok: false, resultado: resultadoDeFallo(e) };
  }
  if (raiz === null) {
    return { ok: false, resultado: fallo(SALIDA.entradaInvalida, "falta_guia", `No tengo el clon de ese repo acá, y la guía se lee de ${RUTA_DE_LA_GUIA}: parate en el clon del repo.`) };
  }
  const leido = d.leerArchivoChico(path.join(raiz, RUTA_DE_LA_GUIA), MAX_BYTES_DE_LA_GUIA);
  if ("error" in leido) {
    if (leido.error === "no existe") return { ok: false, resultado: fallo(SALIDA.entradaInvalida, "falta_guia", `Falta ${RUTA_DE_LA_GUIA} en el repo: escribila (una sección por pantalla) y volvé a correr.`) };
    if (leido.error === "es demasiado grande") return { ok: false, resultado: fallo(SALIDA.entradaInvalida, "guia_muy_grande", `${RUTA_DE_LA_GUIA} pasa los ${MAX_BYTES_DE_LA_GUIA / 1024} KB: acortala.`) };
    return { ok: false, resultado: fallo(SALIDA.entradaInvalida, "guia_ilegible", `No leo ${RUTA_DE_LA_GUIA}: ${limpio(leido.error)}.`) };
  }
  try {
    // ignoreBOM: el BOM se CONSERVA en el texto; quitarlo es regla de la huella (`huellaDeGuia`), no de la lectura.
    // fatal: un byte inválido no se reemplaza en silencio, porque la huella de GitHub no coincidiría nunca.
    return { ok: true, raiz, texto: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(leido.bytes) };
  } catch {
    return { ok: false, resultado: fallo(SALIDA.entradaInvalida, "guia_ilegible", `${RUTA_DE_LA_GUIA} no es UTF-8 válido.`) };
  }
}

// ─── El desenlace propio de la guía, encima del de configurar ───
function desenlaceDeGuia(r: Respuesta, ok: (cuerpo: Record<string, unknown>) => Resultado): Resultado {
  const c = r.cuerpo as Record<string, unknown> | null;
  // 2xx, 401, 5xx y cuerpos raros los resuelve el de configurar. Ojo: la terminal no distingue 500
  // connect_no_disponible de 502 github_no_disponible (ambos llegan como falla del servicio): los dos son 1.
  if (r.status < 400 || r.status === 401 || r.status >= 500 || typeof c !== "object" || c === null) return desenlace(r, ok);
  const error = typeof c.error === "string" ? c.error : "rechazado";
  const message = limpio(typeof c.message === "string" ? c.message : `El motor rechazó el pedido (${r.status}).`);
  const con = (codigo: Resultado["codigo"], extra: Record<string, unknown> = {}, texto = message): Resultado =>
    ({ codigo, json: { ok: false, error, message: taparSecretos(message), ...extra }, texto });
  switch (error) {
    case "guia_no_subida":
    case "guia_distinta": {
      const rama = cadena(c.rama), commit = cadena(c.commit);
      const donde = rama !== "" ? ` (rama ${rama}${commit !== "" ? `, commit ${corto(commit)}` : ""})` : "";
      const que = error === "guia_no_subida" ? "La guía no está en la rama principal del repo" : "La guía de la rama principal es otra, no la de tu archivo";
      return con(SALIDA.esperandoAUnaPersona, { rama: c.rama ?? null, commit: c.commit ?? null }, `${que}${donde}: subí la guía a la rama principal y volvé a correr.`);
    }
    case "instalacion_ausente":
    case "repo_fuera_de_alcance":
    case "sin_guia_del_agente":
      return con(SALIDA.haceFaltaUnaPersona);
    case "guia_mal_armada": {
      const errores = Array.isArray(c.errores) ? c.errores : [];
      const lineas = errores.map((e) => {
        const x = (e ?? {}) as { linea?: unknown; motivo?: unknown };
        return `línea ${typeof x.linea === "number" ? x.linea : "?"}: ${cadena(x.motivo)}`;
      });
      return con(SALIDA.entradaInvalida, { errores: errores.map((e) => { const x = (e ?? {}) as { linea?: unknown; motivo?: unknown }; return { linea: x.linea ?? null, motivo: taparSecretos(typeof x.motivo === "string" ? x.motivo : "") }; }) },
        [`${RUTA_DE_LA_GUIA} está mal armada:`, ...lineas].join("\n"));
    }
    default:
      return desenlace(r, ok);
  }
}

export async function guiaRevisar(d: DepsDeGuia, flags: Pick<Flags, "repo" | "dryRun">): Promise<Resultado> {
  const g = await leerLaGuia(d, flags);
  if (!g.ok) return g.resultado;
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  if (flags.dryRun) {
    const haria = `POST ${rutaDe(p.proyecto, "/guia/revisar")} (${new TextEncoder().encode(g.texto).length} bytes)`;
    return { codigo: SALIDA.ok, json: { ok: true, dry_run: true, haria }, texto: `Con --dry-run no hago nada; sin él: ${haria}.` };
  }
  try {
    return desenlaceDeGuia(await d.revisar(d.api, p.clave, p.proyecto.id, g.texto, d.fetch), (c) => ({
      codigo: SALIDA.ok, json: { ok: true, secciones: c.secciones ?? null }, texto: `La guía está bien armada: ${secciones(c.secciones)}.`,
    }));
  } catch (e) {
    return resultadoDeFallo(e);
  }
}

// Commit y rama que la terminal DECLARA: son del clon donde está el archivo, no verificados contra GitHub. Cualquier
// falla (sin git, sin commits, HEAD suelto, plazo vencido) devuelve vacío: declarar es un extra que nunca bloquea la
// subida ni pregunta nada, y lo que git imprima no sale a la terminal.
async function declarado(d: DepsDeGuia, raiz: string): Promise<{ commit?: string; rama?: string }> {
  const leer = async (args: string[]) => {
    try {
      const r = await d.gitDeclarado(args, raiz);
      return r.codigo === 0 ? r.stdout.trim() : null;
    } catch {
      return null;
    }
  };
  const commit = await leer(["rev-parse", "HEAD"]);
  // Sin un commit de 40 hex no se manda ni la rama: una rama sin commit no dice de dónde salió la guía.
  if (commit === null || !/^[0-9a-f]{40}$/.test(commit)) return {};
  const rama = await leer(["rev-parse", "--abbrev-ref", "HEAD"]);
  // «HEAD» a secas es la cabeza suelta: no es una rama.
  return rama !== null && rama !== "" && rama !== "HEAD" ? { commit, rama } : { commit };
}

export async function guiaPublicar(d: DepsDeGuia, flags: Pick<Flags, "repo" | "dryRun"> & { desdeGithub?: boolean }): Promise<Resultado> {
  const g = await leerLaGuia(d, flags);
  if (!g.ok) return g.resultado;
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  const github = flags.desdeGithub === true;
  // La vía de GitHub manda la huella del archivo local TAL CUAL (con BOM y \r\n: normalizarla es regla de
  // `huellaDeGuia`). La directa manda el contenido crudo y el motor calcula la huella: la terminal no la necesita.
  const huella = github ? huellaDeGuia(g.texto) : null;
  const decl = github ? {} : await declarado(d, g.raiz);
  const cuerpo: CuerpoDePublicar = huella !== null ? { huella } : { contenido: g.texto, ...decl };
  const cuando = decl.commit ? `commit ${decl.commit.slice(0, 7)}${decl.rama ? ` de ${cadena(decl.rama)}` : ""} declarado` : "sin commit";
  // El JSON del dry-run pasa por la misma limpieza que el texto (control primero, secretos después): la rama la
  // decide quien escribió el clon, y un ESC en ella no debe llegar a la terminal por ninguna de las dos salidas.
  if (flags.dryRun) {
    const haria = huella !== null
      ? `POST ${rutaDe(p.proyecto, "/guia/publicar")} con la huella ${huella.slice(0, 12)}…`
      : `POST ${rutaDe(p.proyecto, "/guia/publicar")} con el contenido (${new TextEncoder().encode(g.texto).length} bytes), ${cuando}`;
    const json = huella !== null ? { ok: true, dry_run: true, huella, haria } : { ok: true, dry_run: true, commit: decl.commit ? cadena(decl.commit) : null, rama: decl.rama ? cadena(decl.rama) : null, haria };
    return { codigo: SALIDA.ok, json, texto: `Con --dry-run no hago nada; sin él: ${haria}.` };
  }
  try {
    return desenlaceDeGuia(await d.publicar(d.api, p.clave, p.proyecto.id, cuerpo, d.fetch), (c) => {
      const guia = (c.guia ?? {}) as Record<string, unknown>;
      const ya = c.ya_publicada === true;
      const rem = c.reemplaza as { origen?: unknown; version?: unknown } | null | undefined;
      const reemplaza = !ya && rem && rem.origen === "agente" && typeof rem.version === "number" ? ` (reemplaza a la de nuestro agente v${rem.version})` : "";
      const json = { ok: true, guia: c.guia ?? null, ya_publicada: ya, reemplaza: c.reemplaza ?? null };
      if (github) {
        const base = `commit ${corto(guia.commit)} de ${cadena(guia.rama)}, ${secciones(guia.secciones)}`;
        // Republicar re-activa la guía del repo aunque antes rigiera la de nuestro agente: «sigue siendo» mentiría en ese caso.
        const texto = ya ? `Ya estaba publicada: ${base}. Quedó como guía activa.` : `Guía publicada: ${base}. Es la guía activa${reemplaza}.`;
        return { codigo: SALIDA.ok, json, texto };
      }
      // El commit se muestra como lo que es: lo que la terminal dijo, no lo que GitHub confirmó.
      const origen = decl.commit ? `commit ${decl.commit.slice(0, 7)} declarado por la terminal (no verificado en GitHub)` : "sin commit";
      const texto = ya
        ? `Ya estaba subida: ${secciones(guia.secciones)}. Quedó como guía activa; ${origen}.`
        : `Guía subida: ${secciones(guia.secciones)}. Es la guía activa${reemplaza}; ${origen}.`;
      return { codigo: SALIDA.ok, json: { ...json, commit_declarado: decl.commit ?? null }, texto };
    });
  } catch (e) {
    return resultadoDeFallo(e);
  }
}

export async function guiaVer(d: DepsDeGuia, flags: Pick<Flags, "repo">): Promise<Resultado> {
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  try {
    return desenlaceDeGuia(await d.ver(d.api, p.clave, p.proyecto.id, d.fetch), (c) => {
      const guia = c.guia as Record<string, unknown> | null | undefined;
      const otra = c.otra as { origen?: unknown; version?: unknown } | null | undefined;
      const rama = c.rama as { al_dia?: unknown; commit?: unknown } | undefined;
      const alDia = rama && typeof rama.al_dia === "boolean" ? rama.al_dia : null;
      const json = { ok: true, guia: guia ?? null, otra: otra ?? null, al_dia: alDia, rama: rama ?? null };
      if (!guia) return { codigo: SALIDA.ok, json, texto: "Este proyecto no tiene guía activa: `supcoflow guia publicar` sube la del repo." };
      const lineas: string[] = [];
      if (guia.origen === "repo") {
        lineas.push(`Guía activa: ${NOMBRE_DEL_ORIGEN.repo} (versión ${guia.version}, ${secciones(guia.secciones)}).`);
        lineas.push(`Procedencia: ${cadena(guia.repo)}, rama ${cadena(guia.rama)}, commit ${corto(guia.commit)}, publicada por ${cadena(guia.publicada_por)}.`);
        if (alDia === true) lineas.push("Está al día con la rama.");
        else if (alDia === false) lineas.push("En la rama hay otra versión: corré `supcoflow guia publicar`.");
        else lineas.push("No pude comprobar la rama ahora.");
      } else {
        lineas.push(`Guía activa: ${NOMBRE_DEL_ORIGEN.agente} (v${guia.version}, ${secciones(guia.secciones)}).`);
        lineas.push("Procedencia: la escribió nuestro agente y la aprobó una persona.");
      }
      if (otra && (otra.origen === "repo" || otra.origen === "agente")) {
        lineas.push(`También hay ${NOMBRE_DEL_ORIGEN[otra.origen]} (v${typeof otra.version === "number" ? otra.version : "?"}): \`supcoflow guia usar --origen ${otra.origen}\` la activa.`);
      }
      return { codigo: SALIDA.ok, json, texto: lineas.join("\n") };
    });
  } catch (e) {
    return resultadoDeFallo(e);
  }
}

export async function guiaUsar(d: DepsDeGuia, flags: Pick<Flags, "repo" | "dryRun" | "origen">): Promise<Resultado> {
  const origen = flags.origen ?? null;
  if (origen === null) return fallo(SALIDA.entradaInvalida, "falta_origen", "Decí cuál: `supcoflow guia usar --origen repo` o `--origen agente`.");
  if (origen !== "repo" && origen !== "agente") return fallo(SALIDA.entradaInvalida, "origen_invalido", "--origen es `repo` o `agente`.");
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  if (flags.dryRun) {
    const haria = `POST ${rutaDe(p.proyecto, "/guia/origen")} {origen: ${origen}}`;
    return { codigo: SALIDA.ok, json: { ok: true, dry_run: true, haria }, texto: `Con --dry-run no hago nada; sin él: ${haria}.` };
  }
  try {
    return desenlaceDeGuia(await d.elegir(d.api, p.clave, p.proyecto.id, origen, d.fetch), (c) => ({
      codigo: SALIDA.ok, json: { ok: true, guia: c.guia ?? null }, texto: `Ahora la guía activa es ${NOMBRE_DEL_ORIGEN[origen]}.`,
    }));
  } catch (e) {
    return resultadoDeFallo(e);
  }
}
