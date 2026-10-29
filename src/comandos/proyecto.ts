// `supcoflow proyecto crear` y `proyecto ver`: el proyecto del repo de esta carpeta (o de `--repo`).
// `crear` sale de una conexión ya confirmada (`repo conectar`) y deja `.supcoflow/proyecto.json` en la
// raíz del repo para que la próxima herramienta sepa de qué proyecto se trata sin preguntarle al motor.
import path from "node:path";
import type { AltaRemota, Pedido, Proyecto, Yo } from "../api.ts";
import type { Flags } from "../argumentos.ts";
import { resultadoDeFallo, SALIDA, type Resultado } from "../contrato.ts";
import type { Guardado } from "../guardado/index.ts";
import type { RegistroDeIdempotencia } from "../idempotencia.ts";
import { repoPedido, type Git } from "../repo-local.ts";
import { claveVigente } from "./clave-vigente.ts";
import { armarElContexto, coherenciaAlCrear, coherenciaDelClon, idDelArchivo, leerElArchivoDelClon, lineaDelContexto } from "./contexto.ts";

const PLAZO_DE_LECTURA_MS = 15_000;
const OPERACION = "proyecto_crear";
// Los 422/409 del alta que el plan no listaba (alta-desde-conexion.ts del motor).
const RECHAZOS_DE_UNA_PERSONA = new Set(["instalacion_no_verificada", "repo_fuera_de_la_instalacion"]);
const RECHAZOS_TRANSITORIOS = new Set(["slug_ocupado", "repo_ya_conectado"]);

export type DepsDeProyecto = {
  api: URL;
  guardado: Guardado;
  git: Git;
  cwd: string;
  idempotencia: RegistroDeIdempotencia;
  buscarProyecto(api: URL, clave: string, repo: string): Promise<Proyecto | null>;
  quienSoy(api: URL, clave: string): Promise<Yo>;
  ultimaConexion(api: URL, clave: string, repo: string, plazoMs: number): Promise<Pedido | null>;
  crearProyecto(api: URL, clave: string, conexionId: string, cuerpo: { install_command?: string; test_command?: string }, key: string): Promise<AltaRemota>;
  leerProyecto(api: URL, clave: string, id: string): Promise<{ proyecto: Proyecto; github: { estado: string | null; verificadoEn: string | null } }>;
  archivos: { leer(p: string): string | null; escribir(p: string, s: string): void };
  avisar: (s: string) => void;
};

const fallo = (codigo: Resultado["codigo"], error: string, message: string, extra: Record<string, unknown> = {}): Resultado => ({
  codigo, json: { ok: false, error, message, ...extra }, texto: message,
});

const comillas = (s: string) => `"${s.replace(/["\\]/g, "\\$&")}"`;

// El archivo va al repo y se commitea (§5.3): por eso lleva sólo lo que identifica al proyecto. Ni la
// URL de la API (un repo clonado que la trajera mandaría la clave a otro servidor, §5.2) ni nada
// secreto: cualquiera que lea el repo lo lee.
function contenidoDelArchivo(p: Proyecto): string {
  return JSON.stringify({ id: p.id, slug: p.slug, repo: p.repo }, null, 2) + "\n";
}

// Mismo contenido aunque el formato cambie (otra indentación, otro orden): no es «otro proyecto».
function mismoArchivo(crudo: string, p: Proyecto): boolean {
  if (crudo === contenidoDelArchivo(p)) return true;
  try {
    const v: unknown = JSON.parse(crudo);
    if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
    const o = v as Record<string, unknown>;
    return Object.keys(o).length === 3 && o.id === p.id && o.slug === p.slug && o.repo === p.repo;
  } catch {
    return false;
  }
}

function resultadoDelProyecto(p: Proyecto, reusado: boolean, raiz: string | null, d: DepsDeProyecto): Resultado {
  const nuevo = { id: p.id, slug: p.slug, repo: p.repo };
  const queda = reusado ? `Project ${p.id} already existed and I reused it` : `I created project ${p.id}`;
  let archivo: string | null = null;
  if (raiz !== null) {
    archivo = path.join(raiz, ".supcoflow", "proyecto.json");
    const actual = d.archivos.leer(archivo);
    if (actual !== null && !mismoArchivo(actual, p)) {
      // Un segundo `go` no pisa archivos (§13): el que está puede ser de otro proyecto a propósito, y
      // pisarlo cambiaría en silencio a qué proyecto apunta el repo. Se sale 4 para que una persona
      // decida. Su contenido NUNCA se copia a la salida (puede traer cualquier cosa, una clave
      // incluida, y `emitir` no sanea): sólo el id, si tiene forma de id.
      const idActual = idDelArchivo(actual);
      const message = `There is already a \`.supcoflow/proyecto.json\` for another project (${idActual ?? "one I don't recognize"}); I didn't touch it. `
        + `${queda} anyway: if that's the one you want, delete the file and run \`supcoflow project create\` again.`;
      return fallo(SALIDA.haceFaltaUnaPersona, "archivo_distinto", message, { archivo, id_actual: idActual, nuevo, reusado });
    }
    if (actual === null) {
      try {
        d.archivos.escribir(archivo, contenidoDelArchivo(p));
      } catch {
        const message = `${queda}, but I couldn't write ${archivo}. Run \`supcoflow project create\` again.`;
        return fallo(SALIDA.inesperado, "archivo_no_escrito", message, { archivo, nuevo, reusado });
      }
    }
  }
  return {
    codigo: SALIDA.ok,
    json: { ok: true, proyecto: { id: p.id, slug: p.slug, repo: p.repo, rama: p.rama }, reusado, archivo },
    texto: `${queda}: ${p.repo}, branch ${p.rama}.${archivo !== null ? ` Recorded in ${archivo}.` : ""}`,
  };
}

