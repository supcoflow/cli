// Los cuatro pedidos de la terminal al motor. Sin dependencias: `fetch` viene de Node y se inyecta.
import { FalloDeLaTerminal, SALIDA } from "./contrato.ts";

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

// A mano a propósito: tiene que coincidir con package.json (0.1.0); sólo identifica a la terminal
// en los logs del motor, no decide nada.
const VERSION = "0.1.0";
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
