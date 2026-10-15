// Los pedidos de la terminal al motor. Sin dependencias: `fetch` viene de Node y se inyecta.
import { FalloDeLaTerminal, SALIDA, taparSecretos } from "./contrato.ts";

// La URL viene FIJA (§5.2): si un archivo del repo pudiera cambiarla, clonar un repo ajeno y correr
// `supcoflow` mandaría el token a un servidor ajeno. Sólo el entorno del proceso la mueve, y `http`
// únicamente contra la propia máquina: contra un host remoto la clave viajaría en claro.
export const API_DE_PRODUCCION = "https://app.supcoflow.dev";
const LOCALES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function urlDeLaApi(env: Record<string, string | undefined>): URL {
  const crudo = env.SUPCOFLOW_API_URL;
  if (crudo === undefined || crudo === "") return new URL(API_DE_PRODUCCION);
  const invalida = () =>
    new FalloDeLaTerminal(SALIDA.entradaInvalida, "api_url_invalida", "SUPCOFLOW_API_URL tiene que ser https, o http contra localhost.");
  let u: URL;
  try {
    u = new URL(crudo);
  } catch {
    throw invalida();
  }
  if (u.protocol === "https:" || (u.protocol === "http:" && LOCALES.has(u.hostname))) return new URL(u.origin);
  throw invalida();
}

export type Fetch = typeof fetch;

// A mano a propósito: tiene que coincidir con package.json (0.2.0); sólo identifica a la terminal
// en los logs del motor, no decide nada.
const VERSION = "0.2.0";
const PLAZO_POR_DEFECTO_MS = 15_000;

type Respuesta = { status: number; cuerpo: Record<string, unknown> };

// Todo lo que vuelve de afuera se trata como no confiable: nunca se pega el cuerpo crudo en un
// mensaje (una página HTML no sirve en una línea y podría traer cualquier cosa), y el mensaje del
// error de red no se reenvía (podría llevar la URL o la clave).
async function pedir(api: URL, ruta: string, init: RequestInit, f: Fetch, plazoMs?: number): Promise<Respuesta> {
  let res: Response;
  let texto: string;
  try {
    res = await f(new URL(ruta, api), {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), "user-agent": `supcoflow-cli/${VERSION}` },
      signal: AbortSignal.timeout(plazoMs ?? PLAZO_POR_DEFECTO_MS),
      // Un 307/308 reenvía el cuerpo del formulario (con el device_code) adonde diga `Location`, aunque
      // sea otro origen o http. Los cuatro endpoints del motor nunca redirigen: una redirección es
      // anómala y sale como `motor_inalcanzable`, sin Location ni cuerpo en el mensaje.
      redirect: "error",
    });
    texto = await res.text();
  } catch {
    throw new FalloDeLaTerminal(SALIDA.inesperado, "motor_inalcanzable", "No pude comunicarme con el motor (red caída o demora).");
  }
  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    cuerpo = undefined;
  }
  if (typeof cuerpo !== "object" || cuerpo === null || Array.isArray(cuerpo)) {
    throw new FalloDeLaTerminal(SALIDA.inesperado, "respuesta_inesperada", `El motor respondió ${res.status} sin JSON.`);
  }
  return { status: res.status, cuerpo: cuerpo as Record<string, unknown> };
}

function sinServicio(status: number): FalloDeLaTerminal {
  return new FalloDeLaTerminal(SALIDA.inesperado, "motor_inalcanzable", `El motor respondió ${status}; probá en unos minutos.`);
}
function inesperada(status: number): FalloDeLaTerminal {
  return new FalloDeLaTerminal(SALIDA.inesperado, "respuesta_inesperada", `El motor respondió ${status} con algo que no esperaba.`);
}
const texto = (v: unknown): string | null => (typeof v === "string" ? v : null);

const CLIENT_ID = "supcoflow-cli";
const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
const FORMULARIO = { "content-type": "application/x-www-form-urlencoded" };

export type PedidoDeCodigo = {
  deviceCode: string; userCode: string; verificationUri: string; verificationUriComplete: string; expiresIn: number; interval: number;
};

