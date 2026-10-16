// `supcoflow claves crear`: una clave de consulta (sólo lee su proyecto) para CI. Dos fases (§6.5): el
// motor la crea pendiente y devuelve el secreto UNA vez; la terminal lo guarda en el archivo que dijo la
// persona y recién ahí confirma mandándolo de vuelta (demuestra que lo tiene). El secreto nunca sale por
// stdout ni stderr: quien llama suele ser un asistente, y su salida queda en su contexto.
//
// La semántica entera (candado, mirar el destino antes, el ciclo) está en la tarea C4 del plan del bloque 4
// y en los comentarios de abajo; cada rama de este archivo es una de esas reglas.
import path from "node:path";
import type { Flags } from "../argumentos.ts";
import type { Candados } from "../candado.ts";
import { resultadoDeFallo, SALIDA, type Resultado } from "../contrato.ts";
import type { RegistroDeIdempotencia } from "../idempotencia.ts";
import type { GuardaDeSecretos } from "../secreto-a-archivo.ts";
import { desenlace, dryRun, fallo, rutaDe, type DepsDeConfigurar } from "./configurar.ts";
import { proyectoDelRepo, type DepsDelProyectoDelRepo } from "./proyecto-del-repo.ts";

export type DepsDeClaves = DepsDelProyectoDelRepo & Pick<DepsDeConfigurar, "configurar" | "avisar"> & {
  listarClaves(api: URL, clave: string, proyectoId: string): Promise<{ id: string; nombre: string; creadaEn: string }[]>;
  esClaveDeConsultaDelProyecto(api: URL, clave: string, proyectoId: string): Promise<boolean>;
  idempotencia: RegistroDeIdempotencia;
  candados: Candados;
  secretos: GuardaDeSecretos;
};

const OPERACION = "clave_crear";
const SUFIJO = /^scf_([0-9a-f]{16})_[0-9a-f]{64}$/;
const ID_DE_CLAVE = /^cla_[0-9a-f]{16}$/;

