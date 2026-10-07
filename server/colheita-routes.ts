import type { Express, Request, Response } from "express";
import {
  atualizarCodEquipamentoCaminhao,
  listarCaminhoesDistinct,
  listarEntradaCanaCaminhao,
} from "./colheita/entrada-cana-caminhao-list.js";
import {
  atualizarCodEquipamentoMaquina,
  listarEntradaCanaMaquinaList,
  listarMaquinasDistinct,
} from "./colheita/entrada-cana-maquina-list.js";
import { listarHorasMaquina } from "./colheita/horas-maquina.js";
import { listarLiberacaoColheita, listarLiberacaoColheitaOpcoes } from "./colheita/liberacao-colheita.js";
import {
  listarEquipamentosTerceiro,
  listarCaminhaoTerceiro,
  removerCaminhaoTerceiro,
  removerEquipamentoTerceiro,
  salvarCaminhaoTerceiro,
  salvarEquipamentoTerceiro,
} from "./colheita/caminhao-terceiro.js";
import { gerarResumoTransporteCana, listarResumoTransporteOpcoes } from "./colheita/resumo-transporte-cana.js";
import { encerrarOrdensColheitaPorPeriodo } from "./colheita/encerramento-ordem-colheita.js";
import { readBearerToken, verifySessionToken } from "./auth.js";

function queryStr(req: Request, key: string) {
  const v = req.query[key];
  return v != null && String(v).trim() !== "" ? String(v) : null;
}

function queryList(req: Request, ...keys: string[]) {
  const values: string[] = [];
  for (const key of keys) {
    const raw = req.query[key];
    if (raw == null) continue;
    const parts = Array.isArray(raw) ? raw : String(raw).split(/[,;]/);
    for (const part of parts) {
      const trimmed = String(part).trim();
      if (trimmed) values.push(trimmed);
    }
  }
  return values.length ? [...new Set(values)] : null;
}

function queryBool(req: Request, key: string) {
  const v = queryStr(req, key);
  if (!v) return false;
  return v === "1" || v.toLowerCase() === "true" || v.toLowerCase() === "yes" || v.toLowerCase() === "sim";
}

function sendError(res: Response, err: unknown) {
  const status = err && typeof err === "object" && "status" in err ? Number((err as { status: number }).status) : 500;
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error: err instanceof Error ? err.message : String(err),
  });
}

