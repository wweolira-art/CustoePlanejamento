# Integração de orçamento

Estado: o modo `BUDGET_STORAGE=supabase` persiste o planejamento no Supabase.
O login Oracle/ORDS continua ativo. O SQLite é mantido como base de cálculo local,
restaurada do estado remoto, para preservar o motor de fórmulas existente.

## 1. Configuração local

O `.env` na raiz precisa conter:

```dotenv
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
```

Copiar a URL do projeto e a chave secreta nas configurações de API do Supabase.
Também é aceita `SUPABASE_SERVICE_ROLE_KEY` para chave legada.
Não usar prefixo `VITE_` e não colocar chaves no frontend ou no Git.

```powershell
npm run supabase:check
```

O comando faz leituras sem retornar registros, verificando a existência e o
acesso às 16 tabelas. Não testa as colunas, triggers ou políticas de escrita.

## 2. Acesso e auditoria

Após os CREATE TABLE, executar `002_backend_security_audit.sql` no SQL Editor.
O arquivo é transacional e reaplicável. Restringe somente as tabelas listadas;
não altera tabelas de outros módulos ou remove dados.

O modelo mantém o login Oracle/ORDS. `anon` e `authenticated` não recebem
acesso às tabelas; o backend usa a chave secreta e deve validar o token atual e
as permissões de cada centro antes de qualquer consulta ou alteração.
Não criar políticas `USING (true)` para viabilizar o acesso pelo navegador.

Os UUIDs de `auth.users` não equivalem aos IDs numéricos de usuários atuais.
As novas colunas `usuario_legado_*` acomodam essa diferença. Os campos antigos
de Supabase Auth podem ficar nulos. Após o script 003, a autoria numérica é
propagada pelo backend na mesma transação que grava os dados e a revisão.

Os triggers registram INSERT/UPDATE e DELETE direto nas tabelas de orçamento.
Exclusões em cascata são representadas pelo evento do pai quando seus vínculos
já não existem; não constituem backup completo dos filhos excluídos.
O histórico impede a exclusão física de um orçamento; usar `encerrado`.
No modo Supabase, a persistência rejeita edições de versões fora de rascunho.

## 3. Diagnóstico antes da migração

```powershell
npm run supabase:migration-report
```

Abre o SQLite existente em modo somente leitura, sem executar os seeds do
servidor. Exibe contagens, safra atual e fórmulas sem valor armazenado.
Não escreve dados locais nem envia dados ao Supabase.

O sistema atual usa setembro a agosto. `lines` e `line_months` não possuem
`safra_id`; não atribuir seus valores a todas as safras. Os dados históricos de
`safra_kpis` não substituem os lançamentos detalhados. As fórmulas e resultados
devem ser reconciliados com o motor atual antes de importar.

## 4. Migração dos dados

```powershell
npm run supabase:prepare
npm run supabase:migrate
npm run supabase:migrate -- --apply
```

O primeiro comando faz um backup consistente em `data/migrations/`, calcula os
valores em outra cópia e salva um snapshot. O segundo prepara um plano consultando
os cadastros remotos, sem escrever. O terceiro grava e confere os registros.

O orçamento detalhado é importado exclusivamente para a safra atual. Cadastros
de todas as safras são importados, mas históricos resumidos não são apresentados
como lançamentos detalhados. Cadastros remotos existentes são reaproveitados por
código/nome sem sobrescrever suas descrições ou preços. Categorias sem uso no
orçamento não são incluídas. O restante do SQLite é preservado no backup local.

Cada item recebe as 12 competências, incluindo zeros. Os valores são calculados
pelo motor atual e arredondados por competência para `numeric(20,2)`. A soma pode
diferir alguns centavos do total original arredondado somente no final; o
relatório mostra a diferença por centro. Não há ajuste arbitrário dos centavos.

As fórmulas, valores brutos, parâmetros de linha e regras aplicáveis são
preservados no JSON `configuracao` dos planos. Configurações sem plano explícito
recebem um registro de preservação. Referências sem cadastro não geram cadastros
inventados: ficam sem FK e são registradas como avisos, preservando o original.

A gravação usa lotes REST; não é uma transação única. A versão permanece em
rascunho, com `state=uploading` nas observações até a conferência completa, quando
é marcada `verified`. IDs estáveis por snapshot permitem retomar o mesmo comando
sem duplicar registros. Não executar `supabase:prepare` para retomar: isso cria um
novo snapshot e pode gerar outra versão. O plano, os mapas de IDs e o resultado
ficam em `data/migrations/`, fora do Git. O arquivo `latest.json` aponta a execução.

## 5. Ativação do aplicativo

Executar `003_app_persistence.sql` no SQL Editor e depois:

```powershell
npm run supabase:activate
npm start
```

A ativação faz nova cópia consistente, preserva o estado exato de 33 tabelas de
planejamento e confere o conteúdo remoto antes de gravar `BUDGET_STORAGE=supabase`
no `.env`. Se já existe estado remoto, não o sobrescreve com a base local.
Reiniciar a API é necessário para carregar a configuração.

Na inicialização, `data/supabase-calculation-cache.db` é restaurado do Supabase.
O arquivo `data/planejamento.db` original permanece preservado. Os módulos fora
do orçamento e as permissões locais continuam em SQLite nesta base de execução;
o login e cadastro de usuários continuam no Oracle/ORDS.

Cada requisição de planejamento verifica a revisão remota. Uma revisão nova
renova a base de cálculo antes de executar a rota. Gravações são serializadas no
servidor e confirmadas por uma função PostgreSQL que, na mesma transação:

- atualiza as tabelas normalizadas afetadas;
- preserva o estado completo do motor legado em `orcamento_aplicativo_estado`;
- registra o ID do usuário e incrementa a revisão.

O estado legado inclui células de suporte, premissas mensais, preços por safra,
rateios e históricos resumidos que não cabem no modelo normalizado inicial. Esta
é uma etapa de compatibilidade: o motor SQL local ainda não foi reescrito para
PostgreSQL. O aplicativo lê esse estado persistente; as 16 tabelas normalizadas
também são atualizadas como projeção para relatórios e integrações. Alterações
devem passar pela API; editar apenas a projeção no SQL Editor não altera o motor.

O cliente recebe sucesso após a confirmação remota. Se a rede falhar, a base de
cálculo volta ao estado anterior e a API informa erro. Se a confirmação se perder
depois do commit, a revisão é recarregada na próxima consulta. Duas instâncias
não podem sobrescrever a mesma revisão: a segunda gravação é rejeitada para
recarregar o estado e tentar novamente. Os endpoints de orçamento exigem sessão.

Não há gravação offline. O login Oracle/ORDS não foi substituído por Supabase
Auth. A sincronização de permissões e módulos fora do orçamento entre servidores
não faz parte desta etapa.

Para voltar ao modo local, parar a API, alterar `BUDGET_STORAGE=sqlite` e iniciar
novamente. Isso abre a base original preservada, não os dados posteriores à
ativação. Antes de um retorno definitivo, exportar o estado remoto mais recente
para não perder as edições feitas no Supabase.
