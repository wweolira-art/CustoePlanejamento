import {
  gerarIndicadoresColheitaProducao,
  gerarIndicadoresColheitaProducaoFrota,
  gerarQualidadeColheitaIndicadores,
  gerarRelatorioDiarioProducao,
  gerarToneladasColheitaDiaria,
  gerarToneladasColheitaDiariaApi,
  gerarParadasColheita,
} from "./indicadores/colheita-producao.js";
import { loadPerdasColheitaAnalitico, type PerdasAnaliticoAgrupamento } from "./indicadores/colheita-perdas-analitico.js";
import type { Express, Request, Response } from "express";
import { db } from "./db.js";
import { gerarIndicadoresCombustivel } from "./indicadores/combustivel.js";
import { gerarControleEstoque } from "./indicadores/controle-estoque.js";
import { gerarControlePneus } from "./indicadores/pneus.js";
import {
  gerarDisponibilidadeEquipamentos,
  gerarDisponibilidadePorTipo,
} from "./indicadores/disponibilidade-equipamentos.js";
import { gerarIndicadoresMapaFazendas } from "./indicadores/mapa-fazendas.js";
import { gerarGestaoMateriais } from "./indicadores/gestao-materiais.js";
import { carregarOpcoesIrrigacao, gerarIndicadoresIrrigacao } from "./indicadores/irrigacao.js";
import { gerarIrrigacaoDashboard } from "./indicadores/irrigacao-dashboard.js";
import {
  gerarComponentesManutencaoProgramada,
  gerarQuadroManutencaoProgramada,
  listarPlanosPrevencao,
} from "./indicadores/manutencao-programada.js";
import { gerarConsumoOleoHidraulico } from "./indicadores/consumo-oleo-hidraulico.js";
import { gerarIndicadoresLubrificacao } from "./indicadores/lubrificacao.js";
import { gerarGestaoManutencao, gerarMonitoramentoOs, loadOsFalhaDetalhe, readGestaoManutencaoConfig, saveGestaoManutencaoConfig } from "./indicadores/gestao-manutencao.js";

const TRACKING_MODES = new Set(["padrao", "dias", "componentes", "plano_horas"]);

function queryStr(req: Request, key: string) {
  const v = req.query[key];
  return v != null && String(v).trim() !== "" ? String(v) : null;
}

