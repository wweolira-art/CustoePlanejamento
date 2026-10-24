// Classificação explícita por objeto de origem, definida para o relatório de rateio.
export const OBJETOS_MAO_OBRA = new Set([
  24, 383, 199, 35, 94, 211, 30, 378, 84, 294,
  37, 9, 4, 6, 58, 19, 32, 134, 112, 109, 297,
]);
export const OBJETOS_INSUMOS = new Set([45, 29, 2, 56, 49, 34]);

/** Identifica objetos operacionais explícitos; descrições ambíguas usam o empenho. */
export function grupoObjetoOperacional(descricao) {
  const nome = String(descricao || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  if (!nome) return null;
  if (/\bmao de obra\b|\bservicos auxiliares de mao de obra\b/.test(nome)) return 'mao_obra';
  if (/^(?:corte (?:de )?(?:cana|mudas)|adubacao manual|limpa\s*\/\s*arranca|servico bituca)/.test(nome)
      && !/mecaniz|mecanic/.test(nome)) return 'mao_obra';
  if (/^(?:servicos?\s+)?apoio\b.*(?:irrig|fertirrig)/.test(nome)
      || /^servicos? apoio adm.*(?:irrig|fertirrig)/.test(nome)) return 'mao_obra';
  if (/^(?:colhedeiras?|colheitadeiras?|carregadeiras?|tratores?|trator\b|caminhoes?|caminhao\b|reboques?|transbordo|implementos?|maquinas?\b|equip\b|equipamentos?\b|automoveis?|utilitarios?|motocicletas?|comboios?|drone\b|carretel\b|pivot\b|meloso\b)/.test(nome)) return 'maquina';
  if (/^(?:oficina\b|borracharia\b|lavagem\s*\/\s*lubrificacao|serralharia automotiva|cald[ei]raria automotiva|mecanizacao\b)/.test(nome)) return 'maquina';
  if (/^(?:carregamento mecanic|adubacao mecanic|semeio\s*-?\s*mecaniz|corte (?:de )?cana mecaniz|transporte (?:agricola|de terceiros|cana|de mudas|de pessoal))/.test(nome)) return 'maquina';
  return null;
}