export async function clavesCrear(d: DepsDeClaves, flags: Pick<Flags, "repo" | "nombre" | "guardarEn" | "dryRun">): Promise<Resultado> {
  if (flags.guardarEn === null) return fallo(SALIDA.entradaInvalida, "falta_guardar_en", "Decí dónde guardar la clave: `supcoflow claves crear --nombre ci --guardar-en ~/ci.key` (fuera de un repo).");
  if (flags.nombre === null) return fallo(SALIDA.entradaInvalida, "falta_nombre", "Poné un nombre que diga para qué es: `--nombre ci`.");
  // Absoluta desde ya: la salida dice dónde quedó sin depender de dónde estaba parado el comando.
  const destino = path.resolve(d.cwd, flags.guardarEn);
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  const ruta = rutaDe(p.proyecto, "/claves");
  // Antes de pedir nada: un destino que no sirve (dentro de un repo) dejaba una fila pendiente de más.
  const invalido = d.secretos.validarDestino(destino);
  if (invalido !== null) return fallo(invalido.codigo, "destino_invalido", `${destino}: ${invalido.error}.`);
  if (flags.dryRun) return dryRun(`POST ${ruta} y después …/confirmar`);
  const alcance = `${p.proyecto.id}#${flags.nombre}`;
  // El registro de idempotencia pone el alcance en minúsculas (`CI` y `ci` comparten fila): el candado
  // tiene que coincidir, o dos procesos con la misma clave de reintento corrían a la vez.

  // 1. El candado: el ciclo entero, de a uno por operación en esta máquina. Comprobar que el archivo
  // autentica y después escribirlo no es atómico: sin candado, un segundo `claves crear` atrasado pisaba
  // el secreto vigente con uno que después no confirmaba (segunda revisión externa, hallazgo 1). Dos
  // máquinas no comparten la clave de idempotencia, así que crean filas distintas y no se pisan.
  const candado = d.candados.tomar(`${OPERACION}#${alcance.toLowerCase()}`);
  if (candado.tipo === "ocupado") return fallo(SALIDA.inesperado, "en_curso", "Otro `supcoflow claves crear` igual está corriendo en esta máquina; esperá a que termine.");
  if (candado.tipo === "abandonado") {
    return fallo(SALIDA.inesperado, "candado_abandonado",
      `Quedó el candado de un \`claves crear\` que no terminó: ${candado.ruta}. Si no hay otro corriendo, borralo y volvé a probar.`);
  }
  if (candado.tipo === "no_disponible") {
    return fallo(SALIDA.inesperado, "candado_no_disponible",
      `No pude crear el candado en ${candado.ruta} (¿permisos?). Revisá esa carpeta y volvé a probar.`);
  }
  try {
    const autentica = async (secreto: string) => d.esClaveDeConsultaDelProyecto(d.api, secreto, p.proyecto.id);
    const yaCreada = async (claveId: string): Promise<Resultado> => {
      await d.idempotencia.olvidar(OPERACION, alcance);
      return { codigo: SALIDA.ok, json: { ok: true, clave_id: claveId, archivo: destino, ya_confirmada: true }, texto: `La clave ${claveId} ya estaba creada; está en ${destino}.` };
    };

    // 2. Mirar el destino antes de pedir nada. Una clave de consulta de ESTE proyecto que autentica es un
    // éxito anterior: repetir el comando no crea otra fila (el archivo es la referencia durable; la clave
    // de idempotencia ya se olvidó). Una que no autentica sólo se retoma si hay un intento a medias
    // nuestro. Cualquier otra cosa (una clave personal aunque autentique, una de otro proyecto, una
    // revocada) no se pisa: podría ser una clave vigente de alguien (tercera revisión, hallazgo 2).
    const hay = d.secretos.leer(destino);
    if (hay.estado === "clave" && (await autentica(hay.secreto))) return await yaCreada(hay.claveId);
    if (hay.estado !== "ausente" && !(hay.estado === "clave" && (await d.idempotencia.tiene(OPERACION, alcance)))) {
      return fallo(SALIDA.haceFaltaUnaPersona, "destino_ocupado",
        `${destino} ya tiene algo que no es una clave vigente de este proyecto; no lo toco. Borrá el archivo o elegí otro destino con --guardar-en.`);
    }

    // 3. El ciclo. Estricta: sin la clave de reintento guardada no se manda nada (Review Focus 15).
    const key = await d.idempotencia.claveDe(OPERACION, alcance, { estricta: true });
    for (let vuelta = 0; vuelta < 2; vuelta++) {
      const r = await d.configurar(d.api, p.clave, ruta, { nombre: flags.nombre }, { idempotencyKey: key });
      if (r.status === 200 && r.cuerpo.estado === "activa") {
        // El motor no rota una activa (no devuelve secreto): vale sólo si lo que tenemos es su secreto vigente.
        const claveId = String(r.cuerpo.clave_id);
        const ahora = d.secretos.leer(destino);
        if (ahora.estado === "clave" && ahora.claveId === claveId && (await autentica(ahora.secreto))) return await yaCreada(claveId);
        await d.idempotencia.olvidar(OPERACION, alcance);
        return fallo(SALIDA.haceFaltaUnaPersona, "archivo_desactualizado",
          `La clave ${claveId} quedó activa, pero ${destino} no tiene su secreto vigente. Revocala con \`supcoflow claves revocar --id ${claveId}\` y creá otra.`);
      }
      if (r.status !== 201) {
        if (r.cuerpo.error === "clave_vencida") {
          // La fila vencida no vuelve: el próximo intento tiene que ser otra clave de idempotencia.
          await d.idempotencia.olvidar(OPERACION, alcance);
          // El archivo conserva el secreto pendiente vencido y un reintento daría 4 destino_ocupado. Borrarlo
          // desde acá sería tocar un archivo que quizá no escribió este run; se lo pedimos a la persona.
          return fallo(SALIDA.inesperado, "clave_vencida",
            `La clave pendiente venció sin confirmarse. Borrá ${destino} (guarda el secreto vencido, ya no sirve) y volvé a correr el comando para crear otra.`);
        }
        // Misma clave de reintento con otro cuerpo: no se arregla reintentando, y guardada trabaría para siempre.
        if (r.cuerpo.error === "idempotency_key_reusada") await d.idempotencia.olvidar(OPERACION, alcance);
        return desenlace(r, () => { throw new Error("inalcanzable"); });
      }
      const claveId = String(r.cuerpo.clave_id);
      const secreto = typeof r.cuerpo.clave === "string" && SUFIJO.test(r.cuerpo.clave) ? r.cuerpo.clave : null;
      if (secreto === null) return fallo(SALIDA.inesperado, "respuesta_inesperada", "El motor no devolvió una clave con la forma esperada.");
      // El id y el secreto tienen que ser de la misma fila: si no, lo que se guarda no es lo que se confirma.
      if (claveId !== `cla_${SUFIJO.exec(secreto)![1]}`) return fallo(SALIDA.inesperado, "respuesta_inesperada", "El motor devolvió una clave que no corresponde a su id; no la guardé.");
      const g = d.secretos.guardar(destino, claveId, secreto);
      // Sin guardarla NO se confirma: una pendiente sin confirmar no autentica y vence sola a los 10 minutos.
      if (g !== "guardado") return fallo(g.codigo, "no_se_guardo", `No guardé la clave en ${destino}: ${g.error}. No quedó activa.`);
      const c = await d.configurar(d.api, p.clave, `${ruta}/${encodeURIComponent(claveId)}/confirmar`, { clave: secreto });
      if (c.status === 200) {
        await d.idempotencia.olvidar(OPERACION, alcance);
        return { codigo: SALIDA.ok, json: { ok: true, clave_id: claveId, archivo: destino }, texto: `Creé la clave de consulta ${claveId} y la guardé en ${destino}.` };
      }
      // Obsoleta: otro intento con la misma clave de idempotencia le acuñó otro secreto a la misma fila.
      // Una vuelta más trae el vigente y lo guarda encima (mismo id).
      if (c.cuerpo.error !== "confirmacion_obsoleta") return desenlace(c, () => { throw new Error("inalcanzable"); });
    }
    return fallo(SALIDA.inesperado, "confirmacion_obsoleta", "Otro intento cambió la clave mientras la confirmaba; volvé a correr el comando.");
  } catch (e) {
    // Red caída a mitad, o el registro estricto que no pudo guardar: la clave de idempotencia (si llegó a
    // guardarse) se conserva y el reintento retoma la misma fila.
    return resultadoDeFallo(e);
  } finally {
    candado.soltar();
  }
}

