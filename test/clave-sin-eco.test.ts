// La entrada de la clave de IA: sin eco por terminal, o desde una variable de entorno que la persona nombra. Acá se prueba la
// parte pura (qué hace cada tecla, qué se acepta como clave, qué se acepta como nombre de variable); el comando entero, con el
// motor falso, está en agentes.test.ts, y el binario compilado en agentes-binario.test.ts.
import { describe, expect, it } from "vitest";
import { entradaOculta, nombreDeVariableValido, normalizarClave, pareceUnaClave, TOPE_DE_LA_CLAVE } from "../src/clave-sin-eco.ts";
import { taparSecretos } from "../src/contrato.ts";

const CLAVE = "vck_9f8e7d6c5b4a39281706f5e4d3c2b1a0ZyXwVu";

describe("entradaOculta: lo que hace cada tecla mientras se escribe sin eco", () => {
  const escribir = (...trozos: string[]) => {
    let e = entradaOculta.nueva();
    for (const t of trozos) e = entradaOculta.procesar(e, t);
    return e;
  };

  it("junta lo que llega, de a un trozo o pegado entero, y termina con Enter", () => {
    expect(escribir("vck_", "abc", "\r")).toMatchObject({ fin: "listo", texto: "vck_abc" });
    expect(escribir("vck_abc\n")).toMatchObject({ fin: "listo", texto: "vck_abc" });
    expect(escribir("vck_abc\r\n")).toMatchObject({ fin: "listo", texto: "vck_abc" });
  });
  it("sin Enter todavía no terminó", () => {
    expect(escribir("vck_abc")).toMatchObject({ fin: null, texto: "vck_abc" });
  });
  it("Ctrl-C cancela, y Ctrl-D también si no hay nada escrito; con algo escrito, Ctrl-D no hace nada", () => {
    expect(escribir("vck", "\u0003")).toMatchObject({ fin: "cancelado" });
    expect(escribir("\u0004")).toMatchObject({ fin: "cancelado" });
    expect(escribir("ab", "\u0004")).toMatchObject({ fin: null, texto: "ab" });
  });
  it("retroceso borra el último carácter, y no pasa de cero", () => {
    expect(escribir("abc", "\u007f", "\u007f", "\r")).toMatchObject({ texto: "a" });
    expect(escribir("a", "\b", "\b", "\b", "\r")).toMatchObject({ texto: "" });
  });
  it("las secuencias de escape (flechas, el marcado de «pegar») no entran a la clave", () => {
    expect(escribir("\u001b[200~vck_abc\u001b[201~\r")).toMatchObject({ fin: "listo", texto: "vck_abc" });
    expect(escribir("vck", "\u001b[A", "_x", "\r")).toMatchObject({ texto: "vck_x" });
  });
  it("los demás caracteres de control no entran", () => {
    expect(escribir("a\u0000b\u0007c\t\r")).toMatchObject({ texto: "abc" });
  });
  it("después de terminar ya no acepta nada", () => {
    const e = escribir("abc\r");
    expect(entradaOculta.procesar(e, "xyz")).toEqual(e);
  });
  it("tiene un tope: una entrada interminable no crece sin límite", () => {
    const e = escribir("x".repeat(TOPE_DE_LA_CLAVE * 10));
    expect(e.texto.length).toBeLessThanOrEqual(TOPE_DE_LA_CLAVE + 1);
  });
  it("lo que se escribe nunca vuelve en un «eco»: el estado no tiene nada para imprimir", () => {
    // El proceso no escribe nada mientras se tipea: no hay función de eco que probar, y el estado es sólo texto y fin.
    expect(Object.keys(escribir("abc")).sort()).toEqual(["fin", "texto"]);
  });
});