export async function proyectoCrear(d: DepsDeProyecto, flags: Pick<Flags, "repo" | "install" | "test" | "dryRun">): Promise<Resultado> {
  let repo: string;
  let raiz: string | null;
  try {
    ({ repo, raiz } = await repoPedido({ flagRepo: flags.repo, git: d.git, cwd: d.cwd }));
  } catch (e) {
    return resultadoDeFallo(e);
  }
  const leida = await claveVigente(d.guardado, d.api.origin);
  if (!leida.ok) return leida.resultado;
  const clave = leida.vigente.clave;

  // Antes de conectar o crear nada (fricción 6): el archivo del clon contra lo que la clave ve, y, si va a haber un alta, el
  // dueño del repo contra la cuenta. Sale 4 `contexto_incoherente` sin tocar nada.
  const archivo = leerElArchivoDelClon(d.archivos, raiz);
  if (archivo.estado === "ilegible") return coherenciaDelClon(archivo, null, repo)!;
  let existente: Proyecto | null;
  let conexion: Pedido | null = null;
  try {
    existente = await d.buscarProyecto(d.api, clave, repo);
    const incoherente = coherenciaDelClon(archivo, existente, repo);
    if (incoherente !== null) return incoherente;
    if (existente === null) {
      const alCrear = coherenciaAlCrear({ yo: await d.quienSoy(d.api, clave), fuente: leida.vigente.fuente, repo });
      if (alCrear !== null) return alCrear;
      conexion = await d.ultimaConexion(d.api, clave, repo, PLAZO_DE_LECTURA_MS);
    }
  } catch (e) {
    return resultadoDeFallo(e);
  }
  // Un repo con proyecto no vuelve a pasar por la conexión: el proyecto ya está atado a su instalación.
  if (existente !== null) {
    // Una clave guardada de un intento anterior (respuesta perdida, `en_curso`) ya no sirve: el proyecto
    // existe. Si quedara, un alta futura del mismo repo (borrado y vuelto a crear) mandaría una clave
    // vieja con otro contenido y el motor contestaría 409. Con --dry-run no se toca ni lo local.
    if (!flags.dryRun) await d.idempotencia.olvidar(OPERACION, repo);
    if (flags.install !== null || flags.test !== null) {
      // Sin copiar los valores: son texto del usuario y el aviso sólo dice qué pasó con ellos. Callarlo
      // haría creer que el proyecto quedó con los comandos pedidos.
      d.avisar("The project already exists: I ignored --install/--test. To change its commands, it has to be configured.");
    }
    return resultadoDelProyecto(existente, true, raiz, d);
  }

  if (conexion === null || conexion.estado !== "conectado") {
    return fallo(SALIDA.haceFaltaUnaPersona, "repo_sin_conectar", "Connect the repo first: `supcoflow repo connect`.", {
      repo, ...(conexion !== null ? { estado: conexion.estado } : {}),
    });
  }
  if (flags.dryRun) {
    const haria = `POST /api/conexiones/${conexion.id}/proyecto`;
    return { codigo: SALIDA.ok, json: { ok: true, dry_run: true, repo, haria }, texto: `With --dry-run I do nothing; without it: create the project for ${repo} (${haria}).` };
  }

  const cuerpo: { install_command?: string; test_command?: string } = {};
  if (flags.install !== null) cuerpo.install_command = flags.install;
  if (flags.test !== null) cuerpo.test_command = flags.test;

  const key = await d.idempotencia.claveDe(OPERACION, repo);
  let alta: AltaRemota;
  try {
    alta = await d.crearProyecto(d.api, clave, conexion.id, cuerpo, key);
  } catch (e) {
    // La clave NO se olvida (Review Focus 4): sin respuesta no se sabe si el motor creó el proyecto, y
    // el reintento tiene que mandar la misma para recibir el mismo en vez de otro.
    return resultadoDeFallo(e);
  }
  switch (alta.tipo) {
    case "ok":
      await d.idempotencia.olvidar(OPERACION, repo);
      return resultadoDelProyecto(alta.proyecto, alta.reusado, raiz, d);
    case "comandos_faltantes": {
      // Otro intento lleva otro contenido (los flags): con la misma clave el motor contestaría 409.
      await d.idempotencia.olvidar(OPERACION, repo);
      const install = flags.install ?? "…";
      const test = flags.test ?? "…";
      const message = `${alta.message || "The project is missing commands."} Pass them yourself: \`supcoflow project create --install ${comillas(install)} --test ${comillas(test)}\`.`;
      return fallo(SALIDA.entradaInvalida, "comandos_faltantes", message, { faltantes: alta.faltantes });
    }
    case "no_conectada":
      await d.idempotencia.olvidar(OPERACION, repo);
      return fallo(SALIDA.haceFaltaUnaPersona, "repo_sin_conectar", alta.message || "Connect the repo first: `supcoflow repo connect`.", { repo });
    case "en_curso":
      // Se conserva: el pedido en curso puede ser el nuestro y el reintento tiene que poder retomarlo.
      return fallo(SALIDA.inesperado, "en_curso", "Another request with this key is already in progress; try again in a minute.");
    case "clave_reusada":
      // No debería pasar (la clave es por repo y un reintento manda lo mismo); olvidarla deja reintentar limpio.
      await d.idempotencia.olvidar(OPERACION, repo);
      return fallo(SALIDA.inesperado, "clave_reusada", "The engine rejected the saved idempotency key; I discarded it, try again.");
    case "rechazo": {
      // La clave se conserva: tras un rechazo el motor ya la soltó, y el próximo intento la reusa sin
      // chocar. Lo que cambia es el código: no todo rechazo es culpa de lo que se escribió.
      const message = alta.message || "The engine rejected the request.";
      if (RECHAZOS_DE_UNA_PERSONA.has(alta.error)) {
        // Lo arregla alguien con permisos en GitHub (instalar la App, sumarle el repo): reintentar o
        // cambiar flags no sirve, y un 3 haría que un asistente siguiera probando entradas.
        return fallo(SALIDA.haceFaltaUnaPersona, alta.error,
          `${message} Check the App's installation on GitHub and connect again with \`supcoflow repo connect\`.`);
      }
      // Dos altas al mismo tiempo, o un proyecto borrado en el medio: el mismo pedido otra vez anda.
      if (RECHAZOS_TRANSITORIOS.has(alta.error)) return fallo(SALIDA.inesperado, alta.error, message);
      return fallo(SALIDA.entradaInvalida, alta.error, message);
    }
  }
}

