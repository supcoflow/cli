// test/claves.test.ts
import { describe, expect, it } from "vitest";
import { clavesCrear, clavesListar, clavesRevocar, type DepsDeClaves } from "../src/comandos/claves.ts";
import { FalloDeLaTerminal, SALIDA } from "../src/contrato.ts";

const CLAVE = `scf_${"a".repeat(16)}_${"b".repeat(64)}`;
const SECRETO_A = `scf_${"c".repeat(16)}_${"d".repeat(64)}`;
const SECRETO_B = `scf_${"c".repeat(16)}_${"e".repeat(64)}`;
const OTRA_FILA = `scf_${"f".repeat(16)}_${"0".repeat(64)}`;
const ID = "cla_cccccccccccccccc";
const DESTINO = "/home/u/ci.key";
const PROY = { id: "proj_r-1", slug: "r", repo: "d/r", rama: "main", installCommand: "npm ci", testCommand: "npm test" };
const idDe = (s: string) => `cla_${s.slice(4, 20)}`;

// Un mundo compartido: el motor falso (qué secreto autentica, cuántas filas creó), el archivo, el registro
// de idempotencia REAL en semántica (olvidar borra de verdad) y el candado. Dos `deps(mundo)` simulan dos
// procesos de la misma máquina.
function mundo() {
  return {
    vigentes: new Set<string>(),           // secretos que autentican
    personales: new Set<string>(),         // de ésos, los que son claves PERSONALES (autentican, pero no son de consulta)
    archivo: new Map<string, string>(),
    registro: new Map<string, string>(),  // op#alcance → idempotency key
    candado: false,
    filasCreadas: 0,
    siguienteKey: 0,
  };
}
type Mundo = ReturnType<typeof mundo>;

function deps(m: Mundo, respuestas: { status: number; cuerpo: Record<string, unknown> }[], o: Partial<DepsDeClaves> = {}) {
  const pedidos: { ruta: string; cuerpo: unknown; key?: string }[] = [];
  const d: DepsDeClaves = {
    api: new URL("http://localhost:3000"),
    guardado: { leerClaveCompleta: async () => ({ valor: { clave: CLAVE, fuente: "llavero" }, completa: true }) } as never,
    git: async (args) => (args[0] === "rev-parse" ? { codigo: 0, stdout: "/w/r\n" } : { codigo: 0, stdout: "git@github.com:d/r.git\n" }),
    cwd: "/w/r",
    buscarProyecto: async () => PROY,
    configurar: async (_a, _c, ruta, cuerpo, extra) => {
      pedidos.push({ ruta, cuerpo, key: extra?.idempotencyKey });
      const r = respuestas.shift()!;
      if (r.status === 201) m.filasCreadas++;
      if (ruta.endsWith("/confirmar") && r.status === 200) m.vigentes.add((cuerpo as { clave: string }).clave);
      return r;
    },
    listarClaves: async () => [],
    // El motor falso: las de `vigentes` son de consulta de PROY; `personales`, claves personales del equipo.
    esClaveDeConsultaDelProyecto: async (_a, clave, proyectoId) => m.vigentes.has(clave) && proyectoId === PROY.id && !m.personales.has(clave),
    idempotencia: {
      claveDe: async (op, al) => { const k = `${op}#${al}`; if (!m.registro.has(k)) m.registro.set(k, `k-${++m.siguienteKey}`); return m.registro.get(k)!; },
      tiene: async (op, al) => m.registro.has(`${op}#${al}`),
      olvidar: async (op, al) => { m.registro.delete(`${op}#${al}`); },
    },
    candados: { tomar: () => (m.candado ? { tipo: "ocupado" } : ((m.candado = true), { tipo: "tomado", soltar: () => { m.candado = false; } })) },
    secretos: {
      validarDestino: () => null,
      guardar: (ruta, id, s) => {
        const hay = m.archivo.get(ruta);
        if (hay !== undefined && idDe(hay) !== id) return { error: "tiene otra cosa", codigo: 4 };
        m.archivo.set(ruta, s);
        return "guardado";
      },
      leer: (ruta) => {
        const hay = m.archivo.get(ruta);
        if (hay === undefined) return { estado: "ausente" };
        return /^scf_[0-9a-f]{16}_[0-9a-f]{64}$/.test(hay) ? { estado: "clave", claveId: idDe(hay), secreto: hay } : { estado: "otra_cosa" };
      },
    },
    avisar: () => {},
    ...o,
  };
  return { d, pedidos };
}
const F = { repo: null, nombre: "ci", guardarEn: DESTINO, id: null, dryRun: false };
const CREADA_A = { status: 201, cuerpo: { clave_id: ID, clave: SECRETO_A, estado: "pendiente" } };
const CONFIRMADA = { status: 200, cuerpo: { clave_id: ID, estado: "activa" } };

