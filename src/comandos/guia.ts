// src/comandos/guia.ts
// `guide check|publish|show|use|versions` (bloque 5 y 0.8.0): la guía del producto que vive en el repo del cliente
// (`.supcoflow/guide.md`; el nombre viejo `guia.md` se lee sólo si `guide.md` no existe). La terminal NO decide qué
// es una guía buena —eso lo decide el parser del motor—; lee el archivo, manda UN pedido y traduce la respuesta a
// los códigos de salida del contrato.
import path from "node:path";
import type { CuerpoDePublicar, elegirOrigen, leerGuia, leerVersionesDeLaGuia, publicarGuia, Respuesta, revisarGuia, Fetch } from "../api.ts";
import type { Flags } from "../argumentos.ts";
import { resultadoDeFallo, SALIDA, taparSecretos, type Resultado } from "../contrato.ts";
import { huellaDeGuia, MAX_BYTES_DE_LA_GUIA, RUTA_DE_LA_GUIA, RUTA_VIEJA_DE_LA_GUIA } from "../guia.ts";
import { NO_LEIDO } from "../lectura.ts";
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
  versiones: typeof leerVersionesDeLaGuia;
};

// Texto que viene del motor (o del repo, vía el motor) y sale a la terminal de una persona: sin secretos y sin
// caracteres de control (C0, DEL, C1), que un ESC movería el cursor. Texto y JSON salen del mismo texto ya limpio.
// Primero se quita el control y recién después se tapan los secretos: al revés, una clave partida por un
// control (U+0085, por ejemplo) quedaba entera al quitarlo y se imprimía sin tapar.
const limpio = (t: string) => taparSecretos(t.replace(/[\u0000-\u001f\u007f-\u009f]/g, ""));
const cadena = (v: unknown): string => (typeof v === "string" ? limpio(v) : "");
const corto = (commit: unknown) => cadena(commit).slice(0, 7);
const secciones = (n: unknown) => (typeof n === "number" ? `${n} ${n === 1 ? "section" : "sections"}` : "sections not counted");
const NOMBRE_DEL_ORIGEN = { repo: "the repo's", agente: "our agent's" } as const;
// El valor del flag `--source` para un origen de la API (el de nuestro agente se pide como `agent`).
const COMO_SE_PIDE = { repo: "repo", agente: "agent" } as const;
// Los avisos del nombre del archivo; los códigos son los que usa el motor por GitHub (`aviso`).
const AVISOS_DEL_NOMBRE = {
  nombre_viejo: `\`${RUTA_VIEJA_DE_LA_GUIA}\` is the old name: rename it to \`guide.md\`.`,
  nombre_viejo_ignorado: `Both \`${RUTA_DE_LA_GUIA}\` and \`${RUTA_VIEJA_DE_LA_GUIA}\` exist: I use guide.md and ignore guia.md.`,
} as const;
type AvisoDelNombre = keyof typeof AVISOS_DEL_NOMBRE;

type Leida = { ok: true; texto: string; raiz: string; ruta: string; aviso: AvisoDelNombre | null };