function queryNumList(req: Request, ...keys: string[]) {
  const out: number[] = [];
  for (const key of keys) {
    const raw = req.query[key];
    const values = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
    for (const item of values) {
      for (const part of String(item).split(",")) {
        const n = Number(part.trim());
        if (Number.isFinite(n) && n > 0) out.push(n);
      }
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

function sendError(res: Response, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const status = (err as Error & { status?: number }).status ?? 500;
  res.status(status).json({ error: message });
}

const MANUTENCAO_CONFIG_KEY = "indicadores.manutencaoProgramada.config";

function readManutencaoConfig() {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(MANUTENCAO_CONFIG_KEY) as
    | { value: string }
    | undefined;
  if (!row?.value) {
    return {
      ignoredComponents: [] as string[],
      categoryTracking: {} as Record<string, string>,
      categoryPlanIds: {} as Record<string, number>,
      categoryPlanDependencias: {} as Record<string, number[]>,
    };
  }
  try {
    const parsed = JSON.parse(row.value) as {
      ignoredComponents?: unknown;
      categoryTracking?: unknown;
      categoryPlanIds?: unknown;
      categoryPlanDependencias?: unknown;
    };
    const categoryTracking =
      parsed.categoryTracking && typeof parsed.categoryTracking === "object" && !Array.isArray(parsed.categoryTracking)
        ? Object.fromEntries(
            Object.entries(parsed.categoryTracking as Record<string, unknown>)
              .filter(([, value]) => TRACKING_MODES.has(String(value)))
              .map(([key, value]) => [String(key), String(value)]),
          )
        : {};
    const categoryPlanIds =
      parsed.categoryPlanIds && typeof parsed.categoryPlanIds === "object" && !Array.isArray(parsed.categoryPlanIds)
        ? Object.fromEntries(
            Object.entries(parsed.categoryPlanIds as Record<string, unknown>)
              .map(([key, value]) => [String(key), Number(value)])
              .filter(([key, value]) => Boolean(String(key).trim()) && Number.isFinite(value) && value > 0),
          )
        : {};
    const categoryPlanDependencias =
      parsed.categoryPlanDependencias &&
      typeof parsed.categoryPlanDependencias === "object" &&
      !Array.isArray(parsed.categoryPlanDependencias)
        ? Object.fromEntries(
            Object.entries(parsed.categoryPlanDependencias as Record<string, unknown>)
              .map(([key, value]) => [
                String(key),
                Array.isArray(value)
                  ? [...new Set(value.map(Number).filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b)
                  : [],
              ])
              .filter(([key, value]) => Boolean(String(key).trim()) && value.length > 0),
          )
        : {};
    return {
      ignoredComponents: Array.isArray(parsed.ignoredComponents)
        ? parsed.ignoredComponents.map(String).filter(Boolean)
        : [],
      categoryTracking,
      categoryPlanIds,
      categoryPlanDependencias,
    };
  } catch {
    return {
      ignoredComponents: [] as string[],
      categoryTracking: {} as Record<string, string>,
      categoryPlanIds: {} as Record<string, number>,
      categoryPlanDependencias: {} as Record<string, number[]>,
    };
  }
}

function saveManutencaoConfig(config: {
  ignoredComponents: string[];
  categoryTracking?: Record<string, string>;
  categoryPlanIds?: Record<string, number>;
  categoryPlanDependencias?: Record<string, number[]>;
}) {
  const ignoredComponents = [...new Set(config.ignoredComponents.map(String).filter(Boolean))].sort();
  const categoryTracking = Object.fromEntries(
    Object.entries(config.categoryTracking ?? {}).filter(
      ([key, value]) => key.trim() && TRACKING_MODES.has(String(value)),
    ),
  );
  const categoryPlanIds = Object.fromEntries(
    Object.entries(config.categoryPlanIds ?? {})
      .map(([key, value]) => [String(key), Number(value)] as const)
      .filter(([key, value]) => key.trim() && Number.isFinite(value) && value > 0),
  );
  const categoryPlanDependencias = Object.fromEntries(
    Object.entries(config.categoryPlanDependencias ?? {})
      .map(([key, value]) => [
        String(key),
        [...new Set((Array.isArray(value) ? value : []).map(Number).filter((n) => Number.isFinite(n) && n > 0))].sort(
          (a, b) => a - b,
        ),
      ] as const)
      .filter(([key, value]) => key.trim() && value.length > 0),
  );
  const value = JSON.stringify({ ignoredComponents, categoryTracking, categoryPlanIds, categoryPlanDependencias });
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(MANUTENCAO_CONFIG_KEY, value);
  return { ignoredComponents, categoryTracking, categoryPlanIds, categoryPlanDependencias };
}

function planosPorCategoriaFromConfig(config: {
  categoryTracking: Record<string, string>;
  categoryPlanIds: Record<string, number>;
}) {
  return Object.fromEntries(
    Object.entries(config.categoryPlanIds).filter(([categoria]) => config.categoryTracking[categoria] === "plano_horas"),
  );
}

function dependenciasPorCategoriaFromConfig(config: {
  categoryTracking: Record<string, string>;
  categoryPlanIds: Record<string, number>;
  categoryPlanDependencias: Record<string, number[]>;
}) {
  return Object.fromEntries(
    Object.entries(config.categoryPlanDependencias)
      .filter(([categoria]) => config.categoryTracking[categoria] === "plano_horas" && config.categoryPlanIds[categoria] != null)
      .map(([categoria, deps]) => {
        const plano = config.categoryPlanIds[categoria]!;
        return [categoria, [...new Set([plano, ...deps])].sort((a, b) => a - b)];
      }),
  );
}

export function registerIndicadoresRoutes(app: Express) {
  app.get("/api/indicadores/pneus", async (_req, res) => {
    try { res.json(await gerarControlePneus()); }
    catch (e) { sendError(res, e); }
  });
  app.get("/api/indicadores/combustivel", async (req, res) => {
    try {
      res.json(
        await gerarIndicadoresCombustivel({
          dataInicio: queryStr(req, "dataInicio"),
          dataFim: queryStr(req, "dataFim"),
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/indicadores/colheita-producao/frota", async (req, res) => {
    try {
      res.json(
        await gerarIndicadoresColheitaProducaoFrota({
          refDate: queryStr(req, "refDate"),
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/indicadores/colheita-producao", async (req, res) => {
    try {
      res.json(
        await gerarIndicadoresColheitaProducao({
          dataInicio: queryStr(req, "dataInicio"),
          dataFim: queryStr(req, "dataFim"),
          refDate: queryStr(req, "refDate"),
          modo: queryStr(req, "modo") === "producao-total" ? "producao-total" : undefined,
          codTipoEquipamento: queryStr(req, "codTipoEquipamento")
            ? Number(queryStr(req, "codTipoEquipamento"))
            : undefined,
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/indicadores/paradas-colheita", async (req, res) => {
    try {
      const dataInicio = queryStr(req, "dataInicio");
      const dataFim = queryStr(req, "dataFim");
      if (!dataInicio || !dataFim) {
        res.status(400).json({ error: "Informe dataInicio e dataFim." });
        return;
      }
      res.json(await gerarParadasColheita(dataInicio, dataFim));
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/indicadores/colheita-perdas-analitico", async (req, res) => {
    try {
      const agrupamento = (queryStr(req, "agrupamento") || "tipoCorte") as PerdasAnaliticoAgrupamento;
      const codEquipamentos = queryNumList(req, "codEquipamento", "equipamento");
      res.json(
        await loadPerdasColheitaAnalitico({
          dataInicio: queryStr(req, "dataInicio"),
          dataFim: queryStr(req, "dataFim"),
          agrupamento,
          codEquipamentos: codEquipamentos.length ? codEquipamentos : undefined,
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/indicadores/colheita-qualidade", async (req, res) => {
    try {
      const codEquipamentos = queryNumList(req, "codEquipamento", "equipamento");
      res.json(
        await gerarQualidadeColheitaIndicadores({
          dataInicio: queryStr(req, "dataInicio"),
          dataFim: queryStr(req, "dataFim"),
          codEquipamentos: codEquipamentos.length ? codEquipamentos : undefined,
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/indicadores/colheita-diaria", async (req, res) => {
    try {
      const dataInicio = queryStr(req, "dataInicio");
      const dataFim = queryStr(req, "dataFim");
      if (!dataInicio || !dataFim) {
        res.status(400).json({ error: "Informe dataInicio e dataFim." });
        return;
      }
      const dados = queryStr(req, "fonte") === "colheitadiaria"
        ? await gerarToneladasColheitaDiariaApi(dataInicio, dataFim)
        : await gerarToneladasColheitaDiaria(dataInicio, dataFim);
      res.json({ dados });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/indicadores/relatorio-diario-producao", async (req, res) => {
    try {
      res.json(
        await gerarRelatorioDiarioProducao({
          data: queryStr(req, "data") || queryStr(req, "dataFim"),
          dataInicio: queryStr(req, "dataInicio"),
          safraInicio: queryStr(req, "safraInicio") || queryStr(req, "dataInicio"),
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/indicadores/disponibilidade-equipamentos", async (req, res) => {
    try {
      const codTipos = queryNumList(req, "codTipoEquipamento", "codTiposEquipamento", "codTipo");
      res.json(
        await gerarDisponibilidadeEquipamentos({
          safraCode: queryStr(req, "safraCode") || queryStr(req, "safra"),
          dataInicio: queryStr(req, "dataInicio"),
          dataFim: queryStr(req, "dataFim"),
          codTiposEquipamento: codTipos.length ? codTipos : undefined,
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/indicadores/disponibilidade-por-tipo", async (req, res) => {
    try {
      res.json(
        await gerarDisponibilidadePorTipo({
          safraCode: queryStr(req, "safraCode") || queryStr(req, "safra"),
          dataInicio: queryStr(req, "dataInicio"),
          dataFim: queryStr(req, "dataFim"),
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/indicadores/controle-estoque", async (req, res) => {
    try {
      const almox = queryStr(req, "almoxarifado") || queryStr(req, "almox");
      res.json(
        await gerarControleEstoque({
          anomes: queryStr(req, "anomes"),
          busca: queryStr(req, "busca"),
          almoxarifado: almox,
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/indicadores/mapa-fazendas", async (req, res) => {
    try {
      const entomologicoIndiceRaw = queryStr(req, "entomologicoIndice");
      res.json(
        await gerarIndicadoresMapaFazendas({
          safraCode: queryStr(req, "safraCode") || queryStr(req, "safra"),
          dataInicio: queryStr(req, "dataInicio"),
          dataFim: queryStr(req, "dataFim"),
          areasAplicadas: req.query.areasAplicadas === "1" || req.query.areasAplicadas === "true",
          entomologico: req.query.entomologico === "1" || req.query.entomologico === "true",
          irrigacao: req.query.irrigacao === "1" || req.query.irrigacao === "true",
          entomologicoIndice:
            entomologicoIndiceRaw === "broca_gigante" ? "broca_gigante" : "broca_comum",
          operacao: queryStr(req, "operacao"),
          operacaoDescricao: queryStr(req, "operacaoDescricao"),
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/indicadores/irrigacao/opcoes", async (_req, res) => {
    try {
      res.json(await carregarOpcoesIrrigacao());
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/indicadores/irrigacao", async (req, res) => {
    try {
      res.json(
        await gerarIndicadoresIrrigacao({
          dataInicio: queryStr(req, "dataInicio"),
          dataFim: queryStr(req, "dataFim"),
          codEquipamento: queryStr(req, "codEquipamento") || queryStr(req, "equipamento"),
          codFazenda: queryStr(req, "codFazenda") || queryStr(req, "fazenda"),
          campo: queryStr(req, "campo"),
          tipoEquipamento: queryStr(req, "tipoEquipamento") || queryStr(req, "tipo"),
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/indicadores/irrigacao/dashboard", async (req, res) => {
    try {
      const sistemasRaw = req.query.sistema ?? req.query.sistemas;
      const sistemas = Array.isArray(sistemasRaw)
        ? sistemasRaw.map(String)
        : typeof sistemasRaw === "string" && sistemasRaw
          ? sistemasRaw.split(",").map((s) => s.trim()).filter(Boolean)
          : [];
      res.json(
        await gerarIrrigacaoDashboard({
          safraCode: queryStr(req, "safraCode") || queryStr(req, "safra"),
          dataInicio: queryStr(req, "dataInicio"),
          dataFim: queryStr(req, "dataFim"),
          sistemas,
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/indicadores/gestao-materiais", async (req, res) => {
    try {
      const tiposRaw = req.query.tipo ?? req.query.tipos;
      const tipos = Array.isArray(tiposRaw)
        ? tiposRaw.map(String)
        : tiposRaw != null
          ? [String(tiposRaw)]
          : undefined;
      res.json(
        await gerarGestaoMateriais({
          dataInicio: queryStr(req, "dataInicio"),
          dataFim: queryStr(req, "dataFim"),
          tipos,
          almoxarifado: queryStr(req, "almoxarifado") || queryStr(req, "almox"),
          codMaterial: queryStr(req, "codMaterial") || queryStr(req, "material"),
          codObjetoCusto: queryStr(req, "codObjetoCusto") || queryStr(req, "objetoCusto"),
          mesesEstoque: queryStr(req, "mesesEstoque"),
          mesesSugerida: queryStr(req, "mesesSugerida"),
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/indicadores/manutencao-programada", async (_req, res) => {
    try {
      const config = readManutencaoConfig();
      res.json(
        await gerarQuadroManutencaoProgramada({
          planosPorCategoria: planosPorCategoriaFromConfig(config),
          dependenciasPorCategoria: dependenciasPorCategoriaFromConfig(config),
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/indicadores/manutencao-programada/config", (_req, res) => {
    try {
      res.json(readManutencaoConfig());
    } catch (e) {
      sendError(res, e);
    }
  });

  app.put("/api/indicadores/manutencao-programada/config", (req, res) => {
    try {
      const ignoredComponents = Array.isArray(req.body?.ignoredComponents)
        ? req.body.ignoredComponents.map(String)
        : [];
      const categoryTracking =
        req.body?.categoryTracking && typeof req.body.categoryTracking === "object" && !Array.isArray(req.body.categoryTracking)
          ? req.body.categoryTracking as Record<string, string>
          : {};
      const categoryPlanIds =
        req.body?.categoryPlanIds && typeof req.body.categoryPlanIds === "object" && !Array.isArray(req.body.categoryPlanIds)
          ? Object.fromEntries(
              Object.entries(req.body.categoryPlanIds as Record<string, unknown>).map(([key, value]) => [
                key,
                Number(value),
              ]),
            )
          : {};
      const categoryPlanDependencias =
        req.body?.categoryPlanDependencias &&
        typeof req.body.categoryPlanDependencias === "object" &&
        !Array.isArray(req.body.categoryPlanDependencias)
          ? (req.body.categoryPlanDependencias as Record<string, number[]>)
          : {};
      res.json(saveManutencaoConfig({ ignoredComponents, categoryTracking, categoryPlanIds, categoryPlanDependencias }));
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/indicadores/manutencao-programada/planos", async (_req, res) => {
    try {
      res.json({ planos: await listarPlanosPrevencao() });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/indicadores/colheita-oleo-hidraulico", async (req, res) => {
    try {
      res.json(
        await gerarConsumoOleoHidraulico({
          dataInicio: queryStr(req, "dataInicio"),
          dataFim: queryStr(req, "dataFim"),
          safraCode: queryStr(req, "safraCode"),
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/indicadores/lubrificacao", async (req, res) => {
    try {
      const rawEquip = queryStr(req, "codEquipamento") || queryStr(req, "equipamento");
      const rawAno = queryStr(req, "ano");
      const rawMes = queryStr(req, "mes");
      res.json(
        await gerarIndicadoresLubrificacao({
          codEquipamento:
            rawEquip != null && rawEquip !== "" && Number.isFinite(Number(rawEquip)) ? Number(rawEquip) : null,
          ano: rawAno != null && rawAno !== "" && Number.isFinite(Number(rawAno)) ? Number(rawAno) : null,
          mes: rawMes != null && rawMes !== "" && Number.isFinite(Number(rawMes)) ? Number(rawMes) : null,
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/indicadores/gestao-manutencao", async (req, res) => {
    try {
      const rawAno = queryStr(req, "ano");
      const rawEquip = queryStr(req, "codEquipamento") || queryStr(req, "equipamento");
      const rawTipo = queryStr(req, "codTipoEquipamento") || queryStr(req, "codTipo");
      res.json(
        await gerarGestaoManutencao({
          ano: rawAno != null && Number.isFinite(Number(rawAno)) ? Number(rawAno) : null,
          dataInicio: queryStr(req, "dataInicio"),
          dataFim: queryStr(req, "dataFim"),
          categoria: queryStr(req, "categoria"),
          codTipoEquipamento:
            rawTipo != null && rawTipo !== "" && Number.isFinite(Number(rawTipo)) ? Number(rawTipo) : null,
          codEquipamento:
            rawEquip != null && rawEquip !== "" && Number.isFinite(Number(rawEquip)) ? Number(rawEquip) : null,
          tipoMaterial: queryStr(req, "tipoMaterial"),
          codObjetoCusto:
            queryStr(req, "codObjetoCusto") != null && Number.isFinite(Number(queryStr(req, "codObjetoCusto")))
              ? Number(queryStr(req, "codObjetoCusto"))
              : null,
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/indicadores/gestao-manutencao/os", async (req, res) => {
    try {
      const anoOs = Number(queryStr(req, "ano") ?? queryStr(req, "anoOs"));
      const numeroOs = Number(
        queryStr(req, "numero") ?? queryStr(req, "numeroOs") ?? queryStr(req, "os"),
      );
      res.json(await loadOsFalhaDetalhe(anoOs, numeroOs));
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/indicadores/gestao-manutencao/monitoramento-os", async (req, res) => {
    try {
      const rawBox = queryStr(req, "box");
      const rawEquip = queryStr(req, "codEquipamento") || queryStr(req, "equipamento");
      const rawTipo = queryStr(req, "codTipoEquipamento") || queryStr(req, "codTipo");
      res.json(
        await gerarMonitoramentoOs({
          box: rawBox != null && Number.isFinite(Number(rawBox)) ? Number(rawBox) : null,
          codTipoEquipamento:
            rawTipo != null && rawTipo !== "" && Number.isFinite(Number(rawTipo)) ? Number(rawTipo) : null,
          codEquipamento:
            rawEquip != null && rawEquip !== "" && Number.isFinite(Number(rawEquip)) ? Number(rawEquip) : null,
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/indicadores/gestao-manutencao/config", (_req, res) => {
    try {
      res.json(readGestaoManutencaoConfig());
    } catch (e) {
      sendError(res, e);
    }
  });

  app.put("/api/indicadores/gestao-manutencao/config", (req, res) => {
    try {
      res.json(
        saveGestaoManutencaoConfig({
          metaMttrHoras: req.body?.metaMttrHoras,
          metaMtbfHoras: req.body?.metaMtbfHoras,
          metaDisponibilidade: req.body?.metaDisponibilidade,
          metasPorTipo: req.body?.metasPorTipo,
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/indicadores/manutencao-programada/componentes", async (req, res) => {
    try {
      const raw = queryStr(req, "codEquipamento");
      const codEquipamento = raw != null && raw !== "" ? Number(raw) : null;
      res.json(
        await gerarComponentesManutencaoProgramada(
          codEquipamento != null && Number.isFinite(codEquipamento) ? codEquipamento : null,
        ),
      );
    } catch (e) {
      sendError(res, e);
    }
  });
}