describe("claves crear (§6.5)", () => {
  it("crea, guarda el secreto en el archivo, confirma, suelta el candado, y NUNCA lo saca por la salida", async () => {
    const m = mundo();
    const { d, pedidos } = deps(m, [CREADA_A, CONFIRMADA]);
    const r = await clavesCrear(d, F);
    expect(r).toMatchObject({ codigo: 0, json: { ok: true, clave_id: ID, archivo: DESTINO } });
    expect(JSON.stringify(r)).not.toContain(SECRETO_A);
    expect(m.archivo.get(DESTINO)).toBe(SECRETO_A);
    expect(pedidos.map((p) => p.ruta)).toEqual(["/api/proyectos/proj_r-1/claves", `/api/proyectos/proj_r-1/claves/${ID}/confirmar`]);
    expect(pedidos[1]!.cuerpo).toEqual({ clave: SECRETO_A });
    expect(m.registro.size).toBe(0);
    expect(m.candado).toBe(false);
  });
  it("R14 / hallazgo 2: repetir después del éxito (con olvidar de verdad) → 0 ya_confirmada, sin pedidos ni filas nuevas", async () => {
    const m = mundo();
    await clavesCrear(deps(m, [CREADA_A, CONFIRMADA]).d, F);
    const { d, pedidos } = deps(m, []);
    expect(await clavesCrear(d, F)).toMatchObject({ codigo: 0, json: { clave_id: ID, ya_confirmada: true } });
    expect(pedidos).toEqual([]);
    expect(m.filasCreadas).toBe(1);
    expect(m.archivo.get(DESTINO)).toBe(SECRETO_A);
  });
  it("después de revocar (el archivo ya no autentica, sin intento a medias) → 4 destino_ocupado, sin pedidos", async () => {
    const m = mundo();
    await clavesCrear(deps(m, [CREADA_A, CONFIRMADA]).d, F);
    m.vigentes.clear(); // revocada
    const { d, pedidos } = deps(m, []);
    const r = await clavesCrear(d, F);
    expect(r).toMatchObject({ codigo: 4, json: { error: "destino_ocupado" } });
    expect(r.texto).toMatch(/borrá el archivo|otro destino/);
    expect(pedidos).toEqual([]);
  });
  it("un archivo con otra cosa (no una clave) → 4 destino_ocupado, intacto y sin copiar su contenido", async () => {
    const m = mundo();
    m.archivo.set(DESTINO, "contenido-secreto-de-otro");
    const { d, pedidos } = deps(m, []);
    const r = await clavesCrear(d, F);
    expect(r).toMatchObject({ codigo: 4, json: { error: "destino_ocupado" } });
    expect(JSON.stringify(r)).not.toContain("contenido-secreto-de-otro");
    expect(m.archivo.get(DESTINO)).toBe("contenido-secreto-de-otro");
    expect(pedidos).toEqual([]);
  });
  it("tercera revisión, hallazgo 2: el destino tiene una clave PERSONAL válida → 4 destino_ocupado, cero pedidos, archivo intacto", async () => {
    const m = mundo();
    const PERSONAL = `scf_${"9".repeat(16)}_${"8".repeat(64)}`;
    m.vigentes.add(PERSONAL);
    m.personales.add(PERSONAL);
    m.archivo.set(DESTINO, PERSONAL);
    const { d, pedidos } = deps(m, []);
    const r = await clavesCrear(d, F);
    expect(r).toMatchObject({ codigo: 4, json: { error: "destino_ocupado" } });
    expect(JSON.stringify(r)).not.toContain(PERSONAL);
    expect(m.archivo.get(DESTINO)).toBe(PERSONAL);
    expect(pedidos).toEqual([]);
  });
  it("candado abandonado o no disponible: 1 con su error y la ruta, sin pedidos", async () => {
    for (const toma of [{ tipo: "abandonado", ruta: "/c/x.lock" }, { tipo: "no_disponible", ruta: "/c/x.lock" }] as const) {
      const m = mundo();
      const { d, pedidos } = deps(m, [], { candados: { tomar: () => toma } });
      const r = await clavesCrear(d, F);
      expect(r).toMatchObject({ codigo: 1, json: { error: toma.tipo === "abandonado" ? "candado_abandonado" : "candado_no_disponible" } });
      expect(r.texto).toContain("/c/x.lock");
      expect(pedidos).toEqual([]);
    }
  });
  it("recuperación: la respuesta de confirmar se perdió (intento a medias, archivo pendiente) → retoma con la MISMA key y la misma fila", async () => {
    const m = mundo();
    const caida = deps(m, [CREADA_A], {});
    // Primera corrida: crea y guarda; la confirmación «se pierde» (red).
    caida.d.configurar = async (_a, _c, ruta, cuerpo, extra) => {
      caida.pedidos.push({ ruta, cuerpo, key: extra?.idempotencyKey });
      if (ruta.endsWith("/confirmar")) throw new FalloDeLaTerminal(SALIDA.inesperado, "motor_inalcanzable", "red");
      m.filasCreadas++;
      return CREADA_A;
    };
    expect((await clavesCrear(caida.d, F)).codigo).toBe(1);
    expect(m.candado).toBe(false);
    const segunda = deps(m, [{ status: 201, cuerpo: { clave_id: ID, clave: SECRETO_B, estado: "pendiente" } }, CONFIRMADA]);
    expect((await clavesCrear(segunda.d, F)).codigo).toBe(0);
    expect(segunda.pedidos[0]!.key).toBe(caida.pedidos[0]!.key);
    expect(m.archivo.get(DESTINO)).toBe(SECRETO_B);
    expect(m.vigentes.has(SECRETO_B)).toBe(true);
  });
  it("hallazgo 1 (V1): dos corridas completas a la vez en esta máquina — la segunda sale 1 en_curso sin pedir nada, y la primera deja el archivo autenticando", async () => {
    const m = mundo();
    let soltarConsulta!: () => void;
    const pausa = new Promise<void>((r) => { soltarConsulta = r; });
    const a = deps(m, [CREADA_A, CONFIRMADA]);
    // A se queda adentro (con el candado tomado) en su primer pedido al motor.
    const configurarA = a.d.configurar;
    a.d.configurar = async (...args) => { await pausa; return configurarA(...args); };
    const corridaA = clavesCrear(a.d, F);
    while (!m.candado) await new Promise((r) => setTimeout(r, 0));
    // B corre ENTERO mientras A espera.
    const b = deps(m, [{ status: 201, cuerpo: { clave_id: ID, clave: SECRETO_B, estado: "pendiente" } }, CONFIRMADA]);
    const rb = await clavesCrear(b.d, F);
    expect(rb).toMatchObject({ codigo: 1, json: { error: "en_curso" } });
    expect(b.pedidos).toEqual([]);
    soltarConsulta();
    expect((await corridaA).codigo).toBe(0);
    expect(m.vigentes.has(m.archivo.get(DESTINO)!)).toBe(true);
  });
  it("ya activa pero el archivo de la recuperación no autentica → 4 archivo_desactualizado, nunca 0", async () => {
    const m = mundo();
    m.archivo.set(DESTINO, SECRETO_A);           // pendiente vieja
    m.registro.set("clave_crear#proj_r-1#ci", "k-9"); // intento a medias
    m.vigentes.add(SECRETO_B);                     // la vigente es otra generación
    const { d } = deps(m, [CONFIRMADA]);
    const r = await clavesCrear(d, F);
    expect(r).toMatchObject({ codigo: 4, json: { error: "archivo_desactualizado" } });
    expect(JSON.stringify(r)).not.toContain(SECRETO_A);
  });
  it("Review Focus 6: confirmación obsoleta → vuelve a pedir con la MISMA clave, guarda B y confirma con B", async () => {
    const m = mundo();
    const { d, pedidos } = deps(m, [
      CREADA_A,
      { status: 409, cuerpo: { error: "confirmacion_obsoleta", message: "…" } },
      { status: 201, cuerpo: { clave_id: ID, clave: SECRETO_B, estado: "pendiente" } },
      CONFIRMADA,
    ]);
    expect((await clavesCrear(d, F)).codigo).toBe(0);
    expect(m.archivo.get(DESTINO)).toBe(SECRETO_B);
    expect(pedidos[2]!.key).toBe(pedidos[0]!.key);
  });
  it("Review Focus 15: si el registro de idempotencia no se puede guardar, cero pedidos y el candado se suelta", async () => {
    const m = mundo();
    const { d, pedidos } = deps(m, [], {
      idempotencia: {
        claveDe: async () => { throw new FalloDeLaTerminal(SALIDA.inesperado, "idempotencia_no_guardada", "No pude guardar…"); },
        tiene: async () => false,
        olvidar: async () => {},
      },
    });
    expect(await clavesCrear(d, F)).toMatchObject({ codigo: 1, json: { error: "idempotencia_no_guardada" } });
    expect(pedidos).toEqual([]);
    expect(m.candado).toBe(false);
  });
  it("Review Focus 9: sin --guardar-en, 3 sin tomar el candado ni llamar al motor", async () => {
    const m = mundo();
    const { d, pedidos } = deps(m, []);
    expect(await clavesCrear(d, { ...F, guardarEn: null })).toMatchObject({ codigo: 3, json: { error: "falta_guardar_en" } });
    expect(pedidos).toEqual([]);
  });
  it("vencida: 1, olvida la clave de idempotencia para que el próximo intento cree otra", async () => {
    const m = mundo();
    const { d } = deps(m, [{ status: 409, cuerpo: { error: "clave_vencida", message: "…" } }]);
    expect((await clavesCrear(d, F)).codigo).toBe(1);
    expect(m.registro.size).toBe(0);
  });
});