// ─── El archivo local ───
// Se busca en la raíz de ESTE clon, nunca en el cwd: parado en una subcarpeta sigue siendo la guía del repo.
// Con `--repo` y sin clon de ese repo no hay dónde leerla (publicar lee la rama, pero la huella sale del archivo).
// Se lee `guide.md`; SÓLO si no existe se lee `guia.md` (si `guide.md` existe y no se puede leer, o no valida, es un
// error: nunca motivo para leer el viejo). Si están los dos manda `guide.md` y se avisa que el otro se ignora.
async function leerLaGuia(d: DepsDeGuia, flags: { repo: string | null }): Promise<Leida | { ok: false; resultado: Resultado }> {
  let raiz: string | null;
  let sinClon: string | undefined;
  try {
    ({ raiz, sinClon } = await repoPedido({ flagRepo: flags.repo, git: d.git, cwd: d.cwd }));
  } catch (e) {
    return { ok: false, resultado: resultadoDeFallo(e) };
  }
  if (raiz === null) {
    return { ok: false, resultado: fallo(SALIDA.entradaInvalida, "falta_guia", `${sinClon ?? "I don't have that repo's clone here."} The guide is read from ${RUTA_DE_LA_GUIA} in the repo's clone: stand in it.`) };
  }
  let ruta = RUTA_DE_LA_GUIA;
  let aviso: AvisoDelNombre | null = null;
  let leido = d.leerArchivoChico(path.join(raiz, ruta), MAX_BYTES_DE_LA_GUIA);
  if ("error" in leido && leido.error === NO_LEIDO.noExiste) {
    const vieja = d.leerArchivoChico(path.join(raiz, RUTA_VIEJA_DE_LA_GUIA), MAX_BYTES_DE_LA_GUIA);
    if ("error" in vieja && vieja.error === NO_LEIDO.noExiste) {
      return { ok: false, resultado: fallo(SALIDA.entradaInvalida, "falta_guia", `${RUTA_DE_LA_GUIA} is missing in the repo: write it (one section per screen) and run again.`) };
    }
    ruta = RUTA_VIEJA_DE_LA_GUIA;
    aviso = "nombre_viejo";
    leido = vieja;
  } else if (!("error" in leido)) {
    // Con `guide.md` leído, el viejo sólo se mira para avisar que se ignora (no se lee su contenido).
    const vieja = d.leerArchivoChico(path.join(raiz, RUTA_VIEJA_DE_LA_GUIA), 1);
    if (!("error" in vieja) || vieja.error !== NO_LEIDO.noExiste) aviso = "nombre_viejo_ignorado";
  }
  if ("error" in leido) {
    if (leido.error === NO_LEIDO.demasiadoGrande) return { ok: false, resultado: fallo(SALIDA.entradaInvalida, "guia_muy_grande", `${ruta} is over ${MAX_BYTES_DE_LA_GUIA / 1024} KB: shorten it.`) };
    return { ok: false, resultado: fallo(SALIDA.entradaInvalida, "guia_ilegible", `I can't read ${ruta}: ${limpio(leido.error)}.`) };
  }
  try {
    // ignoreBOM: el BOM se CONSERVA en el texto; quitarlo es regla de la huella (`huellaDeGuia`), no de la lectura.
    // fatal: un byte inválido no se reemplaza en silencio, porque la huella de GitHub no coincidiría nunca.
    return { ok: true, raiz, ruta, aviso, texto: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(leido.bytes) };
  } catch {
    return { ok: false, resultado: fallo(SALIDA.entradaInvalida, "guia_ilegible", `${ruta} isn't valid UTF-8.`) };
  }
}

// El aviso del nombre viaja en el JSON (`aviso`) y como última línea del texto, en lo que salió bien.
function conAviso(r: Resultado, aviso: AvisoDelNombre | null): Resultado {
  // Si el motor ya dijo el suyo (por GitHub lee el repo él mismo, en un SHA), manda ése.
  if (aviso === null || r.codigo !== SALIDA.ok || "aviso" in r.json) return r;
  return { ...r, json: { ...r.json, aviso }, texto: `${r.texto}\n${AVISOS_DEL_NOMBRE[aviso]}` };
}

