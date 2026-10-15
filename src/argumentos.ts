import { parseArgs } from "node:util";
import { FalloDeLaTerminal, SALIDA } from "./contrato.ts";

export type Flags = { json: boolean; dryRun: boolean; help: boolean; start: boolean; wait: boolean };

// strict: un flag mal escrito (`--estart`) no se ignora en silencio: un asistente creería que
// pidió algo que no pidió.
export function leerArgumentos(argv: string[]): { comando: string | null; flags: Flags } {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: true,
      options: {
        json: { type: "boolean" },
        "dry-run": { type: "boolean" },
        help: { type: "boolean", short: "h" },
        start: { type: "boolean" },
        wait: { type: "boolean" },
      },
    });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
      const m = /'(--?[^']+)'/.exec((e as Error).message);
      throw new FalloDeLaTerminal(
        SALIDA.entradaInvalida,
        "flag_desconocido",
        `No conozco el flag ${m ? m[1] : "que pasaste"}. Probá \`supcoflow --help\`.`,
      );
    }
    throw new FalloDeLaTerminal(SALIDA.entradaInvalida, "argumentos_invalidos", `${(e as Error).message} Probá \`supcoflow --help\`.`);
  }
  if (parsed.positionals.length > 1) {
    throw new FalloDeLaTerminal(
      SALIDA.entradaInvalida,
      "argumentos_de_mas",
      "Pasaste más de un comando. Probá `supcoflow --help`.",
    );
  }
  const v = parsed.values;
  return {
    comando: parsed.positionals[0] ?? null,
    flags: {
      json: v.json === true,
      dryRun: v["dry-run"] === true,
      help: v.help === true,
      start: v.start === true,
      wait: v.wait === true,
    },
  };
}
