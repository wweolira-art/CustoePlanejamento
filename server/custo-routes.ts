import type { Express, Request, Response } from "express";
import { parseFiltros } from "./custo/utils/filtros.js";
import { consultarDashboard } from "./custo/services/dashboardService.js";
import { consultarFuncionarios } from "./custo/services/funcionarioService.js";
import { consultarAbastecimentos } from "./custo/services/abastecimentoService.js";
import { consultarInsumos } from "./custo/services/insumoService.js";
import {
  consultarMateriais,
  consultarDiagnosticoFluxoMaterial,
} from "./custo/services/materialService.js";
import { consultarServicosTerceiro } from "./custo/services/servicoTerceiroService.js";
import {
  consultarRateio,
  consultarResumoPorEquipamento,
  consultarReconciliacaoOficina,
} from "./custo/services/rateioService.js";
import {
  consultarReconciliacaoTransporte,
  consultarDiagnosticoFluxoTransporte,
} from "./custo/services/transporteRateioService.js";
import {
  consultarReconciliacaoMecanizacao,
  consultarDiagnosticoFluxoMecanizacao,
} from "./custo/services/mecanizacaoRateioService.js";
import {
  consultarDiagnosticoFluxoOficina,
} from "./custo/services/rateioAtividadeService.js";
import { consultarRateioDistribuicao } from "./custo/services/distribuicaoGastoRateioService.js";
import { consultarMatrizSubprocesso } from "./custo/services/rateioMatrizSubprocessoService.js";
import { consultarDiagnosticoDistribuicao } from "./custo/services/diagnosticoDistribuicaoService.js";
import {
  listarDimensoesObjetoCusto,
  listarObjetosCusto,
} from "./custo/services/objetoCustoService.js";
import { anomesRangeForSafra } from "./externo-orcamento.js";

function exigirPeriodo(filtros: { anomesInicio?: string | null; anomesFim?: string | null }) {
  if (!filtros.anomesInicio && !filtros.anomesFim) {
    const error = new Error(
      "Informe anomesInicio e/ou anomesFim (YYYYMM). O relatório de custo exige período.",
    ) as Error & { status?: number };
    error.status = 400;
    throw error;
  }
}

function parseNegociosQuery(query: Request["query"]) {
  const raw = query.negocio ?? query.negocios;
  if (raw == null) return null;
  const parts = Array.isArray(raw) ? raw : String(raw).split(/[,;]/);
  const nums = parts
    .map((part) => Number(String(part).trim()))
    .filter((n) => Number.isFinite(n));
  return nums.length ? [...new Set(nums)] : null;
}

function mergeSafraPeriod(filtros: ReturnType<typeof parseFiltros>) {
  if (!filtros.safraId) return filtros;
  const range = anomesRangeForSafra(filtros.safraId);
  return {
    ...filtros,
    safraCode: range.safraCode,
    anomesInicio: filtros.anomesInicio ?? range.anomesInicio,
    anomesFim: filtros.anomesFim ?? range.anomesFim,
  };
}

