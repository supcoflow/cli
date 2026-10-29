// El proyecto sobre el que actúan los comandos de configurar: el del repo de esta carpeta (o de --repo).
// Se busca en el motor por repo, como `proyecto ver`: el servidor es quien sabe qué proyectos alcanza la
// clave, y un `.supcoflow/proyecto.json` de un clon ajeno no puede elegir otro.
import type { Proyecto } from "../api.ts";
import { resultadoDeFallo, SALIDA, type Resultado } from "../contrato.ts";
import type { Guardado } from "../guardado/index.ts";
import { repoPedido, type Git } from "../repo-local.ts";
import { claveVigente } from "./clave-vigente.ts";

export type DepsDelProyectoDelRepo = {
  api: URL; guardado: Guardado; git: Git; cwd: string;
  buscarProyecto(api: URL, clave: string, repo: string): Promise<Proyecto | null>;
};

export async function proyectoDelRepo(
  d: DepsDelProyectoDelRepo, flags: { repo: string | null },
): Promise<{ ok: true; clave: string; proyecto: Proyecto } | { ok: false; resultado: Resultado }> {
  let repo: string;
  try {
    repo = (await repoPedido({ flagRepo: flags.repo, git: d.git, cwd: d.cwd })).repo;
  } catch (e) {
    return { ok: false, resultado: resultadoDeFallo(e) };
  }
  const leida = await claveVigente(d.guardado, d.api.origin);
  if (!leida.ok) return { ok: false, resultado: leida.resultado };
  try {
    const proyecto = await d.buscarProyecto(d.api, leida.vigente.clave, repo);
    if (proyecto === null) {
      const message = `The repo ${repo} doesn't have a project yet. Create the project: \`supcoflow project create\`.`;
      return { ok: false, resultado: { codigo: SALIDA.haceFaltaUnaPersona, json: { ok: false, error: "sin_proyecto", message, repo }, texto: message } };
    }
    return { ok: true, clave: leida.vigente.clave, proyecto };
  } catch (e) {
    return { ok: false, resultado: resultadoDeFallo(e) };
  }
}
