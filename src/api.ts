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

// A mano a propósito: tiene que coincidir con package.json (lo pinza test/describir.test.ts); sólo
// identifica a la terminal en los logs del motor, no decide nada.
const VERSION = "0.7.0";
const PLAZO_POR_DEFECTO_MS = 15_000;
// Los dos POST que crean algo: detrás, el motor acuña con Vercel Connect y le pregunta a GitHub varias
// veces (instalación, repos, comandos, rama). Con 15 s una respuesta lenta pero buena se cortaba y
// sólo quedaba reintentar; el sondeo no los usa, así que su tope por tramo no cambia.
const PLAZO_DE_ALTA_MS = 30_000;

export type Respuesta = { status: number; cuerpo: Record<string, unknown> };

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
      // sea otro origen o http; con el Bearer pasaría lo mismo con la clave. Ninguna ruta del motor que
      // llama la terminal redirige: una redirección es anómala y sale como `motor_inalcanzable`, sin
      // Location ni cuerpo en el mensaje.
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
  const r = await conClave(api, clave, "/api/conexiones", { method: "POST", headers: JSON_BODY, body: JSON.stringify({ repo }) }, f, PLAZO_DE_ALTA_MS);
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
    { method: "POST", headers: { ...JSON_BODY, "idempotency-key": idempotencyKey }, body: JSON.stringify(cuerpo) }, f, PLAZO_DE_ALTA_MS,
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

// ---- Configurar (bloque 4) ----

const objeto = (v: unknown, status: number): Record<string, unknown> => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw inesperada(status);
  return v as Record<string, unknown>;
};

export async function leerCatalogo(api: URL, clave: string, f: Fetch): Promise<Record<string, unknown>> {
  const r = await conClave(api, clave, "/api/catalogo", { method: "GET" }, f);
  if (r.status !== 200 || !Array.isArray(r.cuerpo.supcoflow)) throw rechazada(r);
  return r.cuerpo;
}

export async function leerConfiguracion(api: URL, clave: string, proyectoId: string, f: Fetch): Promise<Record<string, unknown>> {
  const r = await conClave(api, clave, `/api/proyectos/${encodeURIComponent(proyectoId)}/configuracion`, { method: "GET" }, f);
  if (r.status !== 200) throw rechazada(r);
  objeto(r.cuerpo.chat, r.status);
  if (!Array.isArray(r.cuerpo.sitios)) throw inesperada(r.status);
  return r.cuerpo;
}

// Las escrituras devuelven la respuesta entera: qué significa un 409 lo decide cada comando (prender sin
// guía es «hace falta una persona»; la lista que cambió es «probá de nuevo»).
export async function configurar(
  api: URL, clave: string, ruta: string, cuerpo: unknown, f: Fetch, extra: { idempotencyKey?: string } = {},
): Promise<Respuesta> {
  const headers: Record<string, string> = { ...JSON_BODY };
  if (extra.idempotencyKey !== undefined) headers["idempotency-key"] = extra.idempotencyKey;
  return conClave(api, clave, ruta, { method: "POST", headers, body: JSON.stringify(cuerpo) }, f);
}

export async function subirLogo(
  api: URL, clave: string, proyectoId: string, archivo: { bytes: Uint8Array; mime: string; nombre: string }, f: Fetch,
): Promise<Respuesta> {
  const form = new FormData();
  form.set("logo", new Blob([archivo.bytes as Uint8Array<ArrayBuffer>], { type: archivo.mime }), archivo.nombre);
  // Sin content-type a mano: `fetch` pone el multipart con su boundary.
  return conClave(api, clave, `/api/proyectos/${encodeURIComponent(proyectoId)}/chat/logo`, { method: "POST", body: form }, f);
}