describe("normalizarClave: qué se acepta como clave antes de mandarla", () => {
  it("quita los espacios y saltos de línea de las puntas (una variable de entorno suele traer un salto)", () => {
    expect(normalizarClave(`  ${CLAVE}\n`)).toEqual({ ok: true, clave: CLAVE });
  });
  it("vacía → vacia", () => {
    expect(normalizarClave("")).toEqual({ ok: false, motivo: "vacia" });
    expect(normalizarClave("  \n ")).toEqual({ ok: false, motivo: "vacia" });
  });
  it("con un espacio, un salto o un tabulador adentro → espacios (se pegaron dos cosas, o una frase)", () => {
    expect(normalizarClave("vck_a b")).toEqual({ ok: false, motivo: "espacios" });
    expect(normalizarClave("vck_a\nvck_b")).toEqual({ ok: false, motivo: "espacios" });
    expect(normalizarClave("vck_a\tb")).toEqual({ ok: false, motivo: "espacios" });
  });
  it("con caracteres de control adentro → espacios", () => {
    expect(normalizarClave("vck_a\u0000b")).toEqual({ ok: false, motivo: "espacios" });
    expect(normalizarClave("vck_a\u001b[31mb")).toEqual({ ok: false, motivo: "espacios" });
  });
  it(`más larga que ${TOPE_DE_LA_CLAVE} → larga (el motor corta en 512)`, () => {
    expect(normalizarClave("k".repeat(TOPE_DE_LA_CLAVE))).toMatchObject({ ok: true });
    expect(normalizarClave("k".repeat(TOPE_DE_LA_CLAVE + 1))).toEqual({ ok: false, motivo: "larga" });
  });
  it("NO decide si tiene «la forma» de un proveedor: eso lo dice el motor (cambia de proveedor a proveedor)", () => {
    expect(normalizarClave("cualquier-cosa-sin-espacios")).toMatchObject({ ok: true });
  });
});

describe("nombreDeVariableValido: --from-env lleva el NOMBRE de una variable, nunca la clave", () => {
  it("acepta nombres de variable de entorno de verdad", () => {
    for (const n of ["AI_GATEWAY_API_KEY", "SUPCOFLOW_CHAT_KEY", "_x", "key1", "A"]) expect(nombreDeVariableValido(n), n).toBe(true);
  });
  it("rechaza lo que no es un nombre", () => {
    for (const n of ["", "con espacio", "a=b", "a-b", "1ABC", "a".repeat(65), "$KEY", "${KEY}", "../x"]) expect(nombreDeVariableValido(n), n).toBe(false);
  });
  it("rechaza un valor que parece una clave aunque tenga forma de nombre (alguien pegó la clave donde va el nombre)", () => {
    expect(nombreDeVariableValido(CLAVE)).toBe(false);
    expect(nombreDeVariableValido("vck_abc")).toBe(false);
    expect(nombreDeVariableValido("sk_live_x")).toBe(false);
    expect(nombreDeVariableValido("scf_x")).toBe(false);
    expect(nombreDeVariableValido("sk-or-v1-abc")).toBe(false);
    // Mezcla de mayúsculas, minúsculas y dígitos, larga: no es un nombre humano.
    expect(nombreDeVariableValido("Ab3dEf6hIj9lMn2pQr5tUv8xYz")).toBe(false);
  });
});

describe("pareceUnaClave", () => {
  it("reconoce los prefijos de claves que conocemos", () => {
    for (const k of [CLAVE, "vck_abc", "sk-or-v1-abc", "sk-ant-x", "scf_" + "a".repeat(16) + "_" + "b".repeat(64)]) expect(pareceUnaClave(k), k).toBe(true);
  });
  it("no confunde un nombre de variable con una clave", () => {
    for (const n of ["AI_GATEWAY_API_KEY", "MY_KEY", "token"]) expect(pareceUnaClave(n), n).toBe(false);
  });
});

describe("taparSecretos: las claves de IA también se tapan en cualquier mensaje", () => {
  it("tapa una clave del Gateway y una de OpenRouter, en el medio de una frase", () => {
    const t = taparSecretos(`el motor dijo ${CLAVE} y también sk-or-v1-0123456789abcdefABCDEF.`);
    expect(t).not.toContain("9f8e7d6c");
    expect(t).not.toContain("0123456789abcdef");
    expect(t).toContain("vck_…");
  });
  it("sigue tapando lo de siempre", () => {
    expect(taparSecretos(`scf_${"a".repeat(16)}_${"b".repeat(64)}`)).toBe("scf_…");
  });
});
