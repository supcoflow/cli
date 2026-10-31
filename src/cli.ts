#!/usr/bin/env node
// El binario `supcoflow`: lee los argumentos, arma el entorno real y despacha. Todo va dentro de un
// solo try/catch: cualquier cosa que se escape (un archivo de credenciales ilegible, un llavero roto)
// sale como un 1 limpio, en una línea si se pidió --json, sin traza y con los secretos tapados.
import { revocarPropia } from "./api.ts";
import { leerArgumentos } from "./argumentos.ts";
import { clavesCrear, clavesListar, clavesRevocar } from "./comandos/claves.ts";
import { chatLogo, chatMarca, chatPrenderApagar, comandoConfiguracion, sitios } from "./comandos/configurar.ts";
import { guiaPublicar, guiaRevisar, guiaUsar, guiaVer, guiaVersiones } from "./comandos/guia.ts";
import { instalacionAnotar } from "./comandos/instalacion.ts";
import { comandoCatalogo, datosFijar, politicaFijar } from "./comandos/datos-y-politica.ts";
import { ayuda, comandoDescribir, DESCRIPCION } from "./comandos/describir.ts";
import { loginInteractivo, loginStart, loginWait } from "./comandos/login.ts";
import { comandoLogout } from "./comandos/logout.ts";
import { diagnosticar, probar } from "./comandos/probar.ts";
import { proyectoCrear, proyectoVer } from "./comandos/proyecto.ts";
import { comandoQuienSoy } from "./comandos/quien-soy.ts";
import { repoConectarInteractivo, repoConectarStart, repoConectarWait } from "./comandos/repo-conectar.ts";
import { widget } from "./comandos/widget.ts";
import { emitir, FalloDeLaTerminal, resultadoDeFallo, SALIDA, type Resultado } from "./contrato.ts";
import { entornoReal } from "./entorno.ts";
import { archivosDeMas, flagQueNoAplica } from "./flags-por-comando.ts";

const COMANDOS = new Set(DESCRIPCION.comandos.map((c) => c.nombre));

const invalida = (error: string, message: string) => new FalloDeLaTerminal(SALIDA.entradaInvalida, error, message);
// Los nombres que la terminal tenía antes de la 0.8.0 siguen valiendo (`src/alias.ts`), pero no salen en `describe`.

