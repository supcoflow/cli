// Qué comandos aceptan cada flag que no es global. Un flag que no aplica sale 3 en vez de ignorarse:
// un asistente que pasa `--repo` a `whoami` creería que preguntó por ese repo. Vive aparte de
// `cli.ts` (que corre al importarse) para poder probarse sin lanzar el binario. Los nombres de los
// campos son los de `Flags`; los textos nombran los flags y comandos canónicos.
const DE_CONFIGURAR_CON_REPO = [
  "config", "chat on", "chat off", "chat brand", "chat logo", "sites add", "sites remove",
  "data set", "policy set", "keys create", "keys list", "keys revoke",
  "guide check", "guide publish", "guide show", "guide use", "guide versions",
] as const;

export const FLAGS_POR_COMANDO: readonly { flags: readonly string[]; comandos: readonly string[]; texto: string }[] = [
  { flags: ["start"], comandos: ["login", "repo connect"], texto: "--start belongs to `supcoflow login` and `supcoflow repo connect`." },
  { flags: ["wait"], comandos: ["login", "repo connect", "test"], texto: "--wait belongs to `supcoflow login`, `supcoflow repo connect` and `supcoflow test`." },
  {
    flags: ["repo"], comandos: ["repo connect", "project create", "project show", ...DE_CONFIGURAR_CON_REPO, "widget", "install record", "diagnose", "test"],
    texto: "--repo belongs to `supcoflow repo connect`, `project create|show`, `widget`, `install record`, `diagnose`, `test` and the commands that configure a project (not to `catalog`).",
  },
  { flags: ["install", "test"], comandos: ["project create"], texto: "--install and --test belong to `supcoflow project create`." },
  { flags: ["site"], comandos: ["sites add", "sites remove"], texto: "--site belongs to `supcoflow sites add|remove`." },
  { flags: ["title", "greeting", "theme"], comandos: ["chat brand"], texto: "--title, --greeting and --theme belong to `supcoflow chat brand`." },
  { flags: ["file"], comandos: ["chat logo", "install record"], texto: "--file belongs to `supcoflow chat logo` and `supcoflow install record`." },
  { flags: ["allow"], comandos: ["data set"], texto: "--allow belongs to `supcoflow data set`." },
  { flags: ["mode"], comandos: ["policy set"], texto: "--mode belongs to `supcoflow policy set`." },
  { flags: ["name", "saveTo"], comandos: ["keys create"], texto: "--name and --save-to belong to `supcoflow keys create`." },
  { flags: ["source"], comandos: ["guide use"], texto: "--source belongs to `supcoflow guide use`." },
  { flags: ["fromGithub"], comandos: ["guide publish"], texto: "--from-github belongs to `supcoflow guide publish`." },
  { flags: ["id"], comandos: ["keys revoke"], texto: "--id belongs to `supcoflow keys revoke`." },
  {
    flags: ["authorizeSpend", "ceiling", "expectPolicy", "message", "testId"], comandos: ["test"],
    texto: "--authorize-spend, --ceiling, --expect-policy, --message and --test-id belong to `supcoflow test`.",
  },
  { flags: ["skill", "app", "shape"], comandos: ["install record"], texto: "--skill, --app and --shape belong to `supcoflow install record`." },
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
