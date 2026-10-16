// src/comandos/datos-y-politica.ts
// El acuerdo de datos (§8.1) y la política de problemas (§14): las dos cosas que la skill le PREGUNTA a la
// persona. La terminal no pregunta (§13): recibe la decisión ya tomada en flags y la manda tal cual. Lo que
// se valida acá se valida para no gastar un pedido; la regla de verdad es la del motor.
import type { Respuesta } from "../api.ts";
import type { Flags } from "../argumentos.ts";
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
const BANDERAS = ["usuario_id", "usuario_rol", "pagina_y_navegador", "capturas", "elementos", "email"] as const;
// Los límites del contrato (`Permitido.atributos`: ≤ 8, 1–40 caracteres). Se cortan acá para que un
// --permitir imposible salga 3 sin pedido; el motor sigue siendo quien decide.
const MAX_ATRIBUTOS = 8;
const MAX_LARGO_DE_ATRIBUTO = 40;

const fallo = (codigo: Resultado["codigo"], error: string, message: string): Resultado => ({ codigo, json: { ok: false, error, message }, texto: message });
const rutaDe = (p: { id: string }, resto: string) => `/api/proyectos/${encodeURIComponent(p.id)}${resto}`;
const dryRun = (haria: string): Resultado => ({ codigo: SALIDA.ok, json: { ok: true, dry_run: true, haria }, texto: `Con --dry-run no hago nada; sin él: ${haria}.` });

export function leerPermitir(crudo: string): Permitido | { error: string } {
  const partes = crudo.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  const p: Permitido = { usuario_id: false, usuario_rol: false, atributos: [], pagina_y_navegador: false, capturas: false, elementos: false, email: false };
  if (partes.length === 1 && partes[0] === "nada") return p;
  if (partes.length === 0 || partes.includes("nada")) return { error: "`nada` va solo; si no, nombrá lo que sí pasa." };
  const vistos = new Set<string>();
  for (const x of partes) {
    if (vistos.has(x)) return { error: `«${x}» está repetido.` };
    vistos.add(x);
    if (x.startsWith("atributo:")) {
      // Recortado: « plan» y «plan» son el mismo atributo para quien lo escribe, y el motor lo compara exacto.
      const nombre = x.slice("atributo:".length).trim();
      if (nombre.length === 0) return { error: "`atributo:` va con el nombre exacto del atributo, por ejemplo atributo:plan." };
      if (nombre.length > MAX_LARGO_DE_ATRIBUTO) return { error: `El nombre de un atributo tiene hasta ${MAX_LARGO_DE_ATRIBUTO} caracteres.` };
      if (p.atributos.length >= MAX_ATRIBUTOS) return { error: `Hasta ${MAX_ATRIBUTOS} atributos.` };
      p.atributos.push(nombre);
    } else if ((BANDERAS as readonly string[]).includes(x)) {
      p[x as (typeof BANDERAS)[number]] = true;
    } else {
      return { error: `No conozco «${x}». Valen: ${BANDERAS.join(", ")}, atributo:<nombre>, o nada.` };
    }
  }
  return p;
}

export async function datosFijar(d: DepsDeConfigurar, flags: Pick<Flags, "repo" | "dryRun" | "permitir">): Promise<Resultado> {
  if (flags.permitir === null) {
    return fallo(SALIDA.entradaInvalida, "falta_permitir", "Falta qué datos pasan: `supcoflow datos fijar --permitir usuario_id,capturas` (o `--permitir nada`).");
  }
  const permitido = leerPermitir(flags.permitir);
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
      texto: `Acuerdo de datos fijado (versión ${version}). Frena lo que se guarda y lo que lee la IA que releva; no lo que ve la IA del chat mientras conversa.`,
    };
  });
}

export async function politicaFijar(d: DepsDeConfigurar, flags: Pick<Flags, "repo" | "dryRun" | "modo">): Promise<Resultado> {
  if (flags.modo !== "relevar" && flags.modo !== "guardar") {
    return fallo(SALIDA.entradaInvalida, "modo_invalido", "--modo vale `relevar` o `guardar`: `supcoflow politica fijar --modo guardar`.");
  }
  const modo = flags.modo;
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
    texto: `Política de problemas fijada: ${modo}.`,
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
