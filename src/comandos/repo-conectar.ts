// `supcoflow repo conectar`: pide la conexión del repo con la App de GitHub y espera a que una persona
// la confirme en la consola. Tiene la misma forma partida que `login` (§13): `--start` pide y sale 5,
// `--wait` sondea un tramo (≤ 90 s) y sale 5 mientras nadie confirme.
//
// Por qué no se guarda el id del pedido en esta máquina: el motor lo encuentra por persona y repo, así
// `--wait` se retoma desde cualquier carpeta o máquina y no hay un tercer registro local que pueda
// quedar viejo respecto del del motor y de la consola.
import type { Pedido } from "../api.ts";
import type { Flags } from "../argumentos.ts";
import { resultadoDeFallo, SALIDA, type Resultado } from "../contrato.ts";
import type { Guardado } from "../guardado/index.ts";
import { repoPedido, type Git } from "../repo-local.ts";
import { PLAZO_MINIMO_DE_SONDEO_MS, TRAMO_MAXIMO_MS } from "../sondeo.ts";
import { claveVigente } from "./clave-vigente.ts";

export const INTERVALO_DE_CONEXION_MS = 5_000;
const PLAZO_MAXIMO_DE_SONDEO_MS = 15_000;
const PAUSA_ENTRE_TRAMOS_MS = 1_000;

export type DepsDeConexion = {
  api: URL;
  guardado: Guardado;
  git: Git;
  cwd: string;
  ahora: () => number;
  dormir: (ms: number) => Promise<void>;
  crearConexion: (api: URL, clave: string, repo: string) => Promise<Pedido>;
  ultimaConexion: (api: URL, clave: string, repo: string, plazoMs: number) => Promise<Pedido | null>;
  avisar: (s: string) => void;
  tramoMs?: number;
};

const fallo = (codigo: Resultado["codigo"], error: string, message: string, extra: Record<string, unknown> = {}): Resultado => ({
  codigo, json: { ok: false, error, message, ...extra }, texto: message,
});

const datosDelPedido = (p: Pedido) => ({ id: p.id, estado: p.estado, url: p.url, vence_en: p.venceEn });

// El desenlace de un pedido ya leído. El JSON nunca lleva la clave: sólo el pedido y el repo.
function resultadoDelPedido(repo: string, p: Pedido, avisar: (s: string) => void): Resultado {
  const pedido = datosDelPedido(p);
  switch (p.estado) {
    case "conectado":
      return {
        codigo: SALIDA.ok,
        json: { ok: true, estado: "conectado", repo, repo_canonico: p.repoCanonico, pedido },
        texto: `${p.repoCanonico ?? repo} is connected.`,
      };
    case "repo_fuera_de_alcance": {
      const message = `The App is installed but doesn't have access to ${repo}: add it in GitHub and click Confirm again (${p.url}).`;
      return fallo(SALIDA.haceFaltaUnaPersona, "repo_fuera_de_alcance", message, { repo, url: p.url, pedido });
    }
    case "vencido":
      return fallo(SALIDA.haceFaltaUnaPersona, "pedido_vencido", "The request has expired. Ask for a new one with `supcoflow repo connect --start`.", { repo, pedido });
    case "pendiente": {
      // Un motivo anotado no cierra el pedido: la persona puede reintentar desde la misma página.
      if (p.fallo !== null) avisar(`The last confirmation failed: ${p.fallo}.`);
      return {
        codigo: SALIDA.esperandoAUnaPersona,
        json: { ok: false, esperando: "persona", repo, url: p.url, pedido, ...(p.fallo !== null ? { fallo: p.fallo } : {}) },
        texto: `Open ${p.url}, install the App on GitHub if needed, and click Confirm.`,
      };
    }
  }
}