export async function listarClaves(api: URL, clave: string, proyectoId: string, f: Fetch): Promise<{ id: string; nombre: string; creadaEn: string }[]> {
  const r = await conClave(api, clave, `/api/proyectos/${encodeURIComponent(proyectoId)}/claves`, { method: "GET" }, f);
  if (r.status !== 200 || !Array.isArray(r.cuerpo.claves)) throw rechazada(r);
  return r.cuerpo.claves.map((x) => {
    const o = objeto(x, r.status);
    const [id, nombre, creadaEn] = [o.id, o.nombre, o.creada_en].map(texto);
    if (!id || !nombre || !creadaEn) throw inesperada(r.status);
    return { id, nombre, creadaEn };
  });
}

// ¿Esta clave es una clave de CONSULTA de este proyecto y autentica? La prueba de posesión de
// `claves crear`: el motor es el único que sabe cuál generación es la vigente, y de qué alcance. Que lea el
// proyecto no alcanza: una clave personal también lo lee y puede mucho más (tercera revisión, hallazgo 2).
// Sin `conClave`: un 401 acá es la respuesta («no»), no «iniciá sesión».
export async function esClaveDeConsultaDelProyecto(api: URL, clave: string, proyectoId: string, f: Fetch): Promise<boolean> {
  const r = await pedir(api, "/api/yo", { method: "GET", headers: bearer(clave) }, f);
  if (r.status === 401) return false;
  if (r.status >= 500) throw sinServicio(r.status);
  if (r.status !== 200) throw inesperada(r.status);
  return r.cuerpo.via === "clave_de_consulta" && r.cuerpo.proyecto === proyectoId;
}

// ---- La guía (bloque 5) ----

// Devuelven la respuesta entera: qué significa cada 409/422 lo decide el comando (`guia_no_subida` es
// un código de salida propio; `guia_mal_armada` lleva la lista de errores por línea).
const rutaDeLaGuia = (proyectoId: string) => `/api/proyectos/${encodeURIComponent(proyectoId)}/guia`;

export function revisarGuia(api: URL, clave: string, proyectoId: string, contenido: string, f: Fetch): Promise<Respuesta> {
  return conClave(api, clave, `${rutaDeLaGuia(proyectoId)}/revisar`, { method: "POST", headers: JSON_BODY, body: JSON.stringify({ contenido }) }, f);
}

// Dos cuerpos para una sola ruta: `{contenido, commit?, rama?}` sube el archivo directo (commit y rama son lo que la
// terminal DECLARA; el motor no los verifica) y `{huella}` es la vía de GitHub (`--desde-github`).
// `ruta` es el archivo que la terminal leyó de verdad (`.supcoflow/guide.md` o el nombre viejo `guia.md`): también es
// dato declarado, como el commit y la rama. Una terminal ≤ 0.7.0 no la mandaba y el motor lo toma como `guia.md`.
export type CuerpoDePublicar = { huella: string } | { contenido: string; ruta?: string; commit?: string; rama?: string };

export function publicarGuia(api: URL, clave: string, proyectoId: string, cuerpo: CuerpoDePublicar, f: Fetch): Promise<Respuesta> {
  // La vía de GitHub acuña con Connect y le pregunta a GitHub por la rama: el mismo plazo que las altas (la directa no
  // llama a GitHub, pero comparte el plazo para no tener dos reglas).
  return conClave(api, clave, `${rutaDeLaGuia(proyectoId)}/publicar`, { method: "POST", headers: JSON_BODY, body: JSON.stringify(cuerpo) }, f, PLAZO_DE_ALTA_MS);
}

// Siempre con `comprobar=1`: `guia ver` quiere el `al_dia` de la rama; el motor lo ignora si el origen no es el repo.
export function leerGuia(api: URL, clave: string, proyectoId: string, f: Fetch): Promise<Respuesta> {
  return conClave(api, clave, `${rutaDeLaGuia(proyectoId)}?comprobar=1`, { method: "GET" }, f, PLAZO_DE_ALTA_MS);
}

// Las publicaciones del repo y la guía que rige ahora (`guide versions`): sólo lectura, la misma clase que `leerGuia`.
export function leerVersionesDeLaGuia(api: URL, clave: string, proyectoId: string, f: Fetch): Promise<Respuesta> {
  return conClave(api, clave, `${rutaDeLaGuia(proyectoId)}/versiones`, { method: "GET" }, f, PLAZO_DE_ALTA_MS);
}