export async function pedirCodigo(api: URL, maquina: string, f: Fetch): Promise<PedidoDeCodigo> {
  const { status, cuerpo: c } = await pedir(
    api, "/api/dispositivo/codigo",
    { method: "POST", headers: FORMULARIO, body: new URLSearchParams({ client_id: CLIENT_ID, maquina }).toString() }, f,
  );
  if (status === 429 || status === 503) {
    throw new FalloDeLaTerminal(
      SALIDA.inesperado, texto(c.error) ?? "demasiados_pedidos",
      "El motor no acepta más pedidos ahora; probá en unos minutos.",
    );
  }
  if (status >= 500) throw sinServicio(status);
  const [deviceCode, userCode, verificationUri, verificationUriComplete] =
    [c.device_code, c.user_code, c.verification_uri, c.verification_uri_complete].map(texto);
  if (status !== 200 || !deviceCode || !userCode || !verificationUri || !verificationUriComplete
    || typeof c.expires_in !== "number" || typeof c.interval !== "number") throw inesperada(status);
  return { deviceCode, userCode, verificationUri, verificationUriComplete, expiresIn: c.expires_in, interval: c.interval };
}

export type Canje =
  | { tipo: "token"; clave: string; equipo: string }
  | { tipo: "pendiente" } | { tipo: "slow_down" } | { tipo: "rechazado" } | { tipo: "vencido" } | { tipo: "invalido" };

const ERRORES_DEL_CANJE: Record<string, Exclude<Canje["tipo"], "token">> = {
  authorization_pending: "pendiente", slow_down: "slow_down", access_denied: "rechazado",
  expired_token: "vencido", invalid_grant: "invalido",
};

// `plazoMs` es el techo de ESTE pedido: el sondeo lo achica cerca del final de su tramo para que
// un pedido colgado no lo pase de largo.
export async function canjear(api: URL, deviceCode: string, f: Fetch, plazoMs?: number): Promise<Canje> {
  const { status, cuerpo: c } = await pedir(
    api, "/api/dispositivo/token",
    { method: "POST", headers: FORMULARIO, body: new URLSearchParams({ grant_type: GRANT_TYPE, device_code: deviceCode, client_id: CLIENT_ID }).toString() },
    f, plazoMs,
  );
  if (status >= 500) throw sinServicio(status);
  if (status === 200) {
    const clave = texto(c.access_token);
    const equipo = texto(c.equipo);
    if (!clave || !equipo) throw inesperada(status);
    return { tipo: "token", clave, equipo };
  }
  const tipo = ERRORES_DEL_CANJE[texto(c.error) ?? ""];
  if (status === 400 && tipo) return { tipo };
  throw inesperada(status);
}

export type Yo = {
  via: string; equipo: string; usuario: { id: string; login: string | null; email: string | null } | null; proyecto: string | null;
};

const bearer = (clave: string) => ({ authorization: `Bearer ${clave}` });

export async function quienSoy(api: URL, clave: string, f: Fetch): Promise<Yo> {
  const { status, cuerpo: c } = await pedir(api, "/api/yo", { method: "GET", headers: bearer(clave) }, f);
  if (status === 401) {
    throw new FalloDeLaTerminal(SALIDA.faltaLogin, "clave_invalida", texto(c.message) ?? "La clave ya no vale: iniciá sesión de nuevo.");
  }
  if (status >= 500) throw sinServicio(status);
  const u = c.usuario as Record<string, unknown> | null | undefined;
  if (status !== 200 || !texto(c.via) || !texto(c.equipo)) throw inesperada(status);
  return {
    via: c.via as string,
    equipo: c.equipo as string,
    usuario: u ? { id: String(u.id), login: texto(u.login), email: texto(u.email) } : null,
    proyecto: texto(c.proyecto),
  };
}

