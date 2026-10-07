import assert from "node:assert/strict";
import { test } from "node:test";
import { compactPayload, normalizeSafraForEntradaCaminhao, parseNumberToApi } from "../server/entrada-cana.js";

test("payload de caminhao remove rowid nulo e normaliza data/numeros para ORDS", () => {
  const payload = compactPayload({
    rowid: null,
    pesagem: parseNumberToApi("001825"),
    guia: parseNumberToApi("053736"),
    caminhao: parseNumberToApi("131300"),
    talhao: parseNumberToApi("001"),
    etapa: parseNumberToApi("001"),
    data: "2026-09-02T00:00:00Z",
    intqueima: parseNumberToApi("124.83"),
    pesobruto: parseNumberToApi("43.46"),
    pesotara: parseNumberToApi("22.26"),
    pesoliquido: parseNumberToApi("21.2"),
    fazenda: "02.000678 - BOM SUCESSO 2",
    safra: normalizeSafraForEntradaCaminhao("Safra 26/27"),
    tipocolheita: "MANUAL",
  });

  assert.deepEqual(payload, {
    pesagem: 1825,
    guia: 53736,
    caminhao: 131300,
    talhao: 1,
    etapa: 1,
    data: "2026-09-02T00:00:00Z",
    intqueima: 124.83,
    pesobruto: 43.46,
    pesotara: 22.26,
    pesoliquido: 21.2,
    fazenda: "02.000678 - BOM SUCESSO 2",
    safra: "2026/2027",
    tipocolheita: "MANUAL",
  });
});