export function elegirOrigen(api: URL, clave: string, proyectoId: string, origen: "repo" | "agente", f: Fetch): Promise<Respuesta> {
  return conClave(api, clave, `${rutaDeLaGuia(proyectoId)}/origen`, { method: "POST", headers: JSON_BODY, body: JSON.stringify({ origen }) }, f);
}

// ---- El widget (bloque 6) ----

export type Widget = {
  tenant_id: string; project_id: string; backend_url: string;
  paquete: "@supcoflow/chat"; version: string; instalar: string;
  // `archivos_anteriores`: nombres con los que antes se sugería el archivo (el chat ya instalado puede estar ahí).
  nextjs: { estado: "probando" | "soportado"; archivo_sugerido: string; archivos_anteriores: string[]; contenido: string; uso: string };
  script: { estado: "disponible_sin_soporte"; linea: string };
  csp: string;
  // Sólo si el motor los manda arriba de todo (la forma exacta la fija el motor): se pasan tal cual.
  archivo_sugerido?: string;
  archivos_anteriores?: string[];
};

// Se valida campo a campo: lo que se le pasa a la persona (y de ahí a un archivo de su app) no puede
// ser algo a medias. `contenido` se guarda tal cual, sin tocarlo: los ids ya vienen puestos por el motor.
function aWidget(v: Record<string, unknown>, status: number): Widget {
  const n = (typeof v.nextjs === "object" && v.nextjs !== null ? v.nextjs : {}) as Record<string, unknown>;
  const s = (typeof v.script === "object" && v.script !== null ? v.script : {}) as Record<string, unknown>;
  const [tenantId, projectId, backendUrl, version, instalar, csp] =
    [v.tenant_id, v.project_id, v.backend_url, v.version, v.instalar, v.csp].map(texto);
  const [archivo, contenido, uso] = [n.archivo_sugerido, n.contenido, n.uso].map(texto);
  const linea = texto(s.linea);
  const anteriores = listaDeTextos(n.archivos_anteriores ?? v.archivos_anteriores);
  const archivoDeArriba = v.archivo_sugerido === undefined ? undefined : texto(v.archivo_sugerido);
  if (anteriores === null || archivoDeArriba === null || archivoDeArriba === "") throw inesperada(status);
  if (!tenantId || !projectId || !backendUrl || !version || !instalar || !csp || v.paquete !== "@supcoflow/chat"
    || (n.estado !== "probando" && n.estado !== "soportado") || !archivo || !contenido || !uso
    || s.estado !== "disponible_sin_soporte" || !linea) throw inesperada(status);
  return {
    tenant_id: tenantId, project_id: projectId, backend_url: backendUrl, paquete: "@supcoflow/chat", version, instalar,
    nextjs: { estado: n.estado, archivo_sugerido: archivo, archivos_anteriores: anteriores, contenido, uso },
    script: { estado: "disponible_sin_soporte", linea },
    csp,
    ...(archivoDeArriba !== undefined ? { archivo_sugerido: archivoDeArriba } : {}),
    ...(Array.isArray(v.archivos_anteriores) ? { archivos_anteriores: anteriores } : {}),
  };
}

// Una lista de textos no vacíos; ausente es lista vacía (un motor sin el campo), y cualquier otra forma es null.
function listaDeTextos(v: unknown): string[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return null;
  const textos = v.map(texto);
  return textos.every((t): t is string => t !== null && t !== "") ? textos : null;
}

export async function leerWidget(api: URL, clave: string, proyectoId: string, f: Fetch): Promise<Widget> {
  const r = await conClave(api, clave, `/api/proyectos/${encodeURIComponent(proyectoId)}/widget`, { method: "GET" }, f);
  if (r.status !== 200) throw rechazada(r);
  return aWidget(r.cuerpo, r.status);
}

// ---- La prueba (bloque 7) ----

const rutaDelProyecto = (proyectoId: string) => `/api/proyectos/${encodeURIComponent(proyectoId)}`;
const numeroONull = (v: unknown): number | null | undefined => (v === null ? null : typeof v === "number" && Number.isFinite(v) ? v : undefined);