export async function revocarPropia(api: URL, clave: string, f: Fetch, plazoMs?: number): Promise<"revocada" | "ya_no_valia"> {
  const { status } = await pedir(api, "/api/dispositivo/revocar", { method: "POST", headers: bearer(clave) }, f, plazoMs);
  if (status === 200) return "revocada";
  if (status === 401) return "ya_no_valia";
  if (status >= 500) throw sinServicio(status);
  throw inesperada(status);
}

// ---- Conexión del repo y proyecto (bloque 3) ----

// Una sola puerta para los pedidos con clave: suma el Bearer y traduce lo que significa lo mismo en
// todos (clave rota, clave sin alcance, repo mal escrito, cuenta sin GitHub). Lo que es propio de
// cada pedido (404, 409, 422 de comandos) lo decide quien llama. Los `message` del motor son texto de
// afuera: pasan por taparSecretos antes de salir en una línea de la terminal.
async function conClave(
  api: URL, clave: string, ruta: string, init: RequestInit, f: Fetch, plazoMs?: number,
): Promise<Respuesta> {
  const r = await pedir(api, ruta, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), ...bearer(clave) } }, f, plazoMs);
  const error = texto(r.cuerpo.error) ?? "respuesta_inesperada";
  const message = (porDefecto: string) => taparSecretos(texto(r.cuerpo.message) ?? porDefecto);
  if (r.status === 401) {
    throw new FalloDeLaTerminal(SALIDA.faltaLogin, "clave_invalida", message("La clave ya no vale: iniciá sesión de nuevo."));
  }
  if (r.status === 403 && (error === "requiere_persona" || error === "clave_de_consulta")) {
    throw new FalloDeLaTerminal(SALIDA.haceFaltaUnaPersona, error, message("Esto lo tiene que hacer una persona con sesión."));
  }
  if (r.status === 422 && error === "cuenta_sin_github") {
    throw new FalloDeLaTerminal(SALIDA.haceFaltaUnaPersona, error, message("Tu cuenta no tiene GitHub asociado."));
  }
  if (r.status === 400 && error === "repo_invalido") {
    throw new FalloDeLaTerminal(SALIDA.entradaInvalida, error, message("El repo tiene que ser owner/repo."));
  }
  if (r.status >= 500) throw sinServicio(r.status);
  return r;
}

export type Pedido = {
  id: string; repo: string; estado: "pendiente" | "conectado" | "repo_fuera_de_alcance" | "vencido";
  url: string; venceEn: string; repoCanonico: string | null; fallo: string | null;
};
export type Proyecto = {
  id: string; slug: string; repo: string; rama: string; installCommand: string; testCommand: string;
};

const ESTADOS_DE_PEDIDO = new Set(["pendiente", "conectado", "repo_fuera_de_alcance", "vencido"]);

function aPedido(v: unknown, status: number): Pedido {
  const c = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  const [id, repo, estado, url, venceEn] = [c.id, c.repo, c.estado, c.url, c.vence_en].map(texto);
  if (!id || !repo || !estado || !ESTADOS_DE_PEDIDO.has(estado) || !url || !venceEn) throw inesperada(status);
  return { id, repo, estado: estado as Pedido["estado"], url, venceEn, repoCanonico: texto(c.repo_canonico), fallo: texto(c.fallo) };
}

function aProyecto(v: unknown, status: number): Proyecto {
  const c = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  const [id, slug, repo, rama, installCommand, testCommand] =
    [c.id, c.slug, c.repo, c.rama, c.install_command, c.test_command].map(texto);
  if (!id || !slug || !repo || !rama || installCommand === null || testCommand === null) throw inesperada(status);
  return { id, slug, repo, rama, installCommand, testCommand };
}

// Un fallo propio del pedido que el mapeo común no cubrió (404, 409…): sale como entrada inválida
// con el motivo del motor, nunca con el cuerpo crudo.
function rechazada(r: Respuesta): FalloDeLaTerminal {
  const error = texto(r.cuerpo.error);
  if (r.status >= 400 && r.status < 500 && error) {
    return new FalloDeLaTerminal(SALIDA.entradaInvalida, error, taparSecretos(texto(r.cuerpo.message) ?? `El motor rechazó el pedido (${r.status}).`));
  }
  return inesperada(r.status);
}

