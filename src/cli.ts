#!/usr/bin/env node
// El binario `supcoflow`: lee los argumentos, arma el entorno real y despacha. Todo va dentro de un
// solo try/catch: cualquier cosa que se escape (un archivo de credenciales ilegible, un llavero roto)
// sale como un 1 limpio, en una línea si se pidió --json, sin traza y con los secretos tapados.
import { revocarPropia } from "./api.ts";
import { leerArgumentos } from "./argumentos.ts";
import { ayuda, comandoDescribir, DESCRIPCION } from "./comandos/describir.ts";
import { loginInteractivo, loginStart, loginWait } from "./comandos/login.ts";
import { comandoLogout } from "./comandos/logout.ts";
import { comandoQuienSoy } from "./comandos/quien-soy.ts";
import { emitir, FalloDeLaTerminal, resultadoDeFallo, SALIDA, type Resultado } from "./contrato.ts";
import { entornoReal } from "./entorno.ts";

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
    if ((flags.start || flags.wait) && comando !== "login") {
      throw invalida("flag_no_aplica", "--start y --wait son sólo de `supcoflow login`.");
    }
    if (comando === "describir") return { r: comandoDescribir(), json };

    if (comando === "login") {
      if (flags.start && flags.wait) {
        throw invalida("flags_incompatibles", "--start y --wait van por separado: primero uno y después el otro.");
      }
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
