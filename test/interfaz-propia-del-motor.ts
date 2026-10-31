// COPIA DECLARADA de lo que manda el motor en `interfaz_propia` de `GET /api/proyectos/{id}/widget`: la salida de
// `interfazPropiaJson` de `src/widget/instalacion.ts` de la rama `fm/ui-t8-motor` (punta 1458afa5), con tenantId "t_1" y
// projectId "proj_1". La forma real la define el motor (revisión 1 de la 0.9.0, P1-1): esta CLI se adapta a ella, y los tests
// de la CLI usan ESTA copia y no una forma inventada. Si el motor cambia la forma, se actualiza acá y el test de la CLI lo dice.
export type EstadoDeLaInterfaz = "sin_publicar" | "disponible";

export function interfazPropiaDelMotor(estado: EstadoDeLaInterfaz = "disponible", contrato = "1.1.0") {
  return {
    estado,
    paquete: "@supcoflow/chat",
    version: "2.4.0",
    instalar: "npm i @supcoflow/chat@2.4.0 --save-exact",
    tenant_id: "t_1",
    project_id: "proj_1",
    backend_url: "https://chat.supcoflow.dev",
    csp: "connect-src 'self' https://chat.supcoflow.dev;",
    opciones_del_nucleo: { tenantId: "t_1", projectId: "proj_1" },
    contrato: {
      version: contrato,
      archivo: "node_modules/@supcoflow/chat/contract.json",
      documento: "node_modules/@supcoflow/chat/docs/presentation-contract.md",
    },
    entradas: {
      nucleo: "@supcoflow/chat/core",
      react: "@supcoflow/chat/react",
      pruebas: "@supcoflow/chat/testing",
      servidor_de_pruebas: "@supcoflow/chat/testing/server",
    },
    documentos: {
      nucleo: "node_modules/@supcoflow/chat/docs/core.md",
      react: "node_modules/@supcoflow/chat/docs/react.md",
      pruebas: "node_modules/@supcoflow/chat/docs/testing.md",
      conformidad: "node_modules/@supcoflow/chat/docs/conformance.md",
      protocolo: "node_modules/@supcoflow/chat/docs/protocol-v1.md",
    },
  };
}
