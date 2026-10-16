-- Executar depois dos CREATE TABLE enviados no chat.
-- Modelo: login Oracle/ORDS; acesso Supabase exclusivamente pelo backend.
-- Pode ser reaplicado. Não libera acesso direto ao navegador.
BEGIN;

DO $$
DECLARE
  nome TEXT;
BEGIN
  FOREACH nome IN ARRAY ARRAY[
    'safras', 'centros_custo', 'categorias', 'materiais', 'atividades',
    'objetos_custo', 'fazendas', 'orcamentos', 'orcamento_centros',
    'orcamento_categorias', 'orcamento_itens', 'orcamento_item_meses',
    'orcamento_premissas', 'orcamento_item_planos',
    'orcamento_item_plano_meses', 'orcamento_historico'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', nome);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', nome);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', nome);
  END LOOP;
END;
$$;

-- Identificadores do login atual são inteiros, distintos dos UUIDs de auth.users.
ALTER TABLE public.orcamentos
  ADD COLUMN IF NOT EXISTS usuario_legado_criador_id BIGINT,
  ADD COLUMN IF NOT EXISTS usuario_legado_aprovador_id BIGINT;

ALTER TABLE public.orcamento_historico
  ADD COLUMN IF NOT EXISTS usuario_legado_id BIGINT;

-- Executado pelo dono da função; sem SQL dinâmico nem objetos fora de public.
CREATE OR REPLACE FUNCTION public.auditar_orcamento()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  registro JSONB;
  orcamento UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    registro := to_jsonb(OLD);
  ELSE
    registro := to_jsonb(NEW);
  END IF;

  CASE TG_TABLE_NAME
    WHEN 'orcamentos' THEN
      orcamento := (registro->>'id')::UUID;
    WHEN 'orcamento_centros', 'orcamento_premissas' THEN
      orcamento := (registro->>'orcamento_id')::UUID;
    WHEN 'orcamento_categorias' THEN
      SELECT c.orcamento_id INTO orcamento
      FROM public.orcamento_centros c
      WHERE c.id = (registro->>'orcamento_centro_id')::UUID;
    WHEN 'orcamento_itens' THEN
      SELECT c.orcamento_id INTO orcamento
      FROM public.orcamento_categorias cat
      JOIN public.orcamento_centros c ON c.id = cat.orcamento_centro_id
      WHERE cat.id = (registro->>'orcamento_categoria_id')::UUID;
    WHEN 'orcamento_item_meses', 'orcamento_item_planos' THEN
      SELECT c.orcamento_id INTO orcamento
      FROM public.orcamento_itens i
      JOIN public.orcamento_categorias cat ON cat.id = i.orcamento_categoria_id
      JOIN public.orcamento_centros c ON c.id = cat.orcamento_centro_id
      WHERE i.id = (registro->>'item_id')::UUID;
    WHEN 'orcamento_item_plano_meses' THEN
      SELECT c.orcamento_id INTO orcamento
      FROM public.orcamento_item_planos p
      JOIN public.orcamento_itens i ON i.id = p.item_id
      JOIN public.orcamento_categorias cat ON cat.id = i.orcamento_categoria_id
      JOIN public.orcamento_centros c ON c.id = cat.orcamento_centro_id
      WHERE p.id = (registro->>'plano_id')::UUID;
    ELSE
      RAISE EXCEPTION 'Tabela não suportada pela auditoria';
  END CASE;

  IF orcamento IS NULL THEN
    -- Na cascata, o pai já foi removido e seu DELETE já foi auditado.
    -- O evento do pai representa a exclusão da árvore; não duplicar eventos.
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Orçamento não encontrado para auditoria de %', TG_TABLE_NAME;
  END IF;

  INSERT INTO public.orcamento_historico (
    orcamento_id, acao, tabela, registro_id, dados_anteriores, dados_novos
  ) VALUES (
    orcamento, TG_OP, TG_TABLE_NAME,
    coalesce(registro->>'id', registro->>'item_id', registro->>'plano_id')::UUID,
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END
  );
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.auditar_orcamento() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  nome TEXT;
BEGIN
  FOREACH nome IN ARRAY ARRAY[
    'orcamentos', 'orcamento_centros', 'orcamento_categorias',
    'orcamento_itens', 'orcamento_item_meses', 'orcamento_premissas',
    'orcamento_item_planos', 'orcamento_item_plano_meses'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_auditar_orcamento ON public.%I', nome);
    -- DELETE antes da remoção, enquanto os vínculos ainda existem.
    EXECUTE format(
      'CREATE TRIGGER trg_auditar_orcamento BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.auditar_orcamento()', nome
    );
    EXECUTE format('DROP TRIGGER IF EXISTS trg_auditar_orcamento_escrita ON public.%I', nome);
    EXECUTE format(
      'CREATE TRIGGER trg_auditar_orcamento_escrita AFTER INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.auditar_orcamento()', nome
    );
  END LOOP;
END;
$$;

-- Histórico somente acrescentado pelos triggers; evita edição acidental no backend.
REVOKE INSERT, UPDATE, DELETE ON public.orcamento_historico FROM service_role;

-- O FK original impede apagar orçamentos com histórico.
-- Para retirar uma versão de uso, alterar o status para encerrado.
COMMIT;
