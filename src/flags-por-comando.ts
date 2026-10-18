// Qué comandos aceptan cada flag que no es global. Un flag que no aplica sale 3 en vez de ignorarse:
// un asistente que pasa `--repo` a `quien-soy` creería que preguntó por ese repo. Vive aparte de
// `cli.ts` (que corre al importarse) para poder probarse sin lanzar el binario.
const DE_CONFIGURAR_CON_REPO = [
  "configuracion", "chat prender", "chat apagar", "chat marca", "chat logo", "sitios agregar", "sitios quitar",
  "datos fijar", "politica fijar", "claves crear", "claves listar", "claves revocar",
  "guia revisar", "guia publicar", "guia ver", "guia usar",
] as const;

export const FLAGS_POR_COMANDO: readonly { flags: readonly string[]; comandos: readonly string[]; texto: string }[] = [
  { flags: ["start", "wait"], comandos: ["login", "repo conectar"], texto: "--start y --wait son de `supcoflow login` y `supcoflow repo conectar`." },
  {
    flags: ["repo"], comandos: ["repo conectar", "proyecto crear", "proyecto ver", ...DE_CONFIGURAR_CON_REPO, "widget", "instalacion anotar"],
    texto: "--repo es de `supcoflow repo conectar`, `proyecto crear|ver`, `widget`, `instalacion anotar` y los comandos que configuran un proyecto (no de `catalogo`).",
  },
  { flags: ["install", "test"], comandos: ["proyecto crear"], texto: "--install y --test son de `supcoflow proyecto crear`." },
  { flags: ["sitio"], comandos: ["sitios agregar", "sitios quitar"], texto: "--sitio es de `supcoflow sitios agregar|quitar`." },
  { flags: ["titulo", "saludo", "tema"], comandos: ["chat marca"], texto: "--titulo, --saludo y --tema son de `supcoflow chat marca`." },
  { flags: ["archivo"], comandos: ["chat logo"], texto: "--archivo es de `supcoflow chat logo`." },
  { flags: ["permitir"], comandos: ["datos fijar"], texto: "--permitir es de `supcoflow datos fijar`." },
  { flags: ["modo"], comandos: ["politica fijar"], texto: "--modo es de `supcoflow politica fijar`." },
  { flags: ["nombre", "guardarEn"], comandos: ["claves crear"], texto: "--nombre y --guardar-en son de `supcoflow claves crear`." },
  { flags: ["origen"], comandos: ["guia usar"], texto: "--origen es de `supcoflow guia usar`." },
  { flags: ["desdeGithub"], comandos: ["guia publicar"], texto: "--desde-github es de `supcoflow guia publicar`." },
  { flags: ["id"], comandos: ["claves revocar"], texto: "--id es de `supcoflow claves revocar`." },
  { flags: ["skill", "app"], comandos: ["instalacion anotar"], texto: "--skill y --app son de `supcoflow instalacion anotar`." },
];

/** El mensaje del primer flag presente que el comando no acepta, o null si todo aplica. */
export function flagQueNoAplica(comando: string, presentes: string[]): string | null {
  for (const regla of FLAGS_POR_COMANDO) {
    if (regla.flags.some((f) => presentes.includes(f)) && !regla.comandos.includes(comando)) return regla.texto;
  }
  return null;
}
