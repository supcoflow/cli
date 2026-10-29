// src/comandos/datos-y-politica.ts
// El acuerdo de datos (§8.1) y la política de problemas (§14): las dos cosas que la skill le PREGUNTA a la
// persona. La terminal no pregunta (§13): recibe la decisión ya tomada en flags y la manda tal cual. Lo que
// se valida acá se valida para no gastar un pedido; la regla de verdad es la del motor.
import type { Respuesta } from "../api.ts";
import type { Flags } from "../argumentos.ts";
import { PERMITIDOS_VIEJOS, PREFIJO_VIEJO_DE_ATRIBUTO } from "../alias.ts";
import { resultadoDeFallo, SALIDA, type Resultado } from "../contrato.ts";
import { claveVigente } from "./clave-vigente.ts";
import { desenlace, type DepsDeConfigurar } from "./configurar.ts";
import { proyectoDelRepo } from "./proyecto-del-repo.ts";

export type DepsDeCatalogo = DepsDeConfigurar & {
  leerCatalogo(api: URL, clave: string): Promise<Record<string, unknown>>;
};

export type Permitido = {
  usuario_id: boolean; usuario_rol: boolean; atributos: string[]; pagina_y_navegador: boolean;
  capturas: boolean; elementos: boolean; email: boolean;
};
// Los nombres de `--allow` son ingleses; a la API viaja el suyo (`Permitido`). Los castellanos de la 0.7.0 valen igual
// (`src/alias.ts`).
const DE_LA_API = { user_id: "usuario_id", user_role: "usuario_rol", page_and_browser: "pagina_y_navegador", screenshots: "capturas", elements: "elementos", email: "email" } as const;
const BANDERAS = Object.keys(DE_LA_API) as (keyof typeof DE_LA_API)[];
const PREFIJO_DEL_ATRIBUTO = "attribute:";
// Los límites del contrato (`Permitido.atributos`: ≤ 8, 1–40 caracteres). Se cortan acá para que un
// --allow imposible salga 3 sin pedido; el motor sigue siendo quien decide.
const MAX_ATRIBUTOS = 8;
const MAX_LARGO_DE_ATRIBUTO = 40;

const fallo = (codigo: Resultado["codigo"], error: string, message: string): Resultado => ({ codigo, json: { ok: false, error, message }, texto: message });
const rutaDe = (p: { id: string }, resto: string) => `/api/proyectos/${encodeURIComponent(p.id)}${resto}`;
const dryRun = (haria: string): Resultado => ({ codigo: SALIDA.ok, json: { ok: true, dry_run: true, haria }, texto: `With --dry-run I do nothing; without it: ${haria}.` });

// Lleva un valor de `--allow` (nuevo o viejo) a su forma inglesa canónica.
function aInglesElPermitido(x: string): string {
  if (x.startsWith(PREFIJO_VIEJO_DE_ATRIBUTO)) return PREFIJO_DEL_ATRIBUTO + x.slice(PREFIJO_VIEJO_DE_ATRIBUTO.length);
  return PERMITIDOS_VIEJOS[x] ?? x;
}

export function leerPermitir(crudo: string): Permitido | { error: string } {
  const partes = crudo.split(",").map((s) => s.trim()).filter((s) => s.length > 0).map(aInglesElPermitido);
  const p: Permitido = { usuario_id: false, usuario_rol: false, atributos: [], pagina_y_navegador: false, capturas: false, elementos: false, email: false };
  if (partes.length === 1 && partes[0] === "nothing") return p;
  if (partes.length === 0 || partes.includes("nothing")) return { error: "`nothing` goes alone; otherwise, name what does get through." };
  const vistos = new Set<string>();
  for (const x of partes) {
    if (vistos.has(x)) return { error: `«${x}» is repeated.` };
    vistos.add(x);
    if (x.startsWith(PREFIJO_DEL_ATRIBUTO)) {
      // Recortado: « plan» y «plan» son el mismo atributo para quien lo escribe, y el motor lo compara exacto.
      const nombre = x.slice(PREFIJO_DEL_ATRIBUTO.length).trim();
      if (nombre.length === 0) return { error: "`attribute:` goes with the attribute's exact name, for example attribute:plan." };
      if (nombre.length > MAX_LARGO_DE_ATRIBUTO) return { error: `An attribute's name has up to ${MAX_LARGO_DE_ATRIBUTO} characters.` };
      if (p.atributos.length >= MAX_ATRIBUTOS) return { error: `Up to ${MAX_ATRIBUTOS} attributes.` };
      p.atributos.push(nombre);
    } else if ((BANDERAS as readonly string[]).includes(x)) {
      p[DE_LA_API[x as keyof typeof DE_LA_API]] = true;
    } else {
      return { error: `I don't know «${x}». Valid: ${BANDERAS.join(", ")}, attribute:<name>, or nothing.` };
    }
  }
  return p;
}

