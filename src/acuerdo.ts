// Un proyecto sin acuerdo de datos rige CERRADO (etapa 1a). El motor responde ese acuerdo cerrado explícito
// con `acuerdo_fijado: false` («nadie lo fijó todavía»); un motor anterior respondía `acuerdo: null`. Los dos
// son lo mismo para la terminal: ninguno es «entra todo». Un acuerdo ilegible es otro estado (también rige
// cerrado, pero hay una fila que no se pudo leer) y no pasa por acá.
export function acuerdoSinFijar(c: { acuerdo?: unknown; acuerdo_fijado?: unknown }): boolean {
  return c.acuerdo !== undefined && (c.acuerdo === null || c.acuerdo_fijado === false);
}