describe("claves crear: arreglos de la revisión final", () => {
  it("el candado normaliza el nombre como la idempotencia: `CI` y `ci` toman el MISMO", async () => {
    const m = mundo();
    const nombres: string[] = [];
    const candados = { tomar: (n: string) => { nombres.push(n); return { tipo: "tomado" as const, soltar: () => {} }; } };
    await clavesCrear(deps(m, [CREADA_A, CONFIRMADA], { candados }).d, { ...F, nombre: "CI" });
    await clavesCrear(deps(m, [CREADA_A, CONFIRMADA], { candados }).d, { ...F, nombre: "ci", guardarEn: "/home/u/otra.key" });
    expect(nombres[0]).toBe(nombres[1]);
  });
  it("409 idempotency_key_reusada: la clave guardada se olvida (no queda trabada para siempre) y sale 3", async () => {
    const m = mundo();
    const { d } = deps(m, [{ status: 409, cuerpo: { error: "idempotency_key_reusada", message: "…" } }]);
    const r = await clavesCrear(d, F);
    expect(r.codigo).toBe(3);
    expect(m.registro.size).toBe(0);
  });
  it("clave_vencida: el mensaje dice que borre el archivo (que sigue con el secreto vencido) y no filtra nada", async () => {
    const m = mundo();
    m.archivo.set(DESTINO, SECRETO_A);
    m.registro.set("clave_crear#proj_r-1#ci", "k-0");
    const { d } = deps(m, [{ status: 409, cuerpo: { error: "clave_vencida", message: "…" } }]);
    const r = await clavesCrear(d, F);
    expect(r.codigo).toBe(1);
    expect(r.texto).toContain(DESTINO);
    expect(r.texto).toMatch(/Borrá/);
    expect(JSON.stringify(r)).not.toContain(SECRETO_A);
  });
  it("el clave_id del motor no es el del secreto: 1 respuesta_inesperada, sin guardar ni confirmar ni filtrar", async () => {
    const m = mundo();
    const { d, pedidos } = deps(m, [{ status: 201, cuerpo: { clave_id: "cla_ffffffffffffffff", clave: SECRETO_A, estado: "pendiente" } }]);
    const r = await clavesCrear(d, F);
    expect(r).toMatchObject({ codigo: 1, json: { error: "respuesta_inesperada" } });
    expect(m.archivo.has(DESTINO)).toBe(false);
    expect(pedidos).toHaveLength(1);
    expect(JSON.stringify(r)).not.toContain(SECRETO_A);
  });
  it("un destino que no sirve (dentro de un repo) se rechaza ANTES de pedir nada: cero POST, cero filas", async () => {
    const m = mundo();
    const { d, pedidos } = deps(m, [CREADA_A], { secretos: { ...deps(m, []).d.secretos, validarDestino: () => ({ error: "cae dentro del repo", codigo: 3 as const }) } });
    const r = await clavesCrear(d, F);
    expect(r).toMatchObject({ codigo: 3, json: { error: "destino_invalido" } });
    expect(pedidos).toEqual([]);
    expect(m.filasCreadas).toBe(0);
    expect(m.registro.size).toBe(0);
  });
});