export async function datosFijar(d: DepsDeConfigurar, flags: Pick<Flags, "repo" | "dryRun" | "allow">): Promise<Resultado> {
  if (flags.allow === null) {
    return fallo(SALIDA.entradaInvalida, "falta_permitir", "Say which data gets through: `supcoflow data set --allow user_id,screenshots` (or `--allow nothing`).");
  }
  const permitido = leerPermitir(flags.allow);
  if ("error" in permitido) return fallo(SALIDA.entradaInvalida, "permitir_invalido", permitido.error);
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  const ruta = rutaDe(p.proyecto, "/acuerdo-de-datos");
  if (flags.dryRun) return dryRun(`POST ${ruta} {permitido}`);
  let r: Respuesta;
  try {
    r = await d.configurar(d.api, p.clave, ruta, { permitido });
  } catch (e) {
    return resultadoDeFallo(e);
  }
  // El acuerdo frena lo que se guarda y lo que lee la IA que releva; NO alcanza a lo que ve la IA del
  // propio chat mientras conversa (decisión 1b): el texto lo dice y no promete «toda» ni «ninguna» IA.
  return desenlace(r, (c) => {
    const version = (c.acuerdo as { version?: number } | undefined)?.version;
    return {
      codigo: SALIDA.ok,
      json: { ok: true, acuerdo: c.acuerdo, alcance: "guardado_y_relevamiento" },
      texto: `Data agreement set (version ${version}). It limits what is saved and what the AI that investigates reads; not what the chat's AI sees while it talks.`,
    };
  });
}

export async function politicaFijar(d: DepsDeConfigurar, flags: Pick<Flags, "repo" | "dryRun" | "mode">): Promise<Resultado> {
  // A la API viaja `relevar` / `guardar`; `investigate` / `save` son sus nombres ingleses.
  const modo = flags.mode === "investigate" || flags.mode === "relevar" ? "relevar" : flags.mode === "save" || flags.mode === "guardar" ? "guardar" : null;
  if (modo === null) {
    return fallo(SALIDA.entradaInvalida, "modo_invalido", "--mode is `investigate` or `save`: `supcoflow policy set --mode save`.");
  }
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  const ruta = rutaDe(p.proyecto, "/politica");
  if (flags.dryRun) return dryRun(`POST ${ruta} {modo: ${modo}}`);
  let r: Respuesta;
  try {
    r = await d.configurar(d.api, p.clave, ruta, { modo });
  } catch (e) {
    return resultadoDeFallo(e);
  }
  return desenlace(r, (c) => ({
    codigo: SALIDA.ok,
    json: { ok: true, politica: c.politica },
    texto: `Problem policy set: ${modo === "relevar" ? "investigate" : "save"}.`,
  }));
}

export async function comandoCatalogo(d: Pick<DepsDeCatalogo, "api" | "guardado" | "leerCatalogo">): Promise<Resultado> {
  const leida = await claveVigente(d.guardado, d.api.origin);
  if (!leida.ok) return leida.resultado;
  try {
    const c = await d.leerCatalogo(d.api, leida.vigente.clave);
    const items = (c.supcoflow as { clave: string; valores: string }[]).map((i) => `${i.clave}: ${i.valores}`);
    return { codigo: SALIDA.ok, json: { ok: true, ...c }, texto: items.join("\n") };
  } catch (e) {
    return resultadoDeFallo(e);
  }
}
