import { parseArgs } from "node:util";
import { COMANDOS_VIEJOS, FLAGS_VIEJOS } from "./alias.ts";
import { FalloDeLaTerminal, SALIDA } from "./contrato.ts";

export type Flags = {
  json: boolean; dryRun: boolean; help: boolean; start: boolean; wait: boolean;
  repo: string | null; install: string | null; test: string | null;
  site: string | null; title: string | null; greeting: string | null; file: string | null; allow: string | null;
  mode: string | null; name: string | null; saveTo: string | null; id: string | null;
  theme: string[];
  source: string | null;
  fromGithub: boolean;
  skill: string | null; app: string | null;
  // T8: `--file` se puede repetir sólo en `install record` (una interfaz propia vive en varios archivos); `file` es el primero.
  files: string[]; shape: string | null;
  authorizeSpend: boolean; message: string | null; testId: string | null;
  ceiling: string | null; expectPolicy: string | null;
};

export const COMANDOS_COMPUESTOS = [
  "repo connect", "project create", "project show",
  "chat on", "chat off", "chat brand", "chat logo", "sites add", "sites remove",
  "data set", "policy set", "keys create", "keys list", "keys revoke",
  "guide check", "guide publish", "guide show", "guide use", "guide versions",
  "install record",
] as const;
// Sólo estas primeras palabras admiten una segunda: cualquier otro par sigue siendo «de más». Entran también las de
// los nombres viejos (`guia publicar`), que se resuelven más abajo.
const PRIMERAS_PALABRAS = new Set([...COMANDOS_COMPUESTOS, ...Object.keys(COMANDOS_VIEJOS)].filter((c) => c.includes(" ")).map((c) => c.split(" ")[0]));
const FLAGS_CON_VALOR = [
  "repo", "install", "test", "site", "title", "greeting", "file", "allow", "mode", "name", "save-to", "id", "source", "skill", "app",
  "message", "test-id", "ceiling", "expect-policy", "shape",
] as const;
// Los que sí se repiten (cada comando decide cuántos acepta: `cli.ts`, `archivosDeMas`); ninguno va vacío.
const FLAGS_REPETIBLES = new Set<string>(["file"]);
const FLAGS_BOOLEANOS = ["json", "dry-run", "help", "start", "wait", "from-github", "authorize-spend"] as const;

// El flag que el token nombró, ya llevado a su nombre canónico (el viejo y el nuevo cuentan como el mismo).
const canonico = (nombre: string) => FLAGS_VIEJOS[nombre] ?? nombre;

const invalida = (error: string, message: string) => new FalloDeLaTerminal(SALIDA.entradaInvalida, error, message);

function opciones() {
  const o: Record<string, { type: "string" | "boolean"; short?: string; multiple?: boolean }> = {};
  for (const f of FLAGS_BOOLEANOS) o[f] = f === "help" ? { type: "boolean", short: "h" } : { type: "boolean" };
  for (const f of FLAGS_CON_VALOR) o[f] = { type: "string" };
  o.theme = { type: "string", multiple: true };
  for (const [viejo, nuevo] of Object.entries(FLAGS_VIEJOS)) o[viejo] = { ...o[nuevo]! };
  return o;
}

// strict: un flag mal escrito (`--estart`) no se ignora en silencio: un asistente creería que
// pidió algo que no pidió.
export function leerArgumentos(argv: string[]): { comando: string | null; flags: Flags; viejos: string[] } {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, strict: true, allowPositionals: true, options: opciones(), tokens: true });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
      const m = /'(--?[^']+)'/.exec((e as Error).message);
      throw invalida("flag_desconocido", `Unknown flag ${m ? m[1] : "you passed"}. Try \`supcoflow --help\`.`);
    }
    throw invalida("argumentos_invalidos", `${(e as Error).message} Try \`supcoflow --help\`.`);
  }
  const pos = parsed.positionals;
  if (pos.length > 2 || (pos.length === 2 && !PRIMERAS_PALABRAS.has(pos[0]!))) {
    throw invalida("argumentos_de_mas", "You passed more than one command. Try `supcoflow --help`.");
  }
  const tokens = (parsed.tokens ?? []).filter((t) => t.kind === "option");
  const viejos: string[] = [];
  // `parseArgs` se queda con el último valor de un flag repetido: un asistente que repite `--repo` (o que pasa el
  // nombre viejo y el nuevo de un mismo flag) creería que se usó el primero. Se mira en los tokens y se rechaza.
  for (const nombre of FLAGS_CON_VALOR) {
    const toks = tokens.filter((t) => canonico(t.name) === nombre);
    if ((toks.length > 1 && !FLAGS_REPETIBLES.has(nombre)) || toks.some((t) => t.value === "")) {
      throw invalida("argumentos_invalidos", `--${nombre} goes once, with a value. Try \`supcoflow --help\`.`);
    }
  }
  for (const t of tokens) if (t.name in FLAGS_VIEJOS) viejos.push(`--${t.name}`);
  // `--theme` sí se repite (uno por clave), pero ninguno vacío: un `--theme ""` es un error de quien arma
  // el comando, no «sin tema». Se junta desde los tokens para conservar el orden entre el nombre viejo y el nuevo.
  const tema = tokens.filter((t) => canonico(t.name) === "theme").map((t) => t.value ?? "");
  if (tema.some((t) => t === "")) throw invalida("argumentos_invalidos", "--theme goes with a key=value. Try `supcoflow --help`.");
  // Un par desconocido (`repo borrar`) queda como la primera palabra sola: el despacho la rechaza
  // como comando desconocido, con el mismo mensaje que cualquier otra.
  const escrito = pos.length === 2 ? `${pos[0]} ${pos[1]}` : (pos[0] ?? null);
  let comando: string | null;
  if (escrito !== null && escrito in COMANDOS_VIEJOS) {
    comando = COMANDOS_VIEJOS[escrito]!;
    viejos.unshift(escrito);
  } else if (pos.length === 2 && (COMANDOS_COMPUESTOS as readonly string[]).includes(escrito!)) {
    comando = escrito;
  } else {
    comando = pos[0] ?? null;
  }
  const un = (nombre: string): string | null => {
    const t = tokens.find((x) => canonico(x.name) === nombre);
    return t === undefined ? null : (t.value ?? null);
  };
  const hay = (nombre: string) => tokens.some((x) => canonico(x.name) === nombre);
  const archivos = tokens.filter((t) => canonico(t.name) === "file").map((t) => t.value ?? "");
  return {
    comando,
    viejos,
    flags: {
      json: hay("json"),
      dryRun: hay("dry-run"),
      help: hay("help"),
      start: hay("start"),
      wait: hay("wait"),
      repo: un("repo"),
      install: un("install"),
      test: un("test"),
      site: un("site"),
      title: un("title"),
      greeting: un("greeting"),
      file: un("file"),
      allow: un("allow"),
      mode: un("mode"),
      name: un("name"),
      saveTo: un("save-to"),
      id: un("id"),
      source: un("source"),
      fromGithub: hay("from-github"),
      skill: un("skill"),
      app: un("app"),
      files: archivos,
      shape: un("shape"),
      authorizeSpend: hay("authorize-spend"),
      message: un("message"),
      testId: un("test-id"),
      ceiling: un("ceiling"),
      expectPolicy: un("expect-policy"),
      theme: tema,
    },
  };
}