export async function repoConectarStart(d: DepsDeConexion, flags: Pick<Flags, "repo" | "dryRun">): Promise<Resultado> {
  let repo: string;
  try {
    repo = (await repoPedido({ flagRepo: flags.repo, git: d.git, cwd: d.cwd })).repo;
  } catch (e) {
    return resultadoDeFallo(e);
  }
  if (flags.dryRun) {
    return {
      codigo: SALIDA.ok,
      json: { ok: true, dry_run: true, repo, haria: "POST /api/conexiones" },
      texto: `With --dry-run I do nothing; without it: ask to connect ${repo} (POST /api/conexiones).`,
    };
  }
  const leida = await claveVigente(d.guardado, d.api.origin);
  if (!leida.ok) return leida.resultado;
  let p: Pedido;
  try {
    p = await d.crearConexion(d.api, leida.vigente.clave, repo);
  } catch (e) {
    return resultadoDeFallo(e);
  }
  return resultadoDelPedido(repo, p, d.avisar);
}

export async function repoConectarWait(d: DepsDeConexion, flags: Pick<Flags, "repo">): Promise<Resultado> {
  let repo: string;
  try {
    repo = (await repoPedido({ flagRepo: flags.repo, git: d.git, cwd: d.cwd })).repo;
  } catch (e) {
    return resultadoDeFallo(e);
  }
  const leida = await claveVigente(d.guardado, d.api.origin);
  if (!leida.ok) return leida.resultado;
  const clave = leida.vigente.clave;

  const limite = d.ahora() + Math.min(d.tramoMs ?? TRAMO_MAXIMO_MS, TRAMO_MAXIMO_MS);
  let ultimo: Pedido | null = null;
  for (;;) {
    const plazoMs = Math.min(PLAZO_MAXIMO_DE_SONDEO_MS, limite - d.ahora());
    if (plazoMs < PLAZO_MINIMO_DE_SONDEO_MS && ultimo !== null) break;
    let p: Pedido | null;
    try {
      // Un fallo del motor en medio del tramo sale 1 y no se reintenta en silencio (P13): quien llama
      // decide si vuelve.
      p = await d.ultimaConexion(d.api, clave, repo, Math.max(plazoMs, PLAZO_MINIMO_DE_SONDEO_MS));
    } catch (e) {
      return resultadoDeFallo(e);
    }
    if (p === null) {
      return fallo(SALIDA.entradaInvalida, "sin_conexion_en_curso", `There is no connection in progress for ${repo}: start with \`supcoflow repo connect --start\`.`, { repo });
    }
    ultimo = p;
    if (p.estado !== "pendiente") break;
    // Dormir sólo si después cabe otro sondeo con plazo útil: dormir de más pasaría del tramo.
    if (limite - (d.ahora() + INTERVALO_DE_CONEXION_MS) < PLAZO_MINIMO_DE_SONDEO_MS) break;
    await d.dormir(INTERVALO_DE_CONEXION_MS);
  }
  return resultadoDelPedido(repo, ultimo!, d.avisar);
}

// La conexión de una persona frente a la terminal: los dos pasos encadenados. Con `--json` (o sin TTY)
// no se espera a nadie aunque haya terminal (§13, Review Focus 9): un asistente con PTY recibiría un
// comando que se cuelga hasta 30 minutos. Y se decide ANTES de tocar el motor, para no dejar un pedido
// que nadie va a mirar.
export async function repoConectarInteractivo(
  d: DepsDeConexion & { esTty: boolean; mostrar: (s: string) => void },
  flags: Pick<Flags, "repo" | "dryRun" | "json">,
): Promise<Resultado> {
  if (!d.esTty || flags.json) {
    return fallo(SALIDA.entradaInvalida, "hace_falta_tty",
      "Without an interactive terminal, use `supcoflow repo connect --start --json` and then `supcoflow repo connect --wait --json`.");
  }
  const inicio = await repoConectarStart(d, flags);
  if (inicio.codigo !== SALIDA.esperandoAUnaPersona) return inicio;
  d.mostrar(`${inicio.texto} I'll wait here...`);
  let r: Resultado;
  do {
    r = await repoConectarWait(d, flags);
    if (r.codigo === SALIDA.esperandoAUnaPersona) await d.dormir(PAUSA_ENTRE_TRAMOS_MS);
  } while (r.codigo === SALIDA.esperandoAUnaPersona);
  return r;
}