export type Diagnostico = {
  listo: boolean;
  // Sin lista fija de nombres: el motor suma puntos (la pausa de despachos, el run en vuelo, el acuerdo)
  // y la terminal los muestra todos; lo que decide es `listo`.
  // `grupo` lo suma el motor nuevo; sin él, la terminal agrupa por el nombre del punto (`diagnostico.ts`).
  puntos: { punto: string; ok: boolean; mensaje: string; grupo?: "instalacion" | "prueba" }[];
  politica: string;
  techoUsd: number;
  saldoUsd: number | null;
  topeUsd: number | null;
  comprometidoUsd: number | null;
  pruebaAbierta: string | null;
};

export async function leerDiagnostico(api: URL, clave: string, proyectoId: string, f: Fetch): Promise<Diagnostico> {
  const r = await conClave(api, clave, `${rutaDelProyecto(proyectoId)}/diagnostico`, { method: "GET" }, f);
  if (r.status !== 200) throw rechazada(r);
  const c = r.cuerpo;
  const puntos = Array.isArray(c.puntos) ? c.puntos.map((x) => objeto(x, r.status)) : null;
  const [saldo, tope, comprometido] = [c.saldo_usd, c.tope_usd, c.comprometido_usd].map(numeroONull);
  if (typeof c.listo !== "boolean" || puntos === null || !texto(c.politica) || typeof c.techo_usd !== "number"
    || saldo === undefined || tope === undefined || comprometido === undefined
    || (c.prueba_abierta !== null && !texto(c.prueba_abierta))
    || puntos.some((p) => !texto(p.punto) || typeof p.ok !== "boolean" || typeof p.mensaje !== "string")) throw inesperada(r.status);
  return {
    listo: c.listo,
    puntos: puntos.map((p) => ({
      punto: p.punto as string, ok: p.ok as boolean, mensaje: taparSecretos(p.mensaje as string),
      ...(p.grupo === "instalacion" || p.grupo === "prueba" ? { grupo: p.grupo } : {}),
    })),
    politica: c.politica as string,
    techoUsd: c.techo_usd,
    saldoUsd: saldo, topeUsd: tope, comprometidoUsd: comprometido,
    pruebaAbierta: texto(c.prueba_abierta),
  };
}

// `politicaEsperada` es la que la persona vio al autorizar; el motor compara las dos cosas con las de ahora.
export type IntentoDePrueba = { clave: string; mensaje: string | null; techoUsd: number; politicaEsperada: "relevar" | "guardar" | null };

// Tres desenlaces y no excepciones, porque cada uno hace algo distinto con el intento guardado:
// `aceptada` lo confirma, `rechazo` lo cierra (el motor no creó nada con esa clave) y `ambigua` lo
// conserva (puede haber creado la prueba y la respuesta no llegó).
export type RespuestaDePrueba =
  | { tipo: "aceptada"; pruebaId: string; reporteId: string; estado: string }
  | { tipo: "rechazo"; status: number; error: string; message: string; cuerpo: Record<string, unknown> }
  | { tipo: "ambigua"; error: string; message: string };