export async function proyectoVer(d: DepsDeProyecto, flags: Pick<Flags, "repo">): Promise<Resultado> {
  let repo: string;
  let raiz: string | null;
  try {
    ({ repo, raiz } = await repoPedido({ flagRepo: flags.repo, git: d.git, cwd: d.cwd }));
  } catch (e) {
    return resultadoDeFallo(e);
  }
  const leida = await claveVigente(d.guardado, d.api.origin);
  if (!leida.ok) return leida.resultado;
  const clave = leida.vigente.clave;
  const archivo = leerElArchivoDelClon(d.archivos, raiz);
  if (archivo.estado === "ilegible") return coherenciaDelClon(archivo, null, repo)!;
  try {
    const encontrado = await d.buscarProyecto(d.api, clave, repo);
    const incoherente = coherenciaDelClon(archivo, encontrado, repo);
    if (incoherente !== null) return incoherente;
    // Quién soy, en qué equipo, qué repo y qué proyecto: la línea que la persona lee al empezar, también cuando todo cierra.
    const yo = await d.quienSoy(d.api, clave);
    const contexto = armarElContexto({ yo, fuente: leida.vigente.fuente, repo, proyecto: encontrado, archivo });
    const linea = lineaDelContexto(contexto, yo.proyecto);
    if (encontrado === null) {
      // Sin proyecto, el recorrido sigue con `repo connect`: el freno por cuenta (dueño distinto, sin GitHub) tiene que llegar ANTES,
      // no al crear. Con proyecto existente no se compara nada, y con una clave de consulta tampoco.
      const alCrear = coherenciaAlCrear({ yo, fuente: leida.vigente.fuente, repo });
      if (alCrear !== null) return alCrear;
      return { codigo: SALIDA.ok, json: { ok: true, repo, proyecto: null, contexto }, texto: `${linea} This repo doesn't have a project yet: \`supcoflow project create\`.` };
    }
    const { proyecto: p, github } = await d.leerProyecto(d.api, clave, encontrado.id);
    const proyecto = { id: p.id, slug: p.slug, repo: p.repo, rama: p.rama, install_command: p.installCommand, test_command: p.testCommand };
    return {
      codigo: SALIDA.ok,
      json: { ok: true, proyecto, github: { estado: github.estado, verificado_en: github.verificadoEn }, contexto },
      texto: `${linea} ${p.id} (${p.repo}, branch ${p.rama}): installs with \`${p.installCommand}\`, tests with \`${p.testCommand}\`. GitHub: ${github.estado ?? "not verified"}.`,
    };
  } catch (e) {
    return resultadoDeFallo(e);
  }
}
