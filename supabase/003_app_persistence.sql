-- Executar após 002_backend_security_audit.sql.
-- Persistência transitória: tabelas normalizadas + estado exato do motor legado.
-- O estado preserva células/fórmulas, premissas mensais e rateios sem perda.
BEGIN;

CREATE TABLE IF NOT EXISTS public.orcamento_aplicativo_estado (
  id TEXT PRIMARY KEY CHECK (id = 'principal'),
  revisao BIGINT NOT NULL DEFAULT 1 CHECK (revisao > 0),
  estado JSONB NOT NULL CHECK (jsonb_typeof(estado) = 'object'),
  usuario_legado_id BIGINT,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.orcamento_aplicativo_estado ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.orcamento_aplicativo_estado FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.orcamento_aplicativo_estado TO service_role;

CREATE OR REPLACE FUNCTION public.autoria_orcamento_legada()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.usuario_legado_id := nullif(current_setting('app.usuario_legado_id', true), '')::BIGINT;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.autoria_orcamento_legada() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_autoria_orcamento_legada ON public.orcamento_historico;
CREATE TRIGGER trg_autoria_orcamento_legada BEFORE INSERT ON public.orcamento_historico
FOR EACH ROW EXECUTE FUNCTION public.autoria_orcamento_legada();

CREATE OR REPLACE FUNCTION public.salvar_orcamento_aplicativo(
  revisao_esperada BIGINT,
  novo_estado JSONB,
  alteracoes JSONB,
  remover JSONB,
  usuario BIGINT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  atual BIGINT;
  nome TEXT;
  dados JSONB;
  campos TEXT;
  atualizacoes TEXT;
  orcamento_atual UUID;
  permitido TEXT[] := ARRAY[
    'safras', 'centros_custo', 'categorias', 'materiais', 'atividades',
    'objetos_custo', 'fazendas', 'orcamentos', 'orcamento_centros',
    'orcamento_categorias', 'orcamento_premissas', 'orcamento_itens',
    'orcamento_item_meses', 'orcamento_item_planos', 'orcamento_item_plano_meses'
  ];
  ordem_delete TEXT[] := ARRAY[
    'orcamento_item_plano_meses', 'orcamento_item_planos',
    'orcamento_item_meses', 'orcamento_itens', 'orcamento_premissas',
    'orcamento_categorias', 'orcamento_centros'
  ];
BEGIN
  IF jsonb_typeof(novo_estado) <> 'object'
     OR jsonb_typeof(novo_estado->'tables') IS DISTINCT FROM 'object'
     OR jsonb_typeof(alteracoes) <> 'object'
     OR jsonb_typeof(remover) <> 'object' THEN
    RAISE EXCEPTION 'Formato inválido';
  END IF;
  -- Serializa os commits, inclusive a primeira criação, entre servidores.
  PERFORM pg_advisory_xact_lock(137827, 20261015);
  SELECT revisao INTO atual FROM public.orcamento_aplicativo_estado
  WHERE id = 'principal' FOR UPDATE;
  IF coalesce(atual, 0) <> revisao_esperada THEN
    RAISE EXCEPTION 'Conflito de revisão' USING ERRCODE = '40001';
  END IF;
  PERFORM set_config('app.usuario_legado_id', coalesce(usuario::TEXT, ''), true);
  orcamento_atual := (novo_estado->>'activeBudgetId')::UUID;
  IF orcamento_atual IS NULL THEN RAISE EXCEPTION 'Orçamento ativo não informado'; END IF;
  IF EXISTS (SELECT 1 FROM public.orcamentos WHERE id = orcamento_atual AND status <> 'rascunho') THEN
    RAISE EXCEPTION 'A versão do orçamento não está em rascunho';
  END IF;

  FOREACH nome IN ARRAY permitido LOOP
    dados := alteracoes->nome;
    IF dados IS NULL OR dados = '[]'::JSONB THEN CONTINUE; END IF;
    IF jsonb_typeof(dados) <> 'array' THEN RAISE EXCEPTION 'Lote inválido'; END IF;
    SELECT string_agg(format('%I', k), ', ' ORDER BY k),
           string_agg(format('%I = EXCLUDED.%I', k, k), ', ' ORDER BY k)
             FILTER (WHERE k NOT IN ('id', 'item_id', 'competencia', 'plano_id'))
      INTO campos, atualizacoes
    FROM jsonb_object_keys(dados->0) AS k;
    EXECUTE format(
      'INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_recordset(NULL::public.%I, $1) ON CONFLICT (%s) DO UPDATE SET %s',
      nome, campos, campos, nome,
      CASE WHEN nome = 'orcamento_item_meses' THEN 'item_id, competencia'
           WHEN nome = 'orcamento_item_plano_meses' THEN 'plano_id, competencia'
           ELSE 'id' END,
      atualizacoes
    ) USING dados;
  END LOOP;

  -- Remoções vêm de IDs previamente lidos; cada registro precisa estar no
  -- orçamento atual e a versão precisa permanecer editável.
  FOREACH nome IN ARRAY ordem_delete LOOP
    dados := remover->nome;
    IF dados IS NULL OR dados = '[]'::JSONB THEN CONTINUE; END IF;
    IF nome IN ('orcamento_item_meses', 'orcamento_item_plano_meses') THEN
      RAISE EXCEPTION 'Remoção de competências avulsas não suportada';
    END IF;
    EXECUTE format('DELETE FROM public.%I WHERE id IN (SELECT value::UUID FROM jsonb_array_elements_text($1))', nome)
      USING dados;
  END LOOP;
  INSERT INTO public.orcamento_aplicativo_estado (id, revisao, estado, usuario_legado_id)
  VALUES ('principal', coalesce(atual, 0) + 1, novo_estado, usuario)
  ON CONFLICT (id) DO UPDATE SET revisao = EXCLUDED.revisao,
    estado = EXCLUDED.estado, usuario_legado_id = EXCLUDED.usuario_legado_id,
    atualizado_em = now();
  RETURN jsonb_build_object('revisao', coalesce(atual, 0) + 1);
END;
$$;
REVOKE ALL ON FUNCTION public.salvar_orcamento_aplicativo(BIGINT, JSONB, JSONB, JSONB, BIGINT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_orcamento_aplicativo(BIGINT, JSONB, JSONB, JSONB, BIGINT)
  TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
