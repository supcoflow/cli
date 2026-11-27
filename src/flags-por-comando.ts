// Qué comandos aceptan cada flag que no es global. Un flag que no aplica sale 3 en vez de ignorarse:
// un asistente que pasa `--repo` a `whoami` creería que preguntó por ese repo. Vive aparte de
// `cli.ts` (que corre al importarse) para poder probarse sin lanzar el binario. Los nombres de los
// campos son los de `Flags`; los textos nombran los flags y comandos canónicos.
const DE_CONFIGURAR_CON_REPO = [
  "config", "chat on", "chat off", "chat brand", "chat logo", "sites add", "sites remove",
  "data set", "policy set", "keys create", "keys list", "keys revoke",
  "guide check", "guide publish", "guide show", "guide use", "guide versions",
] as const;

const DE_AGENTS = ["agents show", "agents set-key", "agents check", "agents remove", "agents configure"] as const;
// Etapa 2c. `reports` habla con la clave de la persona y sobre el proyecto del repo; `gate` con la clave de un AGENTE, que ya trae su proyecto (no hay `--repo`).
const DE_REPORTS = ["reports list", "reports show", "reports investigate"] as const;
const DE_GATE = ["gate status", "gate read", "gate pass", "gate deliver", "gate fail"] as const;

export const FLAGS_POR_COMANDO: readonly { flags: readonly string[]; comandos: readonly string[]; texto: string }[] = [
  { flags: ["start"], comandos: ["login", "repo connect"], texto: "--start belongs to `supcoflow login` and `supcoflow repo connect`." },
  { flags: ["full"], comandos: ["diagnose", "test", "reports list", "reports show", "gate read"], texto: "--full belongs to `supcoflow diagnose`, `supcoflow test`, `supcoflow reports list|show` and `supcoflow gate read`." },
  { flags: ["noBrowser"], comandos: ["login", "repo connect"], texto: "--no-browser belongs to `supcoflow login` and `supcoflow repo connect`." },
  { flags: ["wait"], comandos: ["login", "repo connect", "test"], texto: "--wait belongs to `supcoflow login`, `supcoflow repo connect` and `supcoflow test`." },
  {
    flags: ["repo"], comandos: ["repo connect", "project create", "project show", ...DE_CONFIGURAR_CON_REPO, ...DE_AGENTS, ...DE_REPORTS, "widget", "install record", "diagnose", "test"],
    texto: "--repo belongs to `supcoflow repo connect`, `project create|show`, `widget`, `install record`, `diagnose`, `test`, `agents`, `reports` and the commands that configure a project (not to `catalog`, and not to `gate`: an agent's key already says its project).",
  },
  { flags: ["install", "test"], comandos: ["project create"], texto: "--install and --test belong to `supcoflow project create`." },
  { flags: ["site"], comandos: ["sites add", "sites remove"], texto: "--site belongs to `supcoflow sites add|remove`." },
  { flags: ["title", "greeting", "theme"], comandos: ["chat brand"], texto: "--title, --greeting and --theme belong to `supcoflow chat brand`." },
  { flags: ["file"], comandos: ["chat logo", "install record", "gate deliver", "gate fail"], texto: "--file belongs to `supcoflow chat logo`, `supcoflow install record`, `supcoflow gate deliver` and `supcoflow gate fail`." },
  { flags: ["allow"], comandos: ["data set"], texto: "--allow belongs to `supcoflow data set`." },
  { flags: ["mode"], comandos: ["policy set"], texto: "--mode belongs to `supcoflow policy set`." },
  { flags: ["name", "saveTo"], comandos: ["keys create"], texto: "--name and --save-to belong to `supcoflow keys create`." },
  { flags: ["source"], comandos: ["guide use"], texto: "--source belongs to `supcoflow guide use`." },
  { flags: ["fromGithub"], comandos: ["guide publish"], texto: "--from-github belongs to `supcoflow guide publish`." },
  { flags: ["base", "strict"], comandos: ["guide stale"], texto: "--base and --strict belong to `supcoflow guide stale`." },
  { flags: ["id"], comandos: ["keys revoke", "reports show", "reports investigate", "gate read", "gate pass", "gate deliver", "gate fail"], texto: "--id belongs to `supcoflow keys revoke`, `reports show|investigate` and `gate read|pass|deliver|fail`." },
  {
    flags: ["expectPolicy", "message", "testId"], comandos: ["test"],
    texto: "--expect-policy, --message and --test-id belong to `supcoflow test`.",
  },
  {
    flags: ["authorizeSpend", "ceiling"], comandos: ["test", "reports investigate"],
    texto: "--authorize-spend and --ceiling belong to `supcoflow test` and `supcoflow reports investigate`.",
  },
  { flags: ["skill", "app", "shape"], comandos: ["install record"], texto: "--skill, --app and --shape belong to `supcoflow install record`." },
  { flags: ["agent"], comandos: DE_AGENTS, texto: "--agent belongs to `supcoflow agents show|set-key|check|remove|configure`." },
  { flags: ["provider"], comandos: ["agents set-key"], texto: "--provider belongs to `supcoflow agents set-key`." },
  { flags: ["fromEnv"], comandos: ["agents set-key", ...DE_GATE], texto: "--from-env belongs to `supcoflow agents set-key` and `supcoflow gate`." },
  { flags: ["filter", "page", "perPage"], comandos: ["reports list"], texto: "--filter, --page and --per-page belong to `supcoflow reports list`." },
  { flags: ["option", "dataRetention"], comandos: ["agents configure"], texto: "--option and --data-retention belong to `supcoflow agents configure`." },
];

/** `--file` se repite sólo en `install record` (la interfaz propia vive en varios archivos); en los demás va una vez. */
export function archivosDeMas(comando: string, cuantos: number): string | null {
  return cuantos > 1 && comando !== "install record" ? "--file goes once, with a value. Try `supcoflow --help`." : null;
}

/** El mensaje del primer flag presente que el comando no acepta, o null si todo aplica. */
export function flagQueNoAplica(comando: string, presentes: string[]): string | null {
  for (const regla of FLAGS_POR_COMANDO) {
    if (regla.flags.some((f) => presentes.includes(f)) && !regla.comandos.includes(comando)) return regla.texto;
  }
  return null;
}