export function registerColheitaRoutes(app: Express) {
  app.get("/api/entrada-cana-caminhao/caminhoes", async (req, res) => {
    try {
      res.json(
        await listarCaminhoesDistinct({
          limit: queryStr(req, "limit"),
          dataInicio: queryStr(req, "dataInicio"),
          dataFim: queryStr(req, "dataFim"),
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.post("/api/entrada-cana-caminhao/atualizar-equipamento", async (req, res) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      res.json(
        await atualizarCodEquipamentoCaminhao({
          caminhao: (body.caminhao ?? req.query.caminhao) as string | number | null,
          dataInicio: (body.dataInicio ?? req.query.dataInicio) as string | null,
          dataFim: (body.dataFim ?? req.query.dataFim) as string | null,
          codEquipamento: (body.codEquipamento ?? body.cod_equipamento ?? req.query.codEquipamento) as string | number | null,
          limpar: body.limpar === true || body.limpar === "true",
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/entrada-cana-caminhao", async (req, res) => {
    try {
      res.json(
        await listarEntradaCanaCaminhao({
          busca: queryStr(req, "busca") || queryStr(req, "q"),
          limit: queryStr(req, "limit"),
          dataInicio: queryStr(req, "dataInicio"),
          dataFim: queryStr(req, "dataFim"),
          caminhao: queryStr(req, "caminhao"),
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/entrada-cana-maquina/maquinas", async (req, res) => {
    try {
      res.json(
        await listarMaquinasDistinct({
          limit: queryStr(req, "limit"),
          dataInicio: queryStr(req, "dataInicio"),
          dataFim: queryStr(req, "dataFim"),
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.post("/api/entrada-cana-maquina/atualizar-equipamento", async (req, res) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      res.json(
        await atualizarCodEquipamentoMaquina({
          maquina: (body.maquina ?? req.query.maquina) as string | number | null,
          dataInicio: (body.dataInicio ?? req.query.dataInicio) as string | null,
          dataFim: (body.dataFim ?? req.query.dataFim) as string | null,
          codEquipamento: (body.codEquipamento ?? body.cod_equipamento ?? req.query.codEquipamento) as string | number | null,
          limpar: body.limpar === true || body.limpar === "true",
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/entrada-cana-maquina", async (req, res) => {
    try {
      res.json(
        await listarEntradaCanaMaquinaList({
          busca: queryStr(req, "busca") || queryStr(req, "q"),
          limit: queryStr(req, "limit"),
          dataInicio: queryStr(req, "dataInicio"),
          dataFim: queryStr(req, "dataFim"),
          maquina: queryStr(req, "maquina"),
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/horas-maquina", async (req, res) => {
    try {
      const rawTipo = queryStr(req, "codTipoEquipamento") || queryStr(req, "codTipo");
      res.json(
        await listarHorasMaquina({
          busca: queryStr(req, "busca") || queryStr(req, "q"),
          limit: queryStr(req, "limit"),
          dataInicio: queryStr(req, "dataInicio"),
          dataFim: queryStr(req, "dataFim"),
          equipamento: queryStr(req, "equipamento"),
          codTipoEquipamento:
            rawTipo != null && rawTipo !== "" && Number.isFinite(Number(rawTipo)) ? Number(rawTipo) : null,
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/liberacao-colheita/opcoes", async (req, res) => {
    try {
      res.json(
        await listarLiberacaoColheitaOpcoes({
          safraCode: queryStr(req, "safraCode") || queryStr(req, "safra") || "25/26",
          dataInicio: queryStr(req, "dataInicio"),
          dataFim: queryStr(req, "dataFim"),
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/liberacao-colheita", async (req, res) => {
    try {
      res.json(
        await listarLiberacaoColheita({
          safraCode: queryStr(req, "safraCode") || queryStr(req, "safra") || "25/26",
          dataInicio: queryStr(req, "dataInicio"),
          dataFim: queryStr(req, "dataFim"),
          busca: queryStr(req, "busca") || queryStr(req, "q"),
          codFazendas: queryList(req, "codFazenda", "codFazendas"),
          fazendas: queryList(req, "fazenda", "fazendas"),
          talhoes: queryList(req, "talhao", "talhoes"),
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.post("/api/colheita/encerrar-ordens", async (req, res) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const user = verifySessionToken(readBearerToken(req.headers.authorization));
      const usuarioEncerramento =
        String(body.usuarioEncerramento ?? user?.nome ?? user?.email ?? "SISTEMA")
          .trim()
          .toUpperCase()
          .replace(/\s+/g, "") || "SISTEMA";

      res.json(
        await encerrarOrdensColheitaPorPeriodo({
          dataInicio: String(body.dataInicio ?? ""),
          dataFim: String(body.dataFim ?? ""),
          dataEncerramento: String(body.dataEncerramento ?? body.dataFim ?? ""),
          obsEncerramento: String(body.obsEncerramento ?? "Encerrado"),
          usuarioEncerramento,
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/colheita/caminhao-terceiro", async (req, res) => {
    try {
      res.json({
        dados: listarCaminhaoTerceiro({
          caminhao: queryStr(req, "caminhao"),
          dataInicio: queryStr(req, "dataInicio"),
          dataFim: queryStr(req, "dataFim"),
        }),
      });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.post("/api/colheita/caminhao-terceiro", async (req, res) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      res.json(
        salvarCaminhaoTerceiro({
          caminhao: (body.caminhao ?? req.query.caminhao) as string | number | null,
          nomeTerceiro: (body.nomeTerceiro ?? body.nome_terceiro) as string | null,
          dataInicio: (body.dataInicio ?? req.query.dataInicio) as string | null,
          dataFim: (body.dataFim ?? req.query.dataFim) as string | null,
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.delete("/api/colheita/caminhao-terceiro/:id", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) {
        res.status(400).json({ error: "ID inválido." });
        return;
      }
      res.json(removerCaminhaoTerceiro(id));
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/colheita/equipamento-terceiro", async (req, res) => {
    try {
      res.json({ dados: listarEquipamentosTerceiro({ busca: queryStr(req, "busca") || queryStr(req, "q") }) });
    } catch (e) {
      sendError(res, e);
    }
  });

  app.post("/api/colheita/equipamento-terceiro", async (req, res) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      res.json(
        salvarEquipamentoTerceiro({
          codEquipamento: (body.codEquipamento ?? body.cod_equipamento ?? req.query.codEquipamento) as string | number | null,
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.delete("/api/colheita/equipamento-terceiro/:codEquipamento", async (req, res) => {
    try {
      res.json(removerEquipamentoTerceiro(req.params.codEquipamento));
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/resumo-transporte-cana/opcoes", async (req, res) => {
    try {
      res.json(
        await listarResumoTransporteOpcoes({
          safraCode: queryStr(req, "safraCode") || queryStr(req, "safra"),
          dataInicio: queryStr(req, "dataInicio"),
          dataFim: queryStr(req, "dataFim"),
          modo: queryStr(req, "modo"),
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/resumo-transporte-cana", async (req, res) => {
    try {
      res.json(
        await gerarResumoTransporteCana({
          safraCode: queryStr(req, "safraCode") || queryStr(req, "safra"),
          reportSafraCode: queryStr(req, "reportSafraCode") || queryStr(req, "reportSafra"),
          dataInicio: queryStr(req, "dataInicio"),
          dataFim: queryStr(req, "dataFim"),
          refDate: queryStr(req, "refDate"),
          caminhoes: queryList(req, "caminhao", "caminhoes"),
          terceiros: queryList(req, "terceiro", "terceiros"),
          modo: queryStr(req, "modo"),
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/fazenda-usina/fazendas-entrada", async (req, res) => {
    try {
      res.json(
        await listarFazendasEntrada({
          dataInicio: queryStr(req, "dataInicio"),
          dataFim: queryStr(req, "dataFim"),
          busca: queryStr(req, "busca"),
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/fazenda-usina/sistema", async (req, res) => {
    try {
      res.json(await listarFazendasSistema({ busca: queryStr(req, "busca") }));
    } catch (e) {
      sendError(res, e);
    }
  });

  app.get("/api/fazenda-usina", async (req, res) => {
    try {
      res.json(await listarFazendaUsina({ busca: queryStr(req, "busca"), limit: queryStr(req, "limit") }));
    } catch (e) {
      sendError(res, e);
    }
  });

  app.post("/api/fazenda-usina/salvar", async (req, res) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      res.json(
        await salvarFazendaUsina({
          descricaoUsina: body.descricaoUsina as string | null,
          fazenda: body.fazenda as string | null,
          codSistema: (body.codSistema ?? body.cod_sistema) as string | number | null,
          raio: body.raio as string | number | null,
          limpar: body.limpar === true,
        }),
      );
    } catch (e) {
      sendError(res, e);
    }
  });
}
