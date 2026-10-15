// El contrato de salida de la terminal (§13). Quien la llama es, muchas veces, un asistente
// que lee el código de salida y la ÚLTIMA línea de stdout: por eso un resultado es siempre
// UNA línea de JSON, y un 5 no es un error sino «volvé a llamarme cuando la persona termine».

export const SALIDA = {
  ok: 0,
  inesperado: 1,
  faltaLogin: 2,
  entradaInvalida: 3,
  haceFaltaUnaPersona: 4,
  esperandoAUnaPersona: 5,
  topeAlcanzado: 6,
} as const;
export type CodigoDeSalida = (typeof SALIDA)[keyof typeof SALIDA];

export class FalloDeLaTerminal extends Error {
  constructor(
    readonly codigo: CodigoDeSalida,
    readonly error: string,
    message: string,
  ) {
    super(message);
    this.name = "FalloDeLaTerminal";
  }
}

export type Resultado = { codigo: CodigoDeSalida; json: Record<string, unknown>; texto: string };

// JSON.stringify escapa los saltos de línea de los valores, así que la salida cabe en una línea.
export function emitir(r: Resultado, modoJson: boolean, out: (s: string) => void): void {
  out(modoJson ? JSON.stringify(r.json) + "\n" : r.texto + "\n");
}

// Un mensaje de error de afuera (fetch, el sistema) podría traer la clave o el device_code
// tal cual; la clave se tapa ANTES que los 64 hex porque los contiene.
export function taparSecretos(s: string): string {
  return s.replace(/scf_[0-9a-f]{16}_[0-9a-f]{64}/g, "scf_…").replace(/\b[0-9a-f]{64}\b/g, "[device_code]");
}

export function resultadoDeFallo(e: unknown): Resultado {
  if (e instanceof FalloDeLaTerminal) {
    return { codigo: e.codigo, json: { ok: false, error: e.error, message: e.message }, texto: e.message };
  }
  const message = taparSecretos(e instanceof Error ? e.message : String(e));
  return { codigo: SALIDA.inesperado, json: { ok: false, error: "inesperado", message }, texto: message };
}