const JSON_BODY = { "content-type": "application/json" };

export async function crearConexion(api: URL, clave: string, repo: string, f: Fetch): Promise<Pedido> {
  const r = await conClave(api, clave, "/api/conexiones", { method: "POST", headers: JSON_BODY, body: JSON.stringify({ repo }) }, f);
  if (r.status !== 200 && r.status !== 201) throw rechazada(r);
  return aPedido(r.cuerpo.pedido, r.status);
}

export async function ultimaConexion(api: URL, clave: string, repo: string, f: Fetch, plazoMs?: number): Promise<Pedido | null> {
  const r = await conClave(api, clave, `/api/conexiones?${new URLSearchParams({ repo })}`, { method: "GET" }, f, plazoMs);
  if (r.status !== 200) throw rechazada(r);
  return r.cuerpo.pedido === null ? null : aPedido(r.cuerpo.pedido, r.status);
}

export type AltaRemota =
  | { tipo: "ok"; proyecto: Proyecto; reusado: boolean }
  | { tipo: "comandos_faltantes"; faltantes: string[]; message: string }
  | { tipo: "no_conectada"; message: string }
  | { tipo: "en_curso" }
  | { tipo: "clave_reusada" }
  | { tipo: "rechazo"; error: string; message: string };

export async function crearProyecto(
  api: URL, clave: string, conexionId: string, cuerpo: { install_command?: string; test_command?: string },
  idempotencyKey: string, f: Fetch,
): Promise<AltaRemota> {
  const r = await conClave(
    api, clave, `/api/conexiones/${encodeURIComponent(conexionId)}/proyecto`,
    { method: "POST", headers: { ...JSON_BODY, "idempotency-key": idempotencyKey }, body: JSON.stringify(cuerpo) }, f,
  );
  const error = texto(r.cuerpo.error);
  const message = taparSecretos(texto(r.cuerpo.message) ?? "");
  if (r.status === 200 || r.status === 201) {
    return { tipo: "ok", proyecto: aProyecto(r.cuerpo.proyecto, r.status), reusado: r.status === 200 };
  }
  if (r.status === 422 && error === "comandos_faltantes") {
    const faltantes = Array.isArray(r.cuerpo.faltantes) ? r.cuerpo.faltantes.filter((x): x is string => typeof x === "string") : [];
    return { tipo: "comandos_faltantes", faltantes, message };
  }
  if (r.status === 409 && error === "idempotency_en_curso") return { tipo: "en_curso" };
  if (r.status === 409 && error === "idempotency_key_reusada") return { tipo: "clave_reusada" };
  if (r.status === 409 && error === "conexion_no_conectada") return { tipo: "no_conectada", message };
  if (r.status >= 400 && r.status < 500 && error) return { tipo: "rechazo", error, message };
  throw inesperada(r.status);
}

export async function buscarProyecto(api: URL, clave: string, repo: string, f: Fetch): Promise<Proyecto | null> {
  const r = await conClave(api, clave, `/api/proyectos?${new URLSearchParams({ repo })}`, { method: "GET" }, f);
  if (r.status !== 200) throw rechazada(r);
  return r.cuerpo.proyecto === null ? null : aProyecto(r.cuerpo.proyecto, r.status);
}

export async function leerProyecto(
  api: URL, clave: string, id: string, f: Fetch,
): Promise<{ proyecto: Proyecto; github: { estado: string | null; verificadoEn: string | null } }> {
  const r = await conClave(api, clave, `/api/proyectos/${encodeURIComponent(id)}`, { method: "GET" }, f);
  if (r.status !== 200) throw rechazada(r);
  const g = (typeof r.cuerpo.github === "object" && r.cuerpo.github !== null ? r.cuerpo.github : {}) as Record<string, unknown>;
  return { proyecto: aProyecto(r.cuerpo.proyecto, r.status), github: { estado: texto(g.estado), verificadoEn: texto(g.verificado_en) } };
}