export async function clavesListar(d: DepsDeClaves, flags: Pick<Flags, "repo">): Promise<Resultado> {
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  try {
    // El motor ya manda sólo id, nombre y fecha (nunca el hash); acá se arma la forma pública igual.
    const claves = (await d.listarClaves(d.api, p.clave, p.proyecto.id)).map((c) => ({ id: c.id, nombre: c.nombre, creada_en: c.creadaEn }));
    const texto = claves.length === 0
      ? "No hay claves de consulta activas."
      : `Claves de consulta activas: ${claves.map((c) => `${c.id} (${c.nombre})`).join(", ")}.`;
    return { codigo: SALIDA.ok, json: { ok: true, claves }, texto };
  } catch (e) {
    return resultadoDeFallo(e);
  }
}

export async function clavesRevocar(d: DepsDeClaves, flags: Pick<Flags, "repo" | "id" | "dryRun">): Promise<Resultado> {
  if (flags.id === null || !ID_DE_CLAVE.test(flags.id)) {
    return fallo(SALIDA.entradaInvalida, "id_invalido", "Decí qué clave revocar con su id: `supcoflow claves revocar --id cla_…` (lo da `supcoflow claves listar`).");
  }
  const claveId = flags.id;
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  const ruta = rutaDe(p.proyecto, "/claves/revocar");
  if (flags.dryRun) return dryRun(`POST ${ruta} {clave_id: ${claveId}}`);
  try {
    const r = await d.configurar(d.api, p.clave, ruta, { clave_id: claveId });
    // Revocar dos veces deja lo mismo que una: para quien lo pide, ya está hecho.
    if (r.status === 409 && r.cuerpo.error === "ya_revocada") {
      return { codigo: SALIDA.ok, json: { ok: true, clave_id: claveId, ya_revocada: true }, texto: `La clave ${claveId} ya estaba revocada.` };
    }
    return desenlace(r, () => ({ codigo: SALIDA.ok, json: { ok: true, clave_id: claveId }, texto: `Revoqué la clave ${claveId}; deja de autenticar.` }));
  } catch (e) {
    return resultadoDeFallo(e);
  }
}