// Sin `conClave`: su 401/403/5xx lanzan, y acá cada uno tiene que decidir qué pasa con el intento.
// `idempotency_en_curso` es ambigua: otro intento con la misma clave sigue corriendo y puede crearla.
// Un 503 de la pausa de despachos (D10) también: el motor no guardó nada, pero conservar el intento no
// cuesta (el reintento con la misma clave crea la prueba una sola vez) y un 503 genérico no se distingue.
export async function pedirPrueba(api: URL, clave: string, proyectoId: string, intento: IntentoDePrueba, f: Fetch): Promise<RespuestaDePrueba> {
  const cuerpo: Record<string, unknown> = { techo_usd: intento.techoUsd };
  if (intento.mensaje !== null) cuerpo.mensaje = intento.mensaje;
  if (intento.politicaEsperada !== null) cuerpo.politica_esperada = intento.politicaEsperada;
  let r: Respuesta;
  try {
    r = await pedir(api, `${rutaDelProyecto(proyectoId)}/pruebas`, {
      method: "POST", headers: { ...JSON_BODY, ...bearer(clave), "idempotency-key": intento.clave }, body: JSON.stringify(cuerpo),
    }, f, PLAZO_DE_ALTA_MS);
  } catch (e) {
    const fallo = e instanceof FalloDeLaTerminal ? e : new FalloDeLaTerminal(SALIDA.inesperado, "motor_inalcanzable", "No pude comunicarme con el motor.");
    return { tipo: "ambigua", error: fallo.error, message: fallo.message };
  }
  const error = texto(r.cuerpo.error);
  const message = taparSecretos(texto(r.cuerpo.message) ?? `El motor respondió ${r.status}.`);
  if (r.status === 202 || r.status === 200 || r.status === 201) {
    const [pruebaId, reporteId, estado] = [r.cuerpo.prueba_id, r.cuerpo.reporte_id, r.cuerpo.estado].map(texto);
    if (pruebaId && /^prb_[0-9a-f]{16}$/.test(pruebaId) && reporteId && estado) return { tipo: "aceptada", pruebaId, reporteId, estado };
    return { tipo: "ambigua", error: "respuesta_inesperada", message: `El motor respondió ${r.status} sin la prueba.` };
  }
  if (r.status >= 500 || (r.status === 409 && error === "idempotency_en_curso")) {
    return { tipo: "ambigua", error: error ?? "motor_inalcanzable", message };
  }
  if (r.status >= 400) return { tipo: "rechazo", status: r.status, error: error ?? "rechazado", message, cuerpo: r.cuerpo };
  return { tipo: "ambigua", error: "respuesta_inesperada", message: `El motor respondió ${r.status} con algo que no esperaba.` };
}

export type Seguimiento = {
  pruebaId: string;
  estado: string;
  abierta: boolean | null;
  mensaje: string | null;
  reporte: { id: string; url: string } | null;
  run: { id: string; status: string; motivo: string | null } | null;
  issue: { numero: number; url: string } | null;
  // Tal cual lo manda el motor: `usd` es null salvo con `leido` (pendiente y perdido nunca son cero).
  cobro: { estado: string | null; usd: number | null; techo_usd: number };
};

export async function leerPrueba(api: URL, clave: string, proyectoId: string, pruebaId: string, f: Fetch, plazoMs?: number): Promise<Seguimiento> {
  const r = await conClave(api, clave, `${rutaDelProyecto(proyectoId)}/pruebas/${encodeURIComponent(pruebaId)}`, { method: "GET" }, f, plazoMs);
  if (r.status !== 200) throw rechazada(r);
  const c = r.cuerpo;
  const cobro = objeto(c.cobro, r.status);
  const usd = numeroONull(cobro.usd);
  if (!texto(c.prueba_id) || !texto(c.estado) || typeof cobro.techo_usd !== "number" || usd === undefined
    || (cobro.estado !== null && !texto(cobro.estado))) throw inesperada(r.status);
  const rep = c.reporte === null || c.reporte === undefined ? null : objeto(c.reporte, r.status);
  const run = c.run === null || c.run === undefined ? null : objeto(c.run, r.status);
  const issue = c.issue === null || c.issue === undefined ? null : objeto(c.issue, r.status);
  if (issue !== null && (typeof issue.numero !== "number" || !texto(issue.url))) throw inesperada(r.status);
  return {
    pruebaId: c.prueba_id as string,
    estado: c.estado as string,
    abierta: typeof c.abierta === "boolean" ? c.abierta : null,
    mensaje: texto(c.mensaje) === null ? null : taparSecretos(c.mensaje as string),
    reporte: rep === null || !texto(rep.id) || !texto(rep.url) ? null : { id: rep.id as string, url: rep.url as string },
    run: run === null ? null : { id: String(run.id), status: String(run.status), motivo: texto(run.motivo) },
    issue: issue === null ? null : { numero: issue.numero as number, url: issue.url as string },
    cobro: { estado: texto(cobro.estado), usd, techo_usd: cobro.techo_usd },
  };
}
