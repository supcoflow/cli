#!/usr/bin/env node
// El binario `supcoflow`: lee los argumentos, arma el entorno real y despacha. Todo va dentro de un
// solo try/catch: cualquier cosa que se escape (un archivo de credenciales ilegible, un llavero roto)
// sale como un 1 limpio, en una línea si se pidió --json, sin traza y con los secretos tapados.
import { revocarPropia } from "./api.ts";
import { leerArgumentos } from "./argumentos.ts";
import { clavesCrear, clavesListar, clavesRevocar } from "./comandos/claves.ts";
import { chatLogo, chatMarca, chatPrenderApagar, comandoConfiguracion, sitios } from "./comandos/configurar.ts";
import { comandoCatalogo, datosFijar, politicaFijar } from "./comandos/datos-y-politica.ts";
import { ayuda, comandoDescribir, DESCRIPCION } from "./comandos/describir.ts";
import { loginInteractivo, loginStart, loginWait } from "./comandos/login.ts";
import { comandoLogout } from "./comandos/logout.ts";
import { proyectoCrear, proyectoVer } from "./comandos/proyecto.ts";
import { comandoQuienSoy } from "./comandos/quien-soy.ts";
import { repoConectarInteractivo, repoConectarStart, repoConectarWait } from "./comandos/repo-conectar.ts";
import { emitir, FalloDeLaTerminal, resultadoDeFallo, SALIDA, type Resultado } from "./contrato.ts";
import { entornoReal } from "./entorno.ts";
import { flagQueNoAplica } from "./flags-por-comando.ts";

const COMANDOS = new Set(DESCRIPCION.comandos.map((c) => c.nombre));

const invalida = (error: string, message: string) => new FalloDeLaTerminal(SALIDA.entradaInvalida, error, message);

async function correr(argv: string[]): Promise<{ r: Resultado; json: boolean }> {
  // Si los argumentos no se pueden leer no se sabe qué flags hay: se mira `--json` a mano para que
  // el error salga en el formato que pidió quien llama.
  let json = argv.includes("--json");
  try {
    const { comando, flags } = leerArgumentos(argv);
    json = flags.json;

    if (comando !== null && !COMANDOS.has(comando)) {
      throw invalida("comando_desconocido", `No conozco el comando «${comando}». Probá \`supcoflow --help\`.`);
    }
    if (flags.help || comando === null) {
      const texto = ayuda(comando);
      return { r: { codigo: SALIDA.ok, json: { ok: true, ayuda: texto }, texto }, json };
    }
    const presentes: Record<string, boolean> = {
      start: flags.start, wait: flags.wait, repo: flags.repo !== null, install: flags.install !== null, test: flags.test !== null,
      sitio: flags.sitio !== null, titulo: flags.titulo !== null, saludo: flags.saludo !== null, tema: flags.tema.length > 0,
      archivo: flags.archivo !== null, permitir: flags.permitir !== null, modo: flags.modo !== null,
      nombre: flags.nombre !== null, guardarEn: flags.guardarEn !== null, id: flags.id !== null,
    };
    const noAplica = flagQueNoAplica(comando, Object.keys(presentes).filter((k) => presentes[k]));
    if (noAplica !== null) throw invalida("flag_no_aplica", noAplica);
    if (flags.start && flags.wait) {
      throw invalida("flags_incompatibles", "--start y --wait van por separado: primero uno y después el otro.");
    }
    if (comando === "describir") return { r: comandoDescribir(), json };

    if (comando === "login") {
      // ANTES de armar el entorno: no hay cómo simular un canje sin consumirlo, y este error no
      // puede depender de leer nada guardado ni de llamar al motor.
      if (flags.wait && flags.dryRun) {
        throw invalida("dry_run_no_soportado", "`login --wait` no tiene --dry-run: sondear consume el código. Probá `supcoflow login --start --dry-run`.");
      }
    }

    const e = entornoReal();
    switch (comando) {
      case "login":
        if (flags.start) return { r: await loginStart(e.login, flags), json };
        if (flags.wait) return { r: await loginWait(e.login), json };
        // Sin TTY, `login --dry-run` igual tiene algo que decir: lo que haría el primer paso.
        if (flags.dryRun) return { r: await loginStart(e.login, { dryRun: true }), json };
        return { r: await loginInteractivo({ ...e.login, esTty: e.esTty, mostrar: e.mostrar }, flags), json };
      case "logout":
        return {
          r: await comandoLogout({
            api: e.api, guardado: e.guardado, ahora: e.login.ahora, avisar: e.avisar,
            revocarPropia: (a, clave, plazoMs) => revocarPropia(a, clave, fetch, plazoMs),
          }, flags),
          json,
        };
      case "quien-soy":
        return { r: await comandoQuienSoy({ api: e.api, guardado: e.guardado, quienSoy: e.quienSoy, avisar: e.avisar }), json };
      case "repo conectar":
        if (flags.start) return { r: await repoConectarStart(e.conexion, flags), json };
        // `--wait` sólo lee (un GET por tramo): con --dry-run haría lo mismo, así que no se rechaza.
        if (flags.wait) return { r: await repoConectarWait(e.conexion, flags), json };
        // Como `login`: sin TTY, --dry-run igual dice lo que haría el primer paso, sin tocar el motor.
        if (flags.dryRun) return { r: await repoConectarStart(e.conexion, { repo: flags.repo, dryRun: true }), json };
        return { r: await repoConectarInteractivo({ ...e.conexion, esTty: e.esTty, mostrar: e.mostrar }, flags), json };
      case "proyecto crear":
        return { r: await proyectoCrear(e.proyecto, flags), json };
      case "proyecto ver":
        return { r: await proyectoVer(e.proyecto, flags), json };
      case "catalogo":
        return { r: await comandoCatalogo(e.configurar), json };
      case "configuracion":
        return { r: await comandoConfiguracion(e.configurar, flags), json };
      case "chat prender":
        return { r: await chatPrenderApagar(e.configurar, flags, true), json };
      case "chat apagar":
        return { r: await chatPrenderApagar(e.configurar, flags, false), json };
      case "chat marca":
        return { r: await chatMarca(e.configurar, flags), json };
      case "chat logo":
        return { r: await chatLogo(e.configurar, flags), json };
      case "sitios agregar":
        return { r: await sitios(e.configurar, flags, "agregar"), json };
      case "sitios quitar":
        return { r: await sitios(e.configurar, flags, "quitar"), json };
      case "datos fijar":
        return { r: await datosFijar(e.configurar, flags), json };
      case "politica fijar":
        return { r: await politicaFijar(e.configurar, flags), json };
      case "claves crear":
        return { r: await clavesCrear(e.claves, flags), json };
      case "claves listar":
        return { r: await clavesListar(e.claves, flags), json };
      case "claves revocar":
        return { r: await clavesRevocar(e.claves, flags), json };
    }
    throw new Error(`comando sin despacho: ${comando}`);
  } catch (e) {
    return { r: resultadoDeFallo(e), json };
  }
}

// `process.exitCode` y nunca `process.exit()`: éste corta el proceso con stdout a medio escribir
// cuando la salida va a un pipe, y quien llama leería una línea de JSON partida.
const { r, json } = await correr(process.argv.slice(2));
emitir(r, json, (s) => void process.stdout.write(s));
process.exitCode = r.codigo;
