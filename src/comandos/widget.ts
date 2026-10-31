// Lo que hay que pegar en la app para tener el chat (bloque 6). La terminal no escribe archivos de la app
// (decisión 5): muestra lo que el motor armó —él es dueño de los ids y de la versión— y el asistente lo
// pone donde corresponde. Nada se reescribe acá: el contenido sale tal cual llegó.
import type { InterfazPropia, Widget } from "../api.ts";
import type { Flags } from "../argumentos.ts";
import { resultadoDeFallo, SALIDA, type Resultado } from "../contrato.ts";
import { proyectoDelRepo, type DepsDelProyectoDelRepo } from "./proyecto-del-repo.ts";

export type DepsDeWidget = DepsDelProyectoDelRepo & {
  leerWidget(api: URL, clave: string, proyectoId: string): Promise<Widget>; // el `fetch` ya viene atado (como `configurar`)
};

// La forma «interfaz propia» (T8): sin código para pegar. La app arma el chat con sus propios componentes; esto es lo que
// hay que instalar y el contrato que la interfaz tiene que cumplir. Todo sale del motor, tal cual.
function textoDeLaInterfazPropia(p: InterfazPropia): string[] {
  return [
    "",
    "Own interface (build the chat with the app's own components, instead of steps 2 and 3; there is no code to paste):",
    "   Install the package (the exact version):",
    `   ${p.instalar}`,
    `   tenantId: ${p.tenant_id}`,
    `   projectId: ${p.project_id}`,
    `   backendUrl: ${p.backend_url}`,
    "   Content Security Policy (CSP): if the app has `connect-src`, add this origin and keep what it already has:",
    `   ${p.csp}`,
    `   Presentation contract: ${p.contrato_version}. The installed package carries it in node_modules/@supcoflow/chat/contract.json`,
    "   (and in docs/presentation-contract.md): read it from there, offline. What the interface must do is in the contract;",
    "   how it looks is the app's.",
  ];
}

function textoDe(w: Widget): string {
  const anteriores = w.nextjs.archivos_anteriores;
  return [
    "1. Install the package (with the app's package manager, the exact version):",
    `   ${w.instalar}`,
    "",
    `2. Create the file ${w.nextjs.archivo_sugerido} with this content (Next.js, ${w.nextjs.estado}):`,
    w.nextjs.contenido.trimEnd(),
    ...(anteriores.length > 0
      ? [`   If the chat is already installed in ${anteriores.join(" or ")}, update that file in place instead of creating a second one.`]
      : []),
    "",
    "3. Use it in the layout that covers the screens where users get stuck:",
    `   ${w.nextjs.uso}`,
    "",
    "4. Content Security Policy (CSP): if the app has `connect-src`, add this origin and keep what it already has:",
    `   ${w.csp}`,
    "",
    "Alternative with <script> (available, not tested in a real app):",
    `   ${w.script.linea}`,
    ...(w.interfaz_propia === undefined ? [] : textoDeLaInterfazPropia(w.interfaz_propia)),
  ].join("\n");
}

export async function widget(d: DepsDeWidget, flags: Pick<Flags, "repo">): Promise<Resultado> {
  const p = await proyectoDelRepo(d, flags);
  if (!p.ok) return p.resultado;
  try {
    const w = await d.leerWidget(d.api, p.clave, p.proyecto.id);
    return { codigo: SALIDA.ok, json: { ok: true, ...w }, texto: textoDe(w) };
  } catch (e) {
    return resultadoDeFallo(e);
  }
}
