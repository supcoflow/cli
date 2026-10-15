#!/usr/bin/env node
// El binario `supcoflow`: lee los argumentos, arma el entorno real y despacha. Todo va dentro de un
// solo try/catch: cualquier cosa que se escape (un archivo de credenciales ilegible, un llavero roto)
// sale como un 1 limpio, en una línea si se pidió --json, sin traza y con los secretos tapados.
import { revocarPropia } from "./api.ts";
import { leerArgumentos } from "./argumentos.ts";
import { ayuda, comandoDescribir, DESCRIPCION } from "./comandos/describir.ts";
import { loginInteractivo, loginStart, loginWait } from "./comandos/login.ts";
import { comandoLogout } from "./comandos/logout.ts";
import { proyectoCrear, proyectoVer } from "./comandos/proyecto.ts";
import { comandoQuienSoy } from "./comandos/quien-soy.ts";
import { repoConectarInteractivo, repoConectarStart, repoConectarWait } from "./comandos/repo-conectar.ts";
import { emitir, FalloDeLaTerminal, resultadoDeFallo, SALIDA, type Resultado } from "./contrato.ts";
import { entornoReal } from "./entorno.ts";

const COMANDOS = new Set(DESCRIPCION.comandos.map((c) => c.nombre));

const invalida = (error: string, message: string) => new FalloDeLaTerminal(SALIDA.entradaInvalida, error, message);

// Qué comandos aceptan cada flag que no es global. Un flag que no aplica sale 3 en vez de ignorarse:
// un asistente que pasa `--repo` a `quien-soy` creería que preguntó por ese repo.
const FLAGS_POR_COMANDO = [
  { flags: ["start", "wait"], comandos: ["login", "repo conectar"], texto: "--start y --wait son de `supcoflow login` y `supcoflow repo conectar`." },
  { flags: ["repo"], comandos: ["repo conectar", "proyecto crear", "proyecto ver"], texto: "--repo es de `supcoflow repo conectar` y `supcoflow proyecto crear|ver`." },
  { flags: ["install", "test"], comandos: ["proyecto crear"], texto: "--install y --test son de `supcoflow proyecto crear`." },
] as const;

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
    };
    for (const regla of FLAGS_POR_COMANDO) {
      if (regla.flags.some((f) => presentes[f]) && !(regla.comandos as readonly string[]).includes(comando)) {
        throw invalida("flag_no_aplica", regla.texto);
      }
    }
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