// ─── El desenlace propio de la guía, encima del de configurar ───
function desenlaceDeGuia(r: Respuesta, ok: (cuerpo: Record<string, unknown>) => Resultado, ruta: string = RUTA_DE_LA_GUIA): Resultado {
  const c = r.cuerpo as Record<string, unknown> | null;
  // 2xx, 401, 5xx y cuerpos raros los resuelve el de configurar. Ojo: la terminal no distingue 500
  // connect_no_disponible de 502 github_no_disponible (ambos llegan como falla del servicio): los dos son 1.
  if (r.status < 400 || r.status === 401 || r.status >= 500 || typeof c !== "object" || c === null) return desenlace(r, ok);
  const error = typeof c.error === "string" ? c.error : "rechazado";
  const message = limpio(typeof c.message === "string" ? c.message : `The engine rejected the request (${r.status}).`);
  const con = (codigo: Resultado["codigo"], extra: Record<string, unknown> = {}, texto = message): Resultado =>
    ({ codigo, json: { ok: false, error, message: taparSecretos(message), ...extra }, texto });
  switch (error) {
    case "guia_no_subida":
    case "guia_distinta": {
      const rama = cadena(c.rama), commit = cadena(c.commit);
      const donde = rama !== "" ? ` (branch ${rama}${commit !== "" ? `, commit ${corto(commit)}` : ""})` : "";
      const que = error === "guia_no_subida" ? "The guide isn't on the repo's main branch" : "The main branch's guide is another one, not your file's";
      return con(SALIDA.esperandoAUnaPersona, { rama: c.rama ?? null, commit: c.commit ?? null }, `${que}${donde}: push the guide to the main branch and run again.`);
    }
    case "instalacion_ausente":
    case "repo_fuera_de_alcance":
    case "sin_guia_del_agente":
      return con(SALIDA.haceFaltaUnaPersona);
    case "guia_mal_armada": {
      const errores = Array.isArray(c.errores) ? c.errores : [];
      const lineas = errores.map((e) => {
        const x = (e ?? {}) as { linea?: unknown; motivo?: unknown };
        return `line ${typeof x.linea === "number" ? x.linea : "?"}: ${cadena(x.motivo)}`;
      });
      return con(SALIDA.entradaInvalida, { errores: errores.map((e) => { const x = (e ?? {}) as { linea?: unknown; motivo?: unknown }; return { linea: x.linea ?? null, motivo: taparSecretos(typeof x.motivo === "string" ? x.motivo : "") }; }) },
        [`${ruta} is badly formed:`, ...lineas].join("\n"));
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
    const haria = `POST ${rutaDe(p.proyecto, "/guia/revisar")} (${new TextEncoder().encode(g.texto).length} bytes, from ${g.ruta})`;
    return conAviso({ codigo: SALIDA.ok, json: { ok: true, dry_run: true, haria, ruta: g.ruta }, texto: `With --dry-run I do nothing; without it: ${haria}.` }, g.aviso);
  }
  try {
    return conAviso(desenlaceDeGuia(await d.revisar(d.api, p.clave, p.proyecto.id, g.texto, d.fetch), (c) => ({
      codigo: SALIDA.ok, json: { ok: true, secciones: c.secciones ?? null, ruta: g.ruta }, texto: `The guide is well formed: ${secciones(c.secciones)}.`,
    }), g.ruta), g.aviso);
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

export async function guiaPublicar(d: DepsDeGuia, flags: Pick<Flags, "repo" | "dryRun" | "fromGithub">): Promise<Resultado> {
  const g = await leerLaGuia(d, flags);
  if (!g.ok) return g.resultado;
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  const github = flags.fromGithub === true;
  // La vía de GitHub manda la huella del archivo local TAL CUAL (con BOM y \r\n: normalizarla es regla de
  // `huellaDeGuia`). La directa manda el contenido crudo y el motor calcula la huella: la terminal no la necesita.
  const huella = github ? huellaDeGuia(g.texto) : null;
  const decl = github ? {} : await declarado(d, g.raiz);
  // La directa manda además la ruta que se leyó de verdad (dato declarado, como el commit y la rama). Por GitHub el
  // motor resuelve los nombres él mismo, sobre un solo SHA de la rama principal.
  const cuerpo: CuerpoDePublicar = huella !== null ? { huella } : { contenido: g.texto, ruta: g.ruta, ...decl };
  const cuando = decl.commit ? `commit ${decl.commit.slice(0, 7)}${decl.rama ? ` of ${cadena(decl.rama)}` : ""} declared` : "no commit";
  // El JSON del dry-run pasa por la misma limpieza que el texto (control primero, secretos después): la rama la
  // decide quien escribió el clon, y un ESC en ella no debe llegar a la terminal por ninguna de las dos salidas.
  if (flags.dryRun) {
    const haria = huella !== null
      ? `POST ${rutaDe(p.proyecto, "/guia/publicar")} with the fingerprint ${huella.slice(0, 12)}…`
      : `POST ${rutaDe(p.proyecto, "/guia/publicar")} with the content (${new TextEncoder().encode(g.texto).length} bytes, from ${g.ruta}), ${cuando}`;
    const json = huella !== null
      ? { ok: true, dry_run: true, huella, ruta: g.ruta, haria }
      : { ok: true, dry_run: true, ruta: g.ruta, commit: decl.commit ? cadena(decl.commit) : null, rama: decl.rama ? cadena(decl.rama) : null, haria };
    return conAviso({ codigo: SALIDA.ok, json, texto: `With --dry-run I do nothing; without it: ${haria}.` }, g.aviso);
  }
  try {
    return conAviso(desenlaceDeGuia(await d.publicar(d.api, p.clave, p.proyecto.id, cuerpo, d.fetch), (c) => {
      const guia = (c.guia ?? {}) as Record<string, unknown>;
      const ya = c.ya_publicada === true;
      const rem = c.reemplaza as { origen?: unknown; version?: unknown } | null | undefined;
      const reemplaza = !ya && rem && rem.origen === "agente" && typeof rem.version === "number" ? ` (replaces our agent's v${rem.version})` : "";
      const json = { ok: true, guia: c.guia ?? null, ya_publicada: ya, reemplaza: c.reemplaza ?? null };
      // Una resubida idéntica devuelve la fila vieja con su ruta histórica: se dice, para que nadie crea que el
      // renombre quedó registrado.
      const ruta = cadena(guia.ruta);
      const nota = ya && ruta !== "" && ruta !== g.ruta ? `\nThat version keeps the file name it was first published with (${ruta}).` : "";
      if (github) {
        const base = `commit ${corto(guia.commit)} of ${cadena(guia.rama)}, ${secciones(guia.secciones)}`;
        // Republicar re-activa la guía del repo aunque antes rigiera la de nuestro agente: «sigue siendo» mentiría en ese caso.
        const texto = ya ? `It was already published: ${base}. It stayed as the active guide.${nota}` : `Guide published: ${base}. It's the active guide${reemplaza}.${nota}`;
        const delMotor = typeof c.aviso === "string" && c.aviso in AVISOS_DEL_NOMBRE ? (c.aviso as AvisoDelNombre) : null;
        return delMotor === null
          ? { codigo: SALIDA.ok, json, texto }
          : { codigo: SALIDA.ok, json: { ...json, aviso: delMotor }, texto: `${texto}\n${AVISOS_DEL_NOMBRE[delMotor]}` };
      }
      // El commit se muestra como lo que es: lo que la terminal dijo, no lo que GitHub confirmó.
      const origen = decl.commit ? `commit ${decl.commit.slice(0, 7)} declared by the terminal (not verified in GitHub)` : "no commit";
      const texto = ya
        ? `It was already uploaded: ${secciones(guia.secciones)}. It stayed as the active guide; ${origen}.${nota}`
        : `Guide uploaded: ${secciones(guia.secciones)}. It's the active guide${reemplaza}; ${origen}.${nota}`;
      return { codigo: SALIDA.ok, json: { ...json, commit_declarado: decl.commit ?? null }, texto };
    }, g.ruta), g.aviso);
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
      if (!guia) return { codigo: SALIDA.ok, json, texto: "This project has no active guide: `supcoflow guide publish` uploads the repo's." };
      const lineas: string[] = [];
      if (guia.origen === "repo") {
        lineas.push(`Active guide: ${NOMBRE_DEL_ORIGEN.repo} (version ${guia.version}, ${secciones(guia.secciones)}).`);
        // La ruta es la que se leyó de verdad; por la terminal es declarada (el motor no la verificó), por GitHub no.
        const ruta = cadena(guia.ruta);
        if (ruta !== "") lineas.push(`File: ${ruta}${guia.procedencia === "terminal" ? " (declared by the terminal)" : ""}.`);
        if (guia.procedencia === "terminal") {
          // Subida desde la terminal: el motor NO comparó nada contra GitHub a propósito (al_dia null), así que "no pude
          // comprobar la rama" sería falso. Commit y rama son lo que declaró quien subió; el id crudo de quien publicó
          // (usr_…) no le dice nada a una persona y la terminal no resuelve nombres: queda sólo en el JSON.
          const commit = cadena(guia.commit), rama = cadena(guia.rama);
          const partes = [cadena(guia.repo), rama !== "" ? `branch ${rama}` : "", commit !== "" ? `commit ${corto(commit)} (declared)` : "no declared commit"].filter((x) => x !== "");
          lineas.push(`Source: ${partes.join(", ")}.`);
          lineas.push("Uploaded from the terminal; the commit is declared, not verified in GitHub.");
        } else {
          lineas.push(`Source: ${cadena(guia.repo)}, branch ${cadena(guia.rama)}, commit ${corto(guia.commit)}, published by ${cadena(guia.publicada_por)}.`);
          if (alDia === true) lineas.push("It's up to date with the branch.");
          else if (alDia === false) lineas.push("The branch has another version: run `supcoflow guide publish`.");
          else lineas.push("I couldn't check the branch right now.");
        }
      } else {
        lineas.push(`Active guide: ${NOMBRE_DEL_ORIGEN.agente} (v${guia.version}, ${secciones(guia.secciones)}).`);
        lineas.push("Source: our agent wrote it and a person approved it.");
      }
      if (otra && (otra.origen === "repo" || otra.origen === "agente")) {
        lineas.push(`There's also ${NOMBRE_DEL_ORIGEN[otra.origen]} (v${typeof otra.version === "number" ? otra.version : "?"}): \`supcoflow guide use --source ${COMO_SE_PIDE[otra.origen]}\` activates it.`);
      }
      return { codigo: SALIDA.ok, json, texto: lineas.join("\n") };
    });
  } catch (e) {
    return resultadoDeFallo(e);
  }
}

export async function guiaUsar(d: DepsDeGuia, flags: Pick<Flags, "repo" | "dryRun" | "source">): Promise<Resultado> {
  const pedido = flags.source ?? null;
  if (pedido === null) return fallo(SALIDA.entradaInvalida, "falta_origen", "Say which: `supcoflow guide use --source repo` or `--source agent`.");
  // A la API siempre viaja su valor (`agente`); `agente` también se acepta, por el alias viejo.
  const origen = pedido === "repo" ? "repo" : pedido === "agent" || pedido === "agente" ? "agente" : null;
  if (origen === null) return fallo(SALIDA.entradaInvalida, "origen_invalido", "--source is `repo` or `agent`.");
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  if (flags.dryRun) {
    const haria = `POST ${rutaDe(p.proyecto, "/guia/origen")} {origen: ${origen}}`;
    return { codigo: SALIDA.ok, json: { ok: true, dry_run: true, haria }, texto: `With --dry-run I do nothing; without it: ${haria}.` };
  }
  try {
    return desenlaceDeGuia(await d.elegir(d.api, p.clave, p.proyecto.id, origen, d.fetch), (c) => ({
      codigo: SALIDA.ok, json: { ok: true, guia: c.guia ?? null }, texto: `Now the active guide is ${NOMBRE_DEL_ORIGEN[origen]}.`,
    }));
  } catch (e) {
    return resultadoDeFallo(e);
  }
}

// `guide versions`: la guía que rige ahora (la que lee el chat) y las publicaciones del repo, de la más nueva a la más
// vieja. Una sola publicación dice «live»: la que es la vigente (el motor lo decide; acá sólo se muestra).
export async function guiaVersiones(d: DepsDeGuia, flags: Pick<Flags, "repo">): Promise<Resultado> {
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  try {
    return desenlaceDeGuia(await d.versiones(d.api, p.clave, p.proyecto.id, d.fetch), (c) => {
      const vigente = typeof c.vigente === "object" && c.vigente !== null ? (c.vigente as Record<string, unknown>) : null;
      const publicaciones = Array.isArray(c.publicaciones) ? (c.publicaciones as unknown[]).map((x) => (typeof x === "object" && x !== null ? (x as Record<string, unknown>) : {})) : [];
      const json = { ok: true, vigente, publicaciones };
      const lineas: string[] = [];
      if (vigente === null) lineas.push("Active now: no guide.");
      else if (vigente.origen === "agente") lineas.push(`Active now: ${NOMBRE_DEL_ORIGEN.agente} guide, v${vigente.version} (${secciones(vigente.secciones)}).`);
      else lineas.push(`Active now: ${NOMBRE_DEL_ORIGEN.repo} guide, version ${vigente.version} (${secciones(vigente.secciones)}).`);
      lineas.push(publicaciones.length === 0 ? "Published from the repo: none." : "Published from the repo, newest first:");
      for (const x of publicaciones) {
        const estado = x.live === true || x.estado === "live" ? "live" : "published";
        const donde = [
          x.procedencia === "terminal" ? "uploaded from the terminal (declared)" : x.procedencia === "github" ? "verified in GitHub" : "",
          cadena(x.commit) !== "" ? `commit ${corto(x.commit)}` : "",
          cadena(x.ruta),
          cadena(x.publicada_por) !== "" ? `by ${cadena(x.publicada_por)}` : "",
          cadena(x.publicada_en),
        ].filter((t) => t !== "");
        lineas.push(`  v${x.version} ${estado}${donde.length > 0 ? ` · ${donde.join(" · ")}` : ""}`);
      }
      return { codigo: SALIDA.ok, json, texto: lineas.join("\n") };
    });
  } catch (e) {
    return resultadoDeFallo(e);
  }
}