async function correr(argv: string[]): Promise<{ r: Resultado; json: boolean }> {
  // Si los argumentos no se pueden leer no se sabe qué flags hay: se mira `--json` a mano para que
  // el error salga en el formato que pidió quien llama.
  let json = argv.includes("--json");
  try {
    const { comando, flags, viejos } = leerArgumentos(argv);
    json = flags.json;

    if (comando !== null && !COMANDOS.has(comando)) {
      throw invalida("comando_desconocido", `Unknown command «${comando}». Try \`supcoflow --help\`.`);
    }
    if (flags.help || comando === null) {
      const texto = ayuda(comando);
      return { r: { codigo: SALIDA.ok, json: { ok: true, ayuda: texto }, texto }, json };
    }
    const presentes: Record<string, boolean> = {
      start: flags.start, wait: flags.wait, repo: flags.repo !== null, install: flags.install !== null, test: flags.test !== null,
      site: flags.site !== null, title: flags.title !== null, greeting: flags.greeting !== null, theme: flags.theme.length > 0,
      file: flags.file !== null, allow: flags.allow !== null, mode: flags.mode !== null,
      name: flags.name !== null, saveTo: flags.saveTo !== null, id: flags.id !== null, source: flags.source !== null, fromGithub: flags.fromGithub,
      skill: flags.skill !== null, app: flags.app !== null, shape: flags.shape !== null,
      authorizeSpend: flags.authorizeSpend, message: flags.message !== null, testId: flags.testId !== null,
      ceiling: flags.ceiling !== null, expectPolicy: flags.expectPolicy !== null,
    };
    const noAplica = flagQueNoAplica(comando, Object.keys(presentes).filter((k) => presentes[k]));
    if (noAplica !== null) throw invalida("flag_no_aplica", noAplica);
    const deMas = archivosDeMas(comando, flags.files.length);
    if (deMas !== null) throw invalida("argumentos_invalidos", deMas);
    if (flags.start && flags.wait) {
      throw invalida("flags_incompatibles", "--start and --wait go separately: first one and then the other.");
    }
    if (comando === "describe") return { r: comandoDescribir(), json };

    if (comando === "login") {
      // ANTES de armar el entorno: no hay cómo simular un canje sin consumirlo, y este error no
      // puede depender de leer nada guardado ni de llamar al motor.
      if (flags.wait && flags.dryRun) {
        throw invalida("dry_run_no_soportado", "`login --wait` has no --dry-run: polling consumes the code. Try `supcoflow login --start --dry-run`.");
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
      case "whoami":
        return { r: await comandoQuienSoy({ api: e.api, guardado: e.guardado, quienSoy: e.quienSoy, avisar: e.avisar }), json };
      case "repo connect":
        if (flags.start) return { r: await repoConectarStart(e.conexion, flags), json };
        // `--wait` sólo lee (un GET por tramo): con --dry-run haría lo mismo, así que no se rechaza.
        if (flags.wait) return { r: await repoConectarWait(e.conexion, flags), json };
        // Como `login`: sin TTY, --dry-run igual dice lo que haría el primer paso, sin tocar el motor.
        if (flags.dryRun) return { r: await repoConectarStart(e.conexion, { repo: flags.repo, dryRun: true }), json };
        return { r: await repoConectarInteractivo({ ...e.conexion, esTty: e.esTty, mostrar: e.mostrar }, flags), json };
      case "project create":
        return { r: await proyectoCrear(e.proyecto, flags), json };
      case "project show":
        return { r: await proyectoVer(e.proyecto, flags), json };
      case "catalog":
        return { r: await comandoCatalogo(e.configurar), json };
      case "config":
        return { r: await comandoConfiguracion(e.configurar, flags), json };
      case "chat on":
        return { r: await chatPrenderApagar(e.configurar, flags, true), json };
      case "chat off":
        return { r: await chatPrenderApagar(e.configurar, flags, false), json };
      case "chat brand":
        return { r: await chatMarca(e.configurar, flags), json };
      case "chat logo":
        return { r: await chatLogo(e.configurar, flags), json };
      case "sites add":
        return { r: await sitios(e.configurar, flags, "agregar"), json };
      case "sites remove":
        return { r: await sitios(e.configurar, flags, "quitar"), json };
      case "data set":
        return { r: await datosFijar(e.configurar, flags), json };
      case "policy set":
        return { r: await politicaFijar(e.configurar, flags), json };
      case "keys create":
        return { r: await clavesCrear(e.claves, flags), json };
      case "keys list":
        return { r: await clavesListar(e.claves, flags), json };
      case "keys revoke":
        return { r: await clavesRevocar(e.claves, flags), json };
      case "guide check":
        return { r: await guiaRevisar(e.guia, flags), json };
      case "guide publish":
        return { r: await guiaPublicar(e.guia, flags), json };
      case "guide show":
        return { r: await guiaVer(e.guia, flags), json };
      case "guide use":
        return { r: await guiaUsar(e.guia, flags), json };
      case "guide versions":
        return { r: await guiaVersiones(e.guia, flags), json };
      case "widget":
        return { r: await widget(e.widget, flags), json };
      case "install record":
        return { r: await instalacionAnotar(e.instalacion, flags), json };
      case "diagnose":
        return { r: await diagnosticar(e.prueba, flags), json };
      case "test":
        // El alias viejo (`probar`, o `--autorizo-gasto` con cualquier nombre) no puede ampliar lo autorizado: lo marca.
        return { r: await probar(e.prueba, { ...flags, viejo: viejos.includes("probar") || viejos.includes("--autorizo-gasto") }), json };
    }
    throw new Error(`command without dispatch: ${comando}`);
  } catch (e) {
    return { r: resultadoDeFallo(e), json };
  }
}

// `process.exitCode` y nunca `process.exit()`: éste corta el proceso con stdout a medio escribir
// cuando la salida va a un pipe, y quien llama leería una línea de JSON partida.
const { r, json } = await correr(process.argv.slice(2));
emitir(r, json, (s) => void process.stdout.write(s));
process.exitCode = r.codigo;
