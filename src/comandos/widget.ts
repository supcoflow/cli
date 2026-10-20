// Lo que hay que pegar en la app para tener el chat (bloque 6). La terminal no escribe archivos de la app
// (decisión 5): muestra lo que el motor armó —él es dueño de los ids y de la versión— y el asistente lo
// pone donde corresponde. Nada se reescribe acá: el contenido sale tal cual llegó.
import type { Widget } from "../api.ts";
import type { Flags } from "../argumentos.ts";
import { resultadoDeFallo, SALIDA, type Resultado } from "../contrato.ts";
import { proyectoDelRepo, type DepsDelProyectoDelRepo } from "./proyecto-del-repo.ts";

export type DepsDeWidget = DepsDelProyectoDelRepo & {
  leerWidget(api: URL, clave: string, proyectoId: string): Promise<Widget>; // el `fetch` ya viene atado (como `configurar`)
};

function textoDe(w: Widget): string {
  return [
    "1. Instalá el paquete (con el gestor de la app, la versión exacta):",
    `   ${w.instalar}`,
    "",
    `2. Creá el archivo ${w.nextjs.archivo_sugerido} con este contenido (Next.js, ${w.nextjs.estado}):`,
    w.nextjs.contenido.trimEnd(),
    "",
    "3. Usalo en el layout que cubre las pantallas donde se traban los usuarios:",
    `   ${w.nextjs.uso}`,
    "",
    "4. Política de contenido (CSP): si la app tiene `connect-src`, agregale este origen conservando lo que ya tiene:",
    `   ${w.csp}`,
    "",
    "Alternativa con <script> (disponible, no probada en una app real):",
    `   ${w.script.linea}`,
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
