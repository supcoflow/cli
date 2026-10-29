// ALARMA PARCIAL, no prueba de idioma. Un texto en castellano sin tildes ni «ñ» pasa este test. Lo que prueba el idioma
// son los valores exactos de los textos fijos (inventario) en el test de cada comando y los de `describe`; esto sólo
// avisa de la regresión más barata: un literal con `¿ ¡ ñ á é í ó ú` que alguien dejó en `src/`.
//
// Se miran los literales (cadenas y plantillas), NO los comentarios ni los alias (`src/alias.ts` es justamente el
// único lugar donde vive el castellano de los nombres viejos).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = new URL("../src/", import.meta.url).pathname;
const SIN_MIRAR = new Set(["alias.ts"]);
const CARACTERES = /[¿¡ñáéíóúÁÉÍÓÚÑ]/;

function archivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? archivos(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
}

/** Los literales de texto de un archivo, con su línea. El escáner de TypeScript salta los comentarios solo. */
export function literales(codigo: string): { linea: number; texto: string }[] {
  const scanner = ts.createScanner(ts.ScriptTarget.ES2023, true, ts.LanguageVariant.Standard, codigo);
  const salida: { linea: number; texto: string }[] = [];
  const lineaDe = (pos: number) => codigo.slice(0, pos).split("\n").length;
  // Una plantilla se escanea por partes: `}` dentro de `${…}` hay que volver a pedirla como continuación.
  const llaves: number[] = [];
  // Un `/` después de algo que cierra una expresión es una división; en cualquier otro lugar empieza una regex, que el
  // escáner solo no distingue: si no se vuelve a escanear, lo de adentro de la regex se lee como código (y como cadenas).
  const CIERRAN = new Set([ts.SyntaxKind.Identifier, ts.SyntaxKind.NumericLiteral, ts.SyntaxKind.StringLiteral, ts.SyntaxKind.RegularExpressionLiteral,
    ts.SyntaxKind.CloseParenToken, ts.SyntaxKind.CloseBracketToken, ts.SyntaxKind.CloseBraceToken, ts.SyntaxKind.ThisKeyword, ts.SyntaxKind.NoSubstitutionTemplateLiteral, ts.SyntaxKind.TemplateTail]);
  let previo: ts.SyntaxKind = ts.SyntaxKind.Unknown;
  for (let t = scanner.scan(); t !== ts.SyntaxKind.EndOfFileToken; previo = t, t = scanner.scan()) {
    if ((t === ts.SyntaxKind.SlashToken || t === ts.SyntaxKind.SlashEqualsToken) && !CIERRAN.has(previo)) {
      t = scanner.reScanSlashToken();
      continue;
    }
    if (t === ts.SyntaxKind.StringLiteral || t === ts.SyntaxKind.NoSubstitutionTemplateLiteral) {
      salida.push({ linea: lineaDe(scanner.getTokenStart()), texto: scanner.getTokenValue() });
    } else if (t === ts.SyntaxKind.TemplateHead) {
      salida.push({ linea: lineaDe(scanner.getTokenStart()), texto: scanner.getTokenValue() });
      llaves.push(1);
    } else if (t === ts.SyntaxKind.OpenBraceToken && llaves.length > 0) {
      llaves[llaves.length - 1]!++;
    } else if (t === ts.SyntaxKind.CloseBraceToken && llaves.length > 0) {
      if (--llaves[llaves.length - 1]! === 0) {
        const r = scanner.reScanTemplateToken(false);
        salida.push({ linea: lineaDe(scanner.getTokenStart()), texto: scanner.getTokenValue() });
        if (r === ts.SyntaxKind.TemplateTail) llaves.pop();
        else llaves[llaves.length - 1] = 1;
      }
    }
  }
  return salida;
}

describe("alarma: ningún literal de src/ lleva caracteres del castellano (fuera de los alias)", () => {
  it("el escáner ve los literales y no los comentarios", () => {
    const l = literales('// ñ en un comentario\nconst a = "año"; /* ¿otro? */ const b = `x ${1 + 1} ñu ${"y"} z`;\n');
    expect(l.map((x) => x.texto)).toEqual(["año", "x ", " ñu ", "y", " z"]);
    // Una regex con comillas adentro no abre una cadena, y una división no es una regex.
    expect(literales('const c = (s) => `"${s.replace(/["\\\\]/g, "x")}"`; // ñ\nconst d = a / 2 / b; const e = "ok";').map((x) => x.texto)).toEqual(['"', "x", '"', "ok"]);
    expect(l.filter((x) => CARACTERES.test(x.texto)).map((x) => x.texto)).toEqual(["año", " ñu "]);
  });

  it("src/ no tiene ninguno", () => {
    const malos: string[] = [];
    for (const f of archivos(SRC)) {
      if (SIN_MIRAR.has(relative(SRC, f))) continue;
      for (const l of literales(readFileSync(f, "utf8"))) {
        if (CARACTERES.test(l.texto)) malos.push(`${relative(SRC, f)}:${l.linea}  ${l.texto.slice(0, 80)}`);
      }
    }
    expect(malos).toEqual([]);
  });
});
