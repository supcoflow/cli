import { parseArgs } from "node:util";
import { FalloDeLaTerminal, SALIDA } from "./contrato.ts";

export type Flags = {
  json: boolean; dryRun: boolean; help: boolean; start: boolean; wait: boolean;
  repo: string | null; install: string | null; test: string | null;
  sitio: string | null; titulo: string | null; saludo: string | null; archivo: string | null; permitir: string | null;
  modo: string | null; nombre: string | null; guardarEn: string | null; id: string | null;
  tema: string[];
};

export const COMANDOS_COMPUESTOS = [
  "repo conectar", "proyecto crear", "proyecto ver",
  "chat prender", "chat apagar", "chat marca", "chat logo", "sitios agregar", "sitios quitar",
  "datos fijar", "politica fijar", "claves crear", "claves listar", "claves revocar",
] as const;
// Sólo estas primeras palabras admiten una segunda: cualquier otro par sigue siendo «de más».
const PRIMERAS_PALABRAS = new Set(COMANDOS_COMPUESTOS.map((c) => c.split(" ")[0]));
const FLAGS_CON_VALOR = [
  "repo", "install", "test", "sitio", "titulo", "saludo", "archivo", "permitir", "modo", "nombre", "guardar-en", "id",
] as const;

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
        sitio: { type: "string" },
        titulo: { type: "string" },
        saludo: { type: "string" },
        archivo: { type: "string" },
        permitir: { type: "string" },
        modo: { type: "string" },
        nombre: { type: "string" },
        "guardar-en": { type: "string" },
        id: { type: "string" },
        tema: { type: "string", multiple: true },
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
  // `--tema` sí se repite (uno por clave), pero ninguno vacío: un `--tema ""` es un error de quien arma
  // el comando, no «sin tema».
  if ((parsed.values.tema ?? []).some((t) => t === "")) {
    throw new FalloDeLaTerminal(SALIDA.entradaInvalida, "argumentos_invalidos", "--tema va con un valor clave=valor. Probá `supcoflow --help`.");
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
      sitio: v.sitio ?? null,
      titulo: v.titulo ?? null,
      saludo: v.saludo ?? null,
      archivo: v.archivo ?? null,
      permitir: v.permitir ?? null,
      modo: v.modo ?? null,
      nombre: v.nombre ?? null,
      guardarEn: v["guardar-en"] ?? null,
      id: v.id ?? null,
      tema: v.tema ?? [],
    },
  };
}