describe("claves crear: el secreto no sale por ningún lado", () => {
  it("un rechazo del motor al confirmar con el secreto en el message: tapado, y tampoco en el texto", async () => {
    const m = mundo();
    const { d } = deps(m, [CREADA_A, { status: 404, cuerpo: { error: "clave_no_encontrada", message: `no encontré ${SECRETO_A}` } }]);
    const r = await clavesCrear(d, F);
    expect(r.codigo).toBe(3);
    expect(JSON.stringify(r)).not.toContain(SECRETO_A);
  });
  it("una guarda que no puede escribir: no confirma, y el error no lleva el secreto", async () => {
    const m = mundo();
    const { d, pedidos } = deps(m, [CREADA_A], { secretos: { validarDestino: () => null, leer: () => ({ estado: "ausente" }), guardar: () => ({ error: "cae dentro del repo", codigo: 3 }) } });
    const r = await clavesCrear(d, F);
    expect(r).toMatchObject({ codigo: 3, json: { error: "no_se_guardo" } });
    expect(pedidos.map((p) => p.ruta)).toEqual(["/api/proyectos/proj_r-1/claves"]);
    expect(JSON.stringify(r)).not.toContain(SECRETO_A);
    expect(m.candado).toBe(false);
  });
  it("carrera por el destino (otro nombre escribió primero): 4, no confirma, la pendiente queda para vencer sola", async () => {
    const m = mundo();
    const { d, pedidos } = deps(m, [CREADA_A], { secretos: { validarDestino: () => null, leer: () => ({ estado: "ausente" }), guardar: () => ({ error: "el archivo ya tiene otra cosa; borralo o elegí otro destino", codigo: 4 }) } });
    const r = await clavesCrear(d, F);
    expect(r).toMatchObject({ codigo: 4, json: { error: "no_se_guardo" } });
    expect(pedidos.map((p) => p.ruta)).toEqual(["/api/proyectos/proj_r-1/claves"]);
    expect(JSON.stringify(r)).not.toContain(SECRETO_A);
    expect(m.candado).toBe(false);
  });
  it("--dry-run: 0 sin tomar el candado ni pedir nada", async () => {
    const m = mundo();
    const { d, pedidos } = deps(m, []);
    expect(await clavesCrear(d, { ...F, dryRun: true })).toMatchObject({ codigo: 0, json: { dry_run: true } });
    expect(pedidos).toEqual([]);
    expect(m.candado).toBe(false);
  });
});

