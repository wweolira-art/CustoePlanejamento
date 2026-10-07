# Controle de pneus

Implementado em Indicadores → Automotivo → Controle de pneus, com cinco visões baseadas nas referências fornecidas: descarte, estoque/equipamento, detalhamento de descartes, ressoldadora e detalhamento resoladora. Consultas somente de leitura no Oracle. Atualiza a cada 30 minutos enquanto ampliado.

## Dados e limitações

- Motivo de sucata 17 excluído, como na consulta fornecida.
- A consulta de validação retornou 1.671 pneus únicos e 435 consertos. Não há dados fictícios no dashboard.
- Última montagem e última medição usam ROW_NUMBER para evitar duplicações e combinações de data/hora inexistentes.
- Vida = vida inicial (1 quando ausente) + reformas concluídas e não recusadas.
- Quilometragem/horas = KM_HSTOTAL do cadastro. Não soma leituras cumulativas de montagem.
- Sulco de descarte: sulco da última retirada. Pneus em uso: média dos valores não nulos da última medição do equipamento, com fallback para sulco de colocação.
- Estoque: pneus não sucateados sem montagem aberta; consertos abertos e não recusados aparecem destacados.
- Custo de descarte: custo médio unitário ponderado por quantidade em `material.itensrequisicaomaterial`, família 32, ligado por ano da data de sucateamento e `cod_medidapneu` via `automotivo.medidapneu_material`. O KPI total soma os pneus com preço encontrado; o gráfico por medida exibe o custo médio da medida e a quantidade de pneus.
- Quando não existe retirada da família 32 no ano/medida do descarte, esse pneu fica fora do total estimado e não é substituído por zero.
- Economia na reforma: custo de reposição (mesmo da aba Descarte — família 32 por medida; fallback ano mais recente da medida, depois valor de aquisição) menos valor das reformas concluídas. Mostra a economia de reformar em vez de comprar pneu novo.
- Durabilidade por marca (Ressoldadora): Σ KM/HRS rodado ÷ Σ vidas dos pneus enviados no período (únicos). Rodado = `KM_HSTOTAL`; vida = vida inicial + reformas concluídas.
- Aguardando orçamento: não calculado porque não foi fornecida regra/campo de status.
- Tipo de equipamento: classificação vigente do último equipamento do pneu. A unidade KM/HRS deve ser validada por tipo.
- Ressoldadora: período filtra envio (início do conserto), entregas agrupadas por conclusão. Pneus com múltiplos serviços são contados por evento.
- Os valores dos prints não foram transcritos como dados reais.

## Validação

Consulta executada contra o Oracle, compilação Vite, quatro testes de custo/médias/período e conferência das quatro telas no navegador com fixture temporária explicitamente identificada. Sessão da aplicação exigiu login; a verificação visual isolada não alterou autenticação. O TypeScript global mantém os erros preexistentes em outros componentes.

## Equipamentos de terceiro

A tela Associar equipamento usa o cadastro local `colheita_equipamento_terceiro` para marcar somente os `cod_equipamento` que devem entrar como Equip. terceiro. No resumo de transporte, esses códigos saem das colunas próprias e aparecem nas colunas de terceiros como "Equip. {codigo}".

## Fundo

Ferramenta integrada imagegen (não CLI). Arquivo final: public/indicadores/pneus-background.png.

Prompt final:

Use case: product-mockup. Asset type: photographic background for an agricultural tire-management dashboard. Create a landscape photograph of large black agricultural and road truck tires, close-up rubber tread, one tall tire angled diagonally through the center-right, cropped at top and bottom, a second softly blurred tire behind it. Dark blue and teal monochrome treatment with gentle steel-blue light, realistic tread grooves and rubber. Restrained contrast, softly lit, usable behind translucent data panels. Composition: wide 3:2 landscape, quieter blue gradient on left 20% for a sidebar, tire details concentrated middle and right. No text, no labels, no logos, no charts, no interface. This is ONLY the background asset, not a dashboard mockup.
