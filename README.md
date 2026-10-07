# Custo e Planejamento

Aplicacao web para planejamento agricola, orcamento, centros de custo, cadastros, colheita e indicadores. O frontend usa React + Vite e a API roda em Express com SQLite local e integracoes Oracle/ORDS configuradas por variaveis de ambiente.

## Requisitos

- Node.js 20 ou superior
- npm
- Oracle Instant Client, apenas quando for usar as rotas que consultam Oracle

## Configuracao

1. Instale as dependencias:

```bash
npm install
```

2. Crie seu arquivo local de ambiente:

```bash
cp .env.example .env
```

3. Ajuste as credenciais e URLs no `.env`. Esse arquivo e local e nao deve ser enviado ao GitHub.

## Rodando em desenvolvimento

```bash
npm run dev
```

- Interface: http://localhost:5174/
- API: http://localhost:8789/

O app usa portas diferentes do Controle Agricola para permitir que os dois rodem ao mesmo tempo.

## Scripts uteis

```bash
npm run build    # gera a build de producao em dist/
npm run start    # inicia a API e serve dist/ quando existir
npm test         # executa os testes em tests/
```

## Dados locais

O SQLite local fica em `data/planejamento.db`. Arquivos de banco, logs, builds, executaveis do servico Windows, arquivos temporarios e credenciais ficam fora do Git por padrao.

Os JSONs em `data/` e `public/data/` podem ser usados como carga/base inicial do projeto. Revise esses arquivos antes de publicar caso contenham informacoes internas da empresa.

## Publicacao no GitHub

Este repositorio ja esta preparado para versionar apenas codigo-fonte, configuracoes de exemplo, dados JSON intencionais e assets publicos. Antes de publicar:

```bash
git status
git add .
git commit -m "Preparar projeto para GitHub"
git remote add origin <url-do-repositorio>
git push -u origin main
```
