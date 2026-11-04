// La clave de IA del cliente entra a la terminal por dos caminos y SÓLO por dos: escrita sin eco en una terminal, o leída de una
// variable de entorno que la persona nombra con `--from-env NOMBRE`. Nunca como argumento (queda en el historial del shell, en la lista
// de procesos y, si la corre un asistente, en su contexto) ni por stdin (un pipe se confunde con "otra cosa" y no se puede ocultar).
//
// Este archivo es la parte PURA: qué hace cada tecla mientras se escribe sin eco, qué se acepta como clave y qué se acepta como
// nombre de variable. La terminal de verdad (modo raw, stdin) está en `entorno.ts`, que es lo único que toca el mundo.

/** El motor corta el cuerpo en 512 caracteres (`CuerpoSchema` de la ruta): más que eso no es una clave. */
export const TOPE_DE_LA_CLAVE = 512;

// ─── Lo que hace cada tecla ─────────────────────────────────────────────────────────────────────────────────────

export type EntradaOculta = { texto: string; fin: null | "listo" | "cancelado" };

// Secuencias de escape: una flecha (`ESC [ A`) o el marcado de «pegar» (`ESC [ 200 ~`). No son parte de la clave.
const SECUENCIA_CSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const ESCAPE_SUELTO = /\u001b[\s\S]?/g;

export const entradaOculta = {
  nueva: (): EntradaOculta => ({ texto: "", fin: null }),

  /** Procesa un trozo de lo que llegó del teclado. No escribe NADA en ningún lado: el eco es justo lo que no existe. */
  procesar(e: EntradaOculta, trozo: string): EntradaOculta {
    if (e.fin !== null) return e;
    let texto = e.texto;
    for (const c of trozo.replace(SECUENCIA_CSI, "").replace(ESCAPE_SUELTO, "")) {
      if (c === "\r" || c === "\n") return { texto, fin: "listo" };
      if (c === "\u0003") return { texto, fin: "cancelado" };
      if (c === "\u0004") {
        if (texto === "") return { texto, fin: "cancelado" };
        continue;
      }
      if (c === "\u007f" || c === "\b") {
        texto = texto.slice(0, -1);
        continue;
      }
      if (c < " " || (c >= "\u007f" && c <= "\u009f")) continue;
      // Un tope propio: una entrada interminable no crece sin límite. Uno de más para que `normalizarClave` la vea larga.
      if (texto.length <= TOPE_DE_LA_CLAVE) texto += c;
    }
    return { texto, fin: null };
  },
};

// ─── Qué se acepta como clave ──────────────────────────────────────────────────────────────────────────────────

export type ClaveNormalizada = { ok: true; clave: string } | { ok: false; motivo: "vacia" | "espacios" | "larga" | "corta" };

/** Ninguna clave de un proveedor mide menos. Con menos, taparla en un texto lo dejaría ilegible (una «e» suelta), y no es una clave. */
export const MINIMO_DE_LA_CLAVE = 8;

/**
 * Limpia las puntas (una variable de entorno suele traer un salto de línea) y revisa lo que no depende del proveedor: que haya
 * algo, que no sean dos cosas pegadas ni lleve caracteres de control, y que no pase del tope. NO decide si «tiene la forma» de la
 * clave de un proveedor: eso lo dice el motor (`clave_con_forma_invalida`), que sabe de cada uno.
 */
export function normalizarClave(crudo: string): ClaveNormalizada {
  const clave = crudo.trim();
  if (clave === "") return { ok: false, motivo: "vacia" };
  if (clave.length > TOPE_DE_LA_CLAVE) return { ok: false, motivo: "larga" };
  if (/[\s\u0000-\u001f\u007f-\u009f]/.test(clave)) return { ok: false, motivo: "espacios" };
  if (clave.length < MINIMO_DE_LA_CLAVE) return { ok: false, motivo: "corta" };
  return { ok: true, clave };
}

// ─── Qué se acepta como NOMBRE de variable ─────────────────────────────────────────────────────────────────────

// Prefijos de claves que conocemos. Minúsculas a propósito: una variable de entorno se escribe en mayúsculas.
const PREFIJOS_DE_CLAVES = /^(vck_|sk-|sk_|scf_|ghp_|gho_|github_pat_|xox[abp]-)/;

/** ¿Esto parece una clave (y no el nombre de una variable)? Sólo por el prefijo: no adivina el resto. */
export const pareceUnaClave = (s: string): boolean => PREFIJOS_DE_CLAVES.test(s);

const NOMBRE_DE_VARIABLE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/**
 * `--from-env` lleva el NOMBRE de una variable. Una clave pegada ahí por error (la persona entendió que iba la clave) tiene forma de
 * nombre —letras, números y guiones bajos—, y el mensaje de «esa variable no existe» la repetiría en la pantalla. Por eso, además de
 * la forma, se rechaza lo que parece una clave: por prefijo, o largo y con mayúsculas, minúsculas y dígitos mezclados (ningún
 * nombre de variable humano es así).
 */
export function nombreDeVariableValido(nombre: string): boolean {
  if (!NOMBRE_DE_VARIABLE.test(nombre)) return false;
  if (pareceUnaClave(nombre)) return false;
  if (nombre.length >= 24 && /[a-z]/.test(nombre) && /[A-Z]/.test(nombre) && /\d/.test(nombre)) return false;
  return true;
}