describe("claves listar y revocar", () => {
  it("listar: sólo id, nombre y fecha", async () => {
    const { d } = deps(mundo(), [], { listarClaves: async () => [{ id: ID, nombre: "ci", creadaEn: "2026-10-16T00:00:00Z" }] });
    expect(await clavesListar(d, { repo: null })).toEqual({
      codigo: 0, json: { ok: true, claves: [{ id: ID, nombre: "ci", creada_en: "2026-10-16T00:00:00Z" }] }, texto: expect.stringContaining(ID),
    });
  });
  it("revocar: manda {clave_id} a …/claves/revocar", async () => {
    const { d, pedidos } = deps(mundo(), [{ status: 200, cuerpo: { ok: true } }]);
    expect(await clavesRevocar(d, { repo: null, id: ID, dryRun: false })).toMatchObject({ codigo: 0, json: { ok: true, clave_id: ID } });
    expect(pedidos).toEqual([{ ruta: "/api/proyectos/proj_r-1/claves/revocar", cuerpo: { clave_id: ID }, key: undefined }]);
  });
  it("revocar una ya revocada: 0 «ya estaba revocada»", async () => {
    const { d } = deps(mundo(), [{ status: 409, cuerpo: { error: "ya_revocada", message: "…" } }]);
    const r = await clavesRevocar(d, { repo: null, id: ID, dryRun: false });
    expect(r).toMatchObject({ codigo: 0, json: { ya_revocada: true } });
    expect(r.texto).toContain("ya estaba revocada");
  });
  it("revocar sin --id o con un id mal formado: 3 sin llamar al motor", async () => {
    for (const id of [null, "cla_xyz", "scf_" + "a".repeat(16)]) {
      const { d, pedidos } = deps(mundo(), []);
      expect(await clavesRevocar(d, { repo: null, id, dryRun: false })).toMatchObject({ codigo: 3, json: { error: "id_invalido" } });
      expect(pedidos).toEqual([]);
    }
  });
  it("revocar una de otro proyecto: 3 con el error del motor", async () => {
    const { d } = deps(mundo(), [{ status: 404, cuerpo: { error: "clave_no_encontrada", message: "Esa clave no es de este proyecto." } }]);
    expect(await clavesRevocar(d, { repo: null, id: ID, dryRun: false })).toMatchObject({ codigo: 3, json: { error: "clave_no_encontrada" } });
  });
});
