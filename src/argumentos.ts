import { parseArgs } from "node:util";
import { FalloDeLaTerminal, SALIDA } from "./contrato.ts";

export type Flags = {
  json: boolean; dryRun: boolean; help: boolean; start: boolean; wait: boolean;
  repo: string | null; install: string | null; test: string | null;
};

export const COMANDOS_COMPUESTOS = ["repo conectar", "proyecto crear", "proyecto ver"] as const;
// Sólo estas primeras palabras admiten una segunda: cualquier otro par sigue siendo «de más».
const PRIMERAS_PALABRAS = new Set(COMANDOS_COMPUESTOS.map((c) => c.split(" ")[0]));
const FLAGS_CON_VALOR = ["repo", "install", "test"] as const;

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
        repo: { type: "string" },
        install: { type: "string" },
        test: { type: "string" },
      },
      tokens: true,
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
  const pos = parsed.positionals;
  const deMas = () =>
    new FalloDeLaTerminal(SALIDA.entradaInvalida, "argumentos_de_mas", "Pasaste más de un comando. Probá `supcoflow --help`.");
  if (pos.length > 2 || (pos.length === 2 && !PRIMERAS_PALABRAS.has(pos[0]!))) throw deMas();
  // `parseArgs` se queda con el último valor de un flag repetido: un asistente que repite `--repo`
  // creería que se usó el primero. Se mira en los tokens y se rechaza.
  for (const nombre of FLAGS_CON_VALOR) {
    const toks = (parsed.tokens ?? []).filter((t) => t.kind === "option" && t.name === nombre);
    if (toks.length > 1 || toks.some((t) => t.kind === "option" && t.value === "")) {
      throw new FalloDeLaTerminal(
        SALIDA.entradaInvalida,
        "argumentos_invalidos",
        `--${nombre} va una sola vez y con un valor. Probá \`supcoflow --help\`.`,
      );
    }
  }
  // Un par desconocido (`repo borrar`) queda como la primera palabra sola: el despacho la rechaza
  // como comando desconocido, con el mismo mensaje que cualquier otra.
  const compuesto = pos.length === 2 ? `${pos[0]} ${pos[1]}` : null;
  const comando = compuesto !== null && (COMANDOS_COMPUESTOS as readonly string[]).includes(compuesto) ? compuesto : (pos[0] ?? null);
  const v = parsed.values;
  return {
    comando,
    flags: {
      json: v.json === true,
      dryRun: v["dry-run"] === true,
      help: v.help === true,
      start: v.start === true,
      wait: v.wait === true,
      repo: v.repo ?? null,
      install: v.install ?? null,
      test: v.test ?? null,
    },
  };
}