export function registerCustoRoutes(app: Express) {
  app.get("/api/custo/dashboard", async (req, res) => {
    try {
      const filtros = mergeSafraPeriod(parseFiltros(req.query));
      exigirPeriodo(filtros);
      const negocios = parseNegociosQuery(req.query);
      const resultado = await consultarDashboard({
        ...filtros,
        negocios: negocios ?? filtros.negocios,
      });
      res.json(resultado);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = (err as { status?: number }).status ?? 500;
      res.status(status).json({ error: message });
    }
  });

  app.get("/api/custo/objetos-custo/dimensoes", async (req, res) => {
    try {
      const filtros = mergeSafraPeriod(parseFiltros(req.query));
      const negocios = parseNegociosQuery(req.query);
      const resultado = await listarDimensoesObjetoCusto({
        ...filtros,
        negocios: negocios ?? filtros.negocios,
      });
      res.json(resultado);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = (err as { status?: number }).status ?? 500;
      res.status(status).json({ error: message });
    }
  });

  app.get("/api/custo/objetos-custo", async (req, res) => {
    try {
      const filtros = mergeSafraPeriod(parseFiltros(req.query));
      const negocios = parseNegociosQuery(req.query);
      const resultado = await listarObjetosCusto({
        ...filtros,
        negocios: negocios ?? filtros.negocios,
      });
      res.json(resultado);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = (err as { status?: number }).status ?? 500;
      res.status(status).json({ error: message });
    }
  });

  app.get("/api/custo/funcionarios", async (req, res) => {
    try {
      const filtros = mergeSafraPeriod(parseFiltros(req.query));
      exigirPeriodo(filtros);
      res.json(await consultarFuncionarios(filtros));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = (err as { status?: number }).status ?? 500;
      res.status(status).json({ error: message });
    }
  });

  const handleCustoError = (res: Response, err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: message });
  };

  app.get("/api/custo/rateio", async (req, res) => {
    try {
      const filtros = mergeSafraPeriod(parseFiltros(req.query));
      res.json(await consultarRateio(filtros));
    } catch (err) {
      handleCustoError(res, err);
    }
  });

  app.get("/api/custo/rateio/resumo", async (req, res) => {
    try {
      const filtros = mergeSafraPeriod(parseFiltros(req.query));
      res.json(await consultarResumoPorEquipamento(filtros));
    } catch (err) {
      handleCustoError(res, err);
    }
  });

  app.get("/api/custo/rateio/atividades", async (req, res) => {
    try {
      const filtros = mergeSafraPeriod(parseFiltros(req.query));
      exigirPeriodo(filtros);
      const negocios = parseNegociosQuery(req.query);
      res.json(
        await consultarRateioDistribuicao({
          ...filtros,
          negocios: negocios ?? filtros.negocios,
        }),
      );
    } catch (err) {
      handleCustoError(res, err);
    }
  });

  app.get("/api/custo/rateio/matriz-subprocesso", async (req, res) => {
    try {
      const filtros = mergeSafraPeriod(parseFiltros(req.query));
      exigirPeriodo(filtros);
      const negocios = parseNegociosQuery(req.query);
      res.json(
        await consultarMatrizSubprocesso({
          ...filtros,
          negocios: negocios ?? filtros.negocios,
          incluirEstagios: String(req.query.incluirEstagios ?? "1") !== "0",
          somenteEstagios: String(req.query.somenteEstagios ?? "0") === "1",
        }),
      );
    } catch (err) {
      handleCustoError(res, err);
    }
  });

  app.get("/api/custo/rateio/distribuicao", async (req, res) => {
    try {
      const filtros = mergeSafraPeriod(parseFiltros(req.query));
      exigirPeriodo(filtros);
      const negocios = parseNegociosQuery(req.query);
      res.json(
        await consultarRateioDistribuicao({
          ...filtros,
          negocios: negocios ?? filtros.negocios,
        }),
      );
    } catch (err) {
      handleCustoError(res, err);
    }
  });

  app.get("/api/custo/rateio/oficina-reconciliacao", async (req, res) => {
    try {
      const filtros = mergeSafraPeriod(parseFiltros(req.query));
      exigirPeriodo(filtros);
      const [resultado, fluxo] = await Promise.all([
        consultarReconciliacaoOficina(filtros),
        consultarDiagnosticoFluxoOficina(filtros),
      ]);
      res.json({ ...resultado, fluxo });
    } catch (err) {
      handleCustoError(res, err);
    }
  });

  app.get("/api/custo/rateio/transporte-reconciliacao", async (req, res) => {
    try {
      const filtros = mergeSafraPeriod(parseFiltros(req.query));
      exigirPeriodo(filtros);
      const [resultado, fluxo] = await Promise.all([
        consultarReconciliacaoTransporte(filtros),
        consultarDiagnosticoFluxoTransporte(filtros),
      ]);
      res.json({ ...resultado, fluxo });
    } catch (err) {
      handleCustoError(res, err);
    }
  });

  app.get("/api/custo/rateio/mecanizacao-reconciliacao", async (req, res) => {
    try {
      const filtros = mergeSafraPeriod(parseFiltros(req.query));
      exigirPeriodo(filtros);
      const resultado = await consultarReconciliacaoMecanizacao(filtros);
      const fluxo = await consultarDiagnosticoFluxoMecanizacao(filtros);
      res.json({ ...resultado, fluxo });
    } catch (err) {
      handleCustoError(res, err);
    }
  });

  app.get("/api/custo/rateio/diagnostico", async (req, res) => {
    try {
      const filtros = mergeSafraPeriod(parseFiltros(req.query));
      exigirPeriodo(filtros);
      const negocios = parseNegociosQuery(req.query);
      res.json(
        await consultarDiagnosticoDistribuicao({
          ...filtros,
          negocios: negocios ?? filtros.negocios,
        }),
      );
    } catch (err) {
      handleCustoError(res, err);
    }
  });

  app.get("/api/custo/abastecimentos", async (req, res) => {
    try {
      const filtros = mergeSafraPeriod(parseFiltros(req.query));
      res.json(await consultarAbastecimentos(filtros));
    } catch (err) {
      handleCustoError(res, err);
    }
  });

  app.get("/api/custo/materiais", async (req, res) => {
    try {
      const filtros = mergeSafraPeriod(parseFiltros(req.query));
      res.json(await consultarMateriais(filtros));
    } catch (err) {
      handleCustoError(res, err);
    }
  });

  app.get("/api/custo/materiais/fluxo", async (req, res) => {
    try {
      const filtros = mergeSafraPeriod(parseFiltros(req.query));
      exigirPeriodo(filtros);
      res.json(await consultarDiagnosticoFluxoMaterial(filtros));
    } catch (err) {
      handleCustoError(res, err);
    }
  });

  app.get("/api/custo/insumos", async (req, res) => {
    try {
      const filtros = mergeSafraPeriod(parseFiltros(req.query));
      res.json(await consultarInsumos(filtros));
    } catch (err) {
      handleCustoError(res, err);
    }
  });

  app.get("/api/custo/servicos-terceiro", async (req, res) => {
    try {
      const filtros = mergeSafraPeriod(parseFiltros(req.query));
      res.json(await consultarServicosTerceiro(filtros));
    } catch (err) {
      handleCustoError(res, err);
    }
  });
}
