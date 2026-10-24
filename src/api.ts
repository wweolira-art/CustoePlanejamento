import type { LubrificacaoDashboardData } from "./lib/lubrificacao";
import type { PneusData } from "./lib/pneus";
import type { ConsumoOleoHidraulicoData } from "./lib/consumo-oleo-hidraulico";

export type { LubrificacaoDashboardData, ConsumoOleoHidraulicoData };
const AUTH_STORAGE_KEY = "pa_auth_token";

function authHeaders(extra?: Record<string, string>) {
  const token = localStorage.getItem(AUTH_STORAGE_KEY);
  return {
    ...(extra ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const fail = async (res: Response): Promise<never> => {
  if (res.status === 413) {
    throw new ApiError(413, "O envio é grande demais para o servidor. Salve só a redução, sem montar outro cálculo.");
  }
  const text = await res.text();
  try {
    const parsed = JSON.parse(text) as { error?: string };
    throw new ApiError(res.status, parsed.error || text || `Falha na requisição (${res.status})`);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(res.status, text.trim() || `Falha na requisição (${res.status})`);
  }
};

const get = async <T>(url: string, signal?: AbortSignal): Promise<T> => {
  const res = await fetch(url, { headers: authHeaders(), signal });
  if (!res.ok) await fail(res);
  return res.json() as Promise<T>;
};

const send = async <T>(url: string, method: string, body?: unknown): Promise<T> => {
  const res = await fetch(url, {
    method,
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (!res.ok) await fail(res);
  return res.json() as Promise<T>;
};

export interface AuthUser {
  id: number;
  nome: string;
  email: string;
  permissions: string[];
}

export interface AdminUserRow {
  id: number;
  nome: string;
  email: string;
  ativo: boolean;
  permissions: string[];
}

export interface PermissionCatalog {
  admin: { key: string; label: string }[];
  costPlanning: { key: string; label: string }[];
  pages: { key: string; label: string }[];
  dynamic: { sheets: string; siteGroups: string };
}

export interface AuthSession {
  token: string;
  user: AuthUser;
}

export const authStorage = {
  getToken: () => localStorage.getItem(AUTH_STORAGE_KEY),
  setToken: (token: string) => localStorage.setItem(AUTH_STORAGE_KEY, token),
  clear: () => localStorage.removeItem(AUTH_STORAGE_KEY),
};

export interface ExternalSiteItem {
  id: number;
  groupId: number;
  label: string;
  url: string;
  sortOrder: number;
  visible: boolean;
}

export interface ExternalSiteGroup {
  id: number;
  label: string;
  slug: string;
  sortOrder: number;
  visible: boolean;
  nativeKey: string | null;
  items: ExternalSiteItem[];
  hiddenNativeTabs?: string[];
}

export const EXTERNAL_EMBED_TARGETS = [
  { nativeKey: "cost-planning", label: "Custo e Planejamento", hideSidebar: false },
  { nativeKey: "gestao-colheita", label: "Gestão de colheita", hideSidebar: false },
  { nativeKey: "indicadores", label: "Indicadores", hideSidebar: false },
] as const;

export type ExternalSiteEmbedNativeKey = (typeof EXTERNAL_EMBED_TARGETS)[number]["nativeKey"];

export function isLegacyOrcaSafraGroup(group: Pick<ExternalSiteGroup, "slug" | "label" | "nativeKey">) {
  if (group.slug === "orca-safra") return true;
  if (group.nativeKey) return false;
  const label = group.label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return label.includes("orca") && label.includes("safra");
}

export function isSidebarSiteGroup(group: ExternalSiteGroup) {
  if (isLegacyOrcaSafraGroup(group)) return false;
  if (!group.nativeKey) return true;
  const target = EXTERNAL_EMBED_TARGETS.find((row) => row.nativeKey === group.nativeKey);
  return !target?.hideSidebar;
}

export function embedGroupLabel(group: ExternalSiteGroup) {
  if (group.nativeKey === "cost-planning") return "Custo e Planejamento (orçamento e custos + sites externos)";
  if (group.nativeKey === "gestao-colheita") return "Gestão de colheita (aba nativa + sites externos)";
  if (group.nativeKey === "indicadores") return "Indicadores (relatórios por grupo)";
  return group.nativeKey ? "Aba nativa + sites externos" : "Somente sites externos";
}

export interface ExternalSiteRegisterResult {
  group: ExternalSiteGroup;
  item: ExternalSiteItem;
}

export interface SheetInfo {
  id: number;
  name: string;
  title: string;
  kind: string;
  sort_order: number;
  visible: number;
  verified?: number;
}

export interface MonthCell {
  month: number;
  value: number;
  formula: string | null;
}

export interface LineItem {
  id: number;
  category_id: number;
  object_code: string | null;
  product_code: string | null;
  item_type: string | null;
  description: string;
  is_group: number;
  activity_id: number | null;
  material_id: number | null;
  cost_object_id: number | null;
  ref_kind: "material" | "activity" | "cost_object" | "cost_center" | null;
  parent_id: number | null;
  center_sheet_id?: number | null;
  use_activity_auto?: number | null;
  start_month?: number | null;
  end_month?: number | null;
  calc_months?: string | null;
  calc_plans?: string | null;
  calc_premise?: string | null;
  calc_dose?: number | null;
  calc_price?: number | null;
  calc_exclude_weekdays?: string | null;
  calc_area_premise?: string | null;
  calc_area_pct?: number | null;
  calc_area_ha?: number | null;
  calc_reduce_pct?: number | null;
  calc_applications?: number | null;
  calc_direct?: number | null;
  calc_kind?: string | null;
  calc_trips?: number | null;
  calc_machine_qty?: number | null;
  calc_hour_interval?: number | null;
  funcionario_api_config?: string | null;
  area_ha?: number | null;
  area_ha_months?: number[] | null;
  premise_ha?: number | null;
  premise_ha_months?: number[] | null;
  own_months?: number[] | null;
  months: MonthCell[];
  total: number;
}

export interface FuncionarioApiConfig {
  enabled: boolean;
  externalSafraId: number;
  subprocessIds: number[];
  folhaAvulsaSubprocessIds: number[];
}

export interface FuncionarioSubprocessOption {
  id: number;
  codigo: string;
  nome: string;
  totalSafra: number;
  meses: number[];
  isAdministration?: boolean;
}

export interface FuncionarioSubprocessList {
  externalSafraId: number;
  safraLabel: string | null;
  meses: string[];
  orcadoGeral?: number[];
  folhaAvulsaGeral?: number[];
  folhaAvulsaSafra?: number;
  subprocessos: FuncionarioSubprocessOption[];
}

export interface FuncionarioOrcamentoRefreshResult {
  externalSafraId: number;
  externalSafraLabel: string | null;
  localSafraId: number;
  localSafraCode: string | null;
  configUpdated: Array<{ lineId: number; sheetName: string; totalSafra: number }>;
  importUpdated: Array<{ lineId: number; sheetName: string; totalSafra: number; created?: boolean }>;
  skipped: Array<{
    subprocessId: number;
    subprocessCodigo: string;
    subprocessNome: string;
    sheetName: string | null;
    lineId: number | null;
    lineDescription: string | null;
    meses: number[];
    totalSafra: number;
    status: "ready" | "no_sheet" | "no_line";
  }>;
  updatedCount: number;
  configUpdatedCount: number;
  importUpdatedCount: number;
  skippedCount: number;
}

export interface CategoryBlock {
  id: number;
  name: string;
  lines: LineItem[];
  monthTotals: number[];
  total: number;
}

export interface ValueDistribution {
  id: number;
  createdAt: string;
  activityId: number;
  activityName: string;
  categoryName: string;
  totalValue: number;
  months: number[];
  centers: string[];
}

export interface SheetDetail {
  id: number;
  name: string;
  title: string;
  kind: string;
  visible: number;
  verified?: number;
  categories: CategoryBlock[];
  monthTotals: number[];
  total: number;
  distributions?: ValueDistribution[];
}

export interface Activity {
  id: number;
  code: string;
  description: string;
  empenho: string | null;
}

export interface Empenho {
  id: number;
  code: string;
  description: string;
}

export interface OracleEmpenho {
  code: string;
  description: string;
  imported: boolean;
}

export interface ActivityRealizadoLink {
  id: number;
  safraId: number;
  activityId: number;
  activityCode: string;
  activityName: string;
  source: "contrato_variavel" | "contrato_fixo" | "insumo" | "materiais";
  sourceLabel: string;
  sourceCode: string;
  sourceCodeLabel: string;
  matchBy: string;
  oracleLabel: string | null;
}

export interface ActivityLinkSource {
  id: ActivityRealizadoLink["source"];
  label: string;
  codeLabel: string;
  implemented: boolean;
}

export interface ActivityLinksData {
  safraId: number;
  sources: ActivityLinkSource[];
  links: ActivityRealizadoLink[];
}

export interface ActivitySourceOptionsData {
  source: ActivityRealizadoLink["source"];
  matchBy?: string;
  codeLabel: string;
  fromDate: string;
  toDate: string;
  items: { code: string; label: string; count: number; total: number }[];
}

export interface OracleActivity {
  code: string;
  description: string;
  unit: string;
  imported: boolean;
}

export interface Fazenda {
  id: number;
  code: string;
  description: string;
  distancia: number | null;
}

export interface OracleFazenda {
  code: string;
  description: string;
  distancia: number | null;
  imported: boolean;
}

export interface OracleMaterial {
  code: string;
  description: string;
  unit: string;
  grupo?: string;
  imported: boolean;
}

export interface Material {
  id: number;
  code: string;
  description: string;
  tipo: "E" | "G";
  empenho: string | null;
  valor: number | null;
  grupo?: string | null;
}

export interface MaterialEntradaSaidaItem {
  tipo: string;
  grupo: string;
  codFamilia: number | null;
  codGrupoMaterial: number | null;
  codObjetoCusto: number | null;
  objetoCusto: string;
  codMaterial: number | null;
  codigo: string;
  descricao: string;
  qtdeEntrada: number;
  qtdeSaida: number;
  valorEntrada: number;
  valorSaida: number;
  diferenca: number;
}

export interface MaterialEntradaSaidaRelatorio {
  filtros: { dataInicio: string | null; dataFim: string | null; tipos: string[] };
  tipos: string[];
  itens: MaterialEntradaSaidaItem[];
  totais: {
    qtdeEntrada: number;
    qtdeSaida: number;
    valorEntrada: number;
    valorSaida: number;
    saldo: number;
    pctSaida: number | null;
  };
}

export interface ControleEstoqueItem {
  codMaterial: number | null;
  codigo: string;
  descricao: string;
  unidade: string;
  grupo: string;
  codFamilia: number | null;
  codGrupoMaterial: number | null;
  codAlmoxarifado: number | null;
  almoxarifado: string;
  ano: number | null;
  mes: number | null;
  anomes: number | null;
  quantidade: number;
}

export interface ControleEstoqueData {
  filtros: { anomes: number | null; busca: string | null; almoxarifado: number | null };
  periodo: { anomes: number | null; ano: number | null; mes: number | null; label: string };
  almoxarifados: { codigo: number; descricao: string }[];
  itens: ControleEstoqueItem[];
  totais: { materiais: number; quantidade: number; almoxarifados: number };
}

export type GestaoMateriaisPrioridade = "critico" | "alto" | "medio" | "ok";

export interface GestaoMateriaisItem {
  codMaterial: number;
  descricao: string;
  tipo: string;
  grupo: string;
  codAlmoxarifado: number | null;
  codObjetoCusto: number | null;
  saida: number;
  mediaMes: number;
  estoqueAtual: number;
  coberturaMeses: number | null;
  ultimaEntrada: string | null;
  qtdSugerida: number;
  prioridade: GestaoMateriaisPrioridade;
  precoMedio: number | null;
  valorTotal: number;
}

export interface GestaoMateriaisGrupo {
  tipo: string;
  label: string;
  itens: GestaoMateriaisItem[];
  totais: {
    saida: number;
    mediaMes: number;
    estoqueAtual: number;
    qtdSugerida: number;
    valorTotal: number;
  };
}

export interface GestaoMateriaisData {
  filtros: {
    dataInicio: string | null;
    dataFim: string | null;
    tipos: string[];
    almoxarifado: number | null;
    codMaterial: number | null;
    codObjetoCusto: number | null;
    mesesEstoque: number;
    mesesSugerida: number;
  };
  tipos: string[];
  almoxarifados: Array<{ codigo: number; descricao: string }>;
  materiais: Array<{ codigo: number; descricao: string }>;
  objetosCusto: Array<{ codigo: number; descricao: string }>;
  grupos: GestaoMateriaisGrupo[];
  totais: GestaoMateriaisGrupo["totais"];
}

export interface IrrigacaoEquipLinha {
  tipo: string;
  codEquipamento: number;
  areaProgramada: number;
  areaAplicada: number;
  hrsProgramada: number;
  hrsTrabalhadas: number;
  efiArea: number | null;
  efiHoras: number | null;
  mmHa: number | null;
}

export interface IndicadoresIrrigacaoData {
  filtros: {
    dataInicio: string;
    dataFim: string;
    codEquipamento: number | null;
    codFazenda: number | null;
    campo: string | null;
    tipoEquipamento: string | null;
  };
  kpis: {
    areaProgramada: number;
    areaAplicada: number;
    eficiencia: number | null;
    mmHa: number | null;
    volumeM3: number;
  };
  programadoRealizado: IrrigacaoEquipLinha[];
  paradasPorMotivo: Array<{ motivo: string; horas: number }>;
  paradasPorEquipamento: Array<{ codEquipamento: number; horas: number }>;
  eficienciaPorCampo: Array<{ campo: string; efiArea: number | null; efiHoras: number | null }>;
  periodosProgramados: Array<{
    dataInicio: string;
    dataFim: string;
    areaProgramada: number;
    areaAplicada: number;
    eficiencia: number | null;
  }>;
  opcoes: {
    equipamentos: Array<{ codEquipamento: number; descricao: string; tipo: string }>;
    fazendas: Array<{ codFazenda: number; descricao: string }>;
    campos: string[];
    tipos: string[];
  };
  horasParadasTotal: number;
}

export type IrrigacaoDashboardSistemaId = "HIDRO_ROLL" | "MOTOR_BOMBA" | "PIVOT";

export interface IrrigacaoDashboardMes {
  key: string;
  label: string;
  mmRealizado: number | null;
  mmProgramado: number | null;
  atingiuMeta: boolean | null;
  disponibilidade: number | null;
}

export interface IrrigacaoDashboardBloco {
  id: string;
  titulo: string;
  areaHa: number | null;
  mmAcumuladoSafra: number | null;
  mmProjetadoSafra: number | null;
  mmAcumuladoMes: number | null;
  mmProjetadoMes: number | null;
  eficienciaOperacional: number | null;
  meses: IrrigacaoDashboardMes[];
}

export interface IrrigacaoDashboardData {
  filtros: {
    safraCode: string | null;
    dataInicio: string;
    dataFim: string;
    sistemas: IrrigacaoDashboardSistemaId[];
  };
  sistemas: Array<{ id: IrrigacaoDashboardSistemaId; label: string }>;
  geral: IrrigacaoDashboardBloco;
  sistemasBlocos: IrrigacaoDashboardBloco[];
  campos: IrrigacaoDashboardBloco[];
}

export type ManutencaoStatus = "em_dia" | "a_vencer" | "vencido" | "em_execucao" | "sem_plano";

export interface ManutencaoEquipamentoItem {
  codEquipamento: number;
  descricao: string | null;
  kmAtual: number | null;
  codTipoEquipamento: number | null;
  tipoDescricao: string | null;
  categoria: string;
  status: ManutencaoStatus;
  kmUltimaPrev: number | null;
  kmRodado: number | null;
  kmLimite: number | null;
  kmRestante: number | null;
  periodoPlano: number | null;
  planoDescricao: string | null;
  codPlanoPrevencao: number | null;
  /** Plano da última OS entre os planos de renovação configurados na categoria. */
  codPlanoUltimaRenovacao?: number | null;
  planoUltimaRenovacaoDescricao?: string | null;
  dataUltimaPrev: string | null;
  anoUltimaOs: number | null;
  numeroUltimaOs: number | null;
  /** Quantidade de planos distintos já realizados (OS preventiva encerrada). */
  qtdePlanos?: number;
  codEquipamentoAssociado: number | null;
  equipamentoAssociadoDescricao: string | null;
  osAberta: boolean;
  alertas: Array<{
    sistemaDescricao: string | null;
    componenteDescricao: string | null;
    status: ManutencaoStatus;
    kmRodado: number | null;
    limite: number | null;
  }>;
}

export interface ManutencaoProgramadaQuadroData {
  atualizadoEm: string;
  alertaPct: number;
  totais: {
    emDia: number;
    aVencer: number;
    vencido: number;
    emExecucao: number;
    semPlano: number;
    total: number;
  };
  categorias: Array<{
    categoria: string;
    codTipoEquipamento: number | null;
    equipamentos: ManutencaoEquipamentoItem[];
    emDia: number;
    aVencer: number;
    vencido: number;
    emExecucao: number;
    semPlano: number;
  }>;
  equipamentos: ManutencaoEquipamentoItem[];
}

export interface ManutencaoComponenteItem {
  codEquipamento: number;
  codSistema: number;
  sistemaDescricao: string | null;
  codComponente: number;
  componenteDescricao: string | null;
  limiteKmRodado: number | null;
  limiteHsTrabalhada: number | null;
  qtdeLtTroca: number | null;
  kmAtualEquipamento: number | null;
  kmNaUltimaTroca: number | null;
  kmRodado: number | null;
  dataAbertura: string | null;
  dtUltimaTroca: string | null;
  codMaterial: number | null;
  materialDescricao: string | null;
  materiais: Array<{ codMaterial: number; descricao: string | null; quantidade: number | null }>;
  status: ManutencaoStatus;
}

export interface ManutencaoProgramadaComponentesData {
  atualizadoEm: string;
  alertaPct: number;
  codEquipamento: number | null;
  totais: {
    emDia: number;
    aVencer: number;
    vencido: number;
    semPlano: number;
    total: number;
  };
  componentes: ManutencaoComponenteItem[];
}

export interface ManutencaoProgramadaConfig {
  ignoredComponents: string[];
  categoryTracking?: Record<string, "padrao" | "dias" | "componentes" | "plano_horas">;
  /** Plano cujo limite (km/h) é usado no acompanhamento da categoria. */
  categoryPlanIds?: Record<string, number>;
  /** Planos cuja última OS zera o acumulado (renovação) da categoria. */
  categoryPlanDependencias?: Record<string, number[]>;
}

export interface ManutencaoPlanoPrevencaoItem {
  codPlanoPrevencao: number;
  descricao: string | null;
  kmLimite: number | null;
  periodo: number | null;
}

export interface MaterialLastPrice {
  code: string;
  price: number;
  count?: number;
  prices?: number[];
  dates?: (string | null)[];
  costPrice: number | null;
  date: string | null;
  invoice: number | null;
  quantity: number | null;
}

export interface CostObject {
  id: number;
  code: string;
  description: string;
}

export interface EquipmentCostObjectMapping {
  code: string;
  costObjectCodes: number[];
}

export interface CostObjectHourRate {
  safraId: number;
  safraLabel: string;
  cost: number;
  hours: number;
  costPerHour: number | null;
}

export interface CostObjectHourCost {
  code: string;
  costObjectId: number | null;
  description: string;
  rates: CostObjectHourRate[];
}

export interface CostObjectHourCostData {
  safras: { id: number; label: string }[];
  items: CostObjectHourCost[];
}

export interface EquipmentCatalogItem {
  code: string;
  description: string;
}

export interface EquipmentHourCost {
  code: string;
  description: string;
  rates: CostObjectHourRate[];
}

export interface EquipmentHourCostData {
  safras: { id: number; label: string }[];
  costObject: { id: number; code: string; description: string };
  items: EquipmentHourCost[];
}

export interface ApontamentoEquipmentRate {
  safraId: number;
  safraLabel: string;
  hours: number;
  area: number;
  hoursHa: number;
  apontamentos: number;
  cost: number;
  runHours: number;
  costPerHour: number | null;
  litros: number;
  litrosPorHa: number;
  fuelCost: number;
  costPerLiter: number | null;
}

export interface ApontamentoEquipmentItem {
  code: string;
  description: string;
  rates: ApontamentoEquipmentRate[];
}

export interface ApontamentoEquipmentData {
  activityId: number;
  activityCode: string;
  activityName: string;
  operations: { code: string; label: string }[];
  safras: { id: number; label: string }[];
  fromDate: string;
  toDate: string;
  items: ApontamentoEquipmentItem[];
}

export interface CatalogCategory {
  id: number;
  name: string;
}

export interface PremiseOption {
  key: string;
  label: string;
}

export interface BudgetContribution {
  premiseKey: string;
  sheetId: number;
  sheetTitle: string;
  category: string;
  activityKey: string;
  activityLabel: string;
  objectKey: string;
  objectLabel: string;
  months: number[];
  kind?: "activity" | "material" | "line";
  materialKey?: string | null;
  materialLabel?: string | null;
  grupo?: string | null;
  qtyHa?: number | null;
  rateHa?: number | null;
  shareRateHa?: number | null;
  areaHa?: number | null;
  areaPct?: number | null;
  applications?: number | null;
}

export interface RealizadoObject {
  sheetId: number | null;
  sheetTitle?: string;
  key: string;
  label: string;
  months: number[];
}

export interface ResumoRow {
  key: string;
  label: string;
  months: number[];
  total: number;
  sheetId?: number;
}

export interface ResumoData {
  months: string[];
  contributions?: BudgetContribution[];
  rows: { sheetId: number; name: string; title: string; months: number[]; total: number }[];
  views?: {
    costCenter: ResumoRow[];
    category: ResumoRow[];
    activity: ResumoRow[];
    subprocess?: ResumoRow[];
  };
  totals: number[];
  total: number;
}

export interface RealizadoActivity {
  key: string;
  label: string;
  months: number[];
  sources?: { key: string; label: string; months: number[] }[];
}

export interface CompareRow {
  key: string;
  label: string;
  sheetId?: number;
  origin?: boolean;
  orcadoAnnualOnly?: boolean;
  subprocessoKey?: string;
  subprocessoLabel?: string;
  tons?: number;
  orcado: number[];
  realizado: number[];
  variacao: number[];
  orcadoTotal: number;
  realizadoTotal: number;
  variacaoTotal: number;
  sources?: CompareRow[];
}

export interface OrcadoRealizadoData {
  months: string[];
  safraId?: number;
  anomesFrom: number;
  anomesTo: number;
  safraLabel: string;
  contributions?: BudgetContribution[];
  realizadoByObject?: RealizadoObject[];
  realizadoByActivity?: RealizadoActivity[];
  grupoGasto?: CompareRow[];
  grupoGastoAgricola?: CompareRow[];
  unitsBySheet?: { sheetId: number; units: number }[];
  views: {
    costCenter: CompareRow[];
    category: CompareRow[];
    activity: CompareRow[];
    costObject: CompareRow[];
    safra?: CompareRow[];
  };
  totals: {
    orcado: number[];
    realizado: number[];
    variacao: number[];
  };
  totalOrcado: number;
  totalRealizado: number;
  totalVariacao: number;
}

export interface CustoDashboardDetalhe {
  periodo?: string;
  anomes?: string;
  codOperacaoAgricola?: number | null;
  codEquipamento?: number | null;
  codFazenda?: string | null;
  codTalhao?: number | null;
  horas?: number;
  litros?: number;
  custoOficina?: number;
  custoTransporte?: number;
  custoMecanizacao?: number;
  custoCombustivel?: number;
  custoMaterial?: number;
  custoInsumo?: number;
  custoServicoTerceiro?: number;
  custoFuncionario?: number;
  custoOperacao?: number;
  custoTotal?: number;
  custoPorHora?: number | null;
  litrosPorHora?: number | null;
  haPorHora?: number | null;
  itens?: {
    tipo: string;
    codMaterial?: number | null;
    descricaoMaterial?: string | null;
    quantidade?: number;
    litros?: number;
    custo?: number;
  }[];
}

export interface CustoDashboardAtividade {
  chave: string;
  objetoCusto?: number | string | null;
  descricao?: string;
  descricaoSubprocesso?: string | null;
  horas?: number;
  litros?: number;
  custoOficina?: number;
  custoTransporte?: number;
  custoMecanizacao?: number;
  custoCombustivel?: number;
  custoMaterial?: number;
  custoInsumo?: number;
  custoServicoTerceiro?: number;
  custoFuncionario?: number;
  custoOperacao?: number;
  custoTotal?: number;
  custoPorHora?: number | null;
  litrosPorHora?: number | null;
  haPorHora?: number | null;
  detalhes?: CustoDashboardDetalhe[];
}

export interface CustoDashboardRateioDestino {
  objetoCusto: number;
  descricao?: string | null;
  negocio?: number | null;
  valor: number;
  qtdLinhas?: number;
}

export interface CustoDashboardRateioNegocio {
  negocio: number;
  descricaoNegocio: string;
  totalRateado: number;
  qtdDestinos: number;
  destinos: CustoDashboardRateioDestino[];
}

export interface CustoDashboardCentroCusto {
  objetoCusto: number | string | null;
  descricao?: string | null;
  negocio?: number | null;
  processo?: number | null;
  subprocesso?: number | null;
  horas?: number;
  custoOficina?: number;
  custoTransporte?: number;
  custoMecanizacao?: number;
  custoCombustivel?: number;
  custoMaterial?: number;
  custoInsumo?: number;
  custoServicoTerceiro?: number;
  custoFuncionario?: number;
  totalRateado: number;
  arrendamento: number;
  outrosCustos: number;
  totalCentro: number;
}

export interface CustoDashboardData {
  filtros: Record<string, unknown>;
  resumo: {
    totalGeral: number;
    totalRateado?: number;
    totalLancamentoConsolidado?: number;
    diferenca?: number;
    totalOperacao: number;
    totalOperacaoComFuncionario?: number;
    totalInsumo: number;
    totalServicoTerceiro: number;
    totalFuncionario: number;
    totalArrendamento: number;
    totalOutrosCustos: number;
    custoMedioPorHora: number | null;
    totalHoras: number;
    totalOficina?: number;
    totalOficinaRetida?: number;
    totalCombustivel?: number;
    totalMaterial?: number;
    totalTransporte?: number;
    totalMecanizacao?: number;
    qtdAtividades: number;
    qtdLinhas: number;
    qtdDestinos?: number;
    porVia?: { via: string; valor: number }[];
    porOrigemNegocio?: { negocio: number; valor: number }[];
  };
  composicao: {
    operacaoVsInsumo: { chave: string; label: string; valor: number }[];
    operacaoDetalhe: { chave: string; label: string; valor: number }[];
    porEstagio?: { chave: string; label: string; valor: number }[];
  };
  centrosCusto: CustoDashboardCentroCusto[];
  atividades: CustoDashboardAtividade[];
  rateioPorNegocioOrigem?: CustoDashboardRateioNegocio[];
}

export interface CustoMatrizCelula {
  valor: number;
  pct: number;
  rHa: number | null;
}

export interface CustoMatrizLinha {
  chave: string;
  label: string;
  secao: string;
  grupo: string;
  indent: number;
  tipo: string;
  celulas: Record<string, CustoMatrizCelula>;
}

export interface CustoMatrizFonteUnidade {
  sheetId?: number;
  sheetName?: string | null;
  sheetTitle?: string;
  units?: number;
  configurado?: boolean;
  sourceKind?: string | null;
  sourceLabel?: string | null;
  metric?: string | null;
  metricLabel?: string | null;
  nota?: string;
}

export interface CustoMatrizOrigem {
  linhaChave: string;
  secao: string;
  coluna: string;
  origemObjeto: number | null;
  origemDescricao: string | null;
  destinoObjeto: number | null;
  destinoDescricao: string | null;
  grupoEmpenhoCodigo: number | null;
  grupoEmpenho: string | null;
  empenhoCodigo: number | null;
  empenho: string | null;
  itemCodigo: number | null;
  item: string | null;
  valor: number;
}

export interface ArrendamentoSafra {
  safraId: number;
  label: string;
  anomesInicio: string;
  anomesFim: string;
  custo: number | null;
  area: number | null;
  rHa: number | null;
  possuiCustos: boolean;
  fonteArea?: string;
  erro?: string;
}

export interface CustoMatrizSubprocessoData {
  toneladas?: number | null;
  origens?: CustoMatrizOrigem[];
  colunas: {
    key: string;
    label: string;
    haKey: string;
    sheetName?: string | null;
    total: number;
    hectareas: number;
    rHaTotal: number | null;
  }[];
  linhas: CustoMatrizLinha[];
  hectareas: Record<string, number>;
  fontesUnidades?: Record<string, CustoMatrizFonteUnidade>;
  resumo: { totalPool: number; totalMatriz: number; totalForaMatriz?: number; qtdLinhasOracle: number };
  logica?: Record<string, string>;
  estagios?: {
    toneladas: number | null;
    hectares: { planta: number; soca: number; irrigacao?: number };
    parametros?: {
      areaPlantio: number;
      areaSoca: number;
      areaIrrigacao?: number;
      areaTotal: number;
      toneladas: number | null;
      produtividade: number | null;
      premissa: {
        produtividade: number;
        areaPlanta: number;
        areaSoca: number;
        areaTotal: number;
        moagem: number;
      } | null;
    };
    linhas: {
      chave: string;
      label: string;
      nivel: "grupo" | "item" | "total" | "preco" | "margem";
      valor: number | null;
      rHa: number | null;
      rTon: number | null;
      rKgAtr: number | null;
      pct: number | null;
    }[];
  };
}

export interface CustoDimensaoOption {
  codigo: number;
  descricao: string;
  valor?: string;
  rotulo?: string;
  processo?: number;
}

export interface CustoDimensoesData {
  negocios: CustoDimensaoOption[];
  processos: CustoDimensaoOption[];
  subprocessos: CustoDimensaoOption[];
  atividades: CustoDimensaoOption[];
}

export interface CustoObjetoCustoRow {
  codObjetoCusto: number;
  descricao: string;
  negocio?: number;
  processo?: number;
  subprocesso?: number;
  atividade?: number;
}

export type UnRealizadoKind = "apontamento_terceiro" | "apontamento_maquinas" | "irrigacao";
export type UnRealizadoMetric = "area" | "quantity";

export interface UnRealizadoSource {
  id: number;
  sheetId: number;
  sheetName: string;
  sheetTitle: string;
  sourceKind: UnRealizadoKind;
  sourceLabel: string;
  metric: UnRealizadoMetric;
  metricLabel: string;
  operations: { code: string; label: string }[];
  units: number | null;
  fromDate: string;
  toDate: string;
}

export interface UnRealizadoSourcesData {
  fromDate: string;
  toDate: string;
  sources: UnRealizadoSource[];
}

export interface Safra {
  id: number;
  code: string;
  label: string;
}

export interface PremissaCopy {
  id: number;
  sourceKey: string;
  sourceName: string;
  sourceScope: "current" | "previous";
  sourceSafraLabel: string;
  startMonth: number;
  endMonth?: number;
  occupied: number[];
}

export interface PremissaSubprocess {
  key: string;
  name: string;
  suffix: string;
  builtin: boolean;
  qty: { row: number; col: number; value: number } | null;
  start: { row: number; col: number; value: string } | null;
  end: { row: number; col: number; value: string } | null;
  months: number[];
  copies: PremissaCopy[];
  manualMonths?: boolean;
  kind?: "subprocess" | "producao_propria";
}

export interface PreviousPremissaSubprocess {
  key: string;
  name: string;
  suffix: string;
  months: number[];
  kind?: "subprocess" | "producao_propria";
}

export interface DashboardData {
  kpis: {
    moagem: number;
    moagemManual: number;
    tch: number;
    areaVerao: number;
    areaInverno: number;
    areaSoca: number;
    areaPlanta: number;
    inicioColheita: string;
    fimColheita: string;
    inicioManual: string;
    fimManual: string;
    inicioVerao: string;
    fimVerao: string;
    inicioInverno: string;
    fimInverno: string;
    inicioPlanta: string;
    fimPlanta: string;
    inicioSoca: string;
    fimSoca: string;
    months: {
      label: string;
      year: number;
      tons: number;
      tonsManual: number;
      haVerao: number;
      haInverno: number;
      haSoca: number;
      haPlanta: number;
    }[];
    previousSafra?: Safra | null;
    previousSubprocesses?: PreviousPremissaSubprocess[];
    subprocesses?: PremissaSubprocess[];
  };
  resumo: ResumoData;
  reportSubprocesses?: PremiseOption[];
  costPerTonBySafra?: {
    safraId: number;
    code: string;
    label: string;
    moagem: number;
    orcamentoTotal: number;
    costPerTon: number | null;
    current: boolean;
    year: number;
  }[];
  budgetCompareBySafra?: {
    safras: {
      safraId: number;
      code: string;
      label: string;
      moagem: number;
      orcamentoTotal: number;
      costPerTon: number | null;
      current: boolean;
      year: number;
    }[];
    costCenter: {
      key: string;
      label: string;
      bySafra: Record<string, number>;
      values: number[];
      total: number;
    }[];
    category: {
      key: string;
      label: string;
      bySafra: Record<string, number>;
      values: number[];
      total: number;
    }[];
  };
  costCenters: { sheetId: number; name: string; title: string; total: number }[];
}

export interface SafrasData {
  safras: Safra[];
  currentId: number;
  createdId?: number;
  suggestedCode?: string;
}

export type EntradaCanaImportType = "maquina" | "caminhao" | "tempo_patio";
export type EntradaCanaOperationMode = "insert" | "update";
export type EntradaCanaTipoColheitaMode = "planilha" | "MECANIZADA" | "MANUAL";

export interface EntradaCanaImportOptions {
  importType: EntradaCanaImportType;
  apiUrl?: string;
  tipoColheitaMode: EntradaCanaTipoColheitaMode;
  operationMode: EntradaCanaOperationMode;
  safraSelect?: string;
  safraCustom?: string;
  sheetName?: string;
  maxRows?: number | null;
  headerRow?: number;
  startRow?: number;
  dryRun: boolean;
  autoHeader: boolean;
}

export interface EntradaCanaFileInput {
  name: string;
  sheetName?: string;
  grid: unknown[][];
}

export interface EntradaCanaImportStats {
  processed: number;
  ok: number;
  err: number;
  skip: number;
  dupSkip: number;
  headerRowNum: number | null;
}

export interface EntradaCanaImportResult {
  stats: EntradaCanaImportStats;
  okLog: string[];
  errLog: string[];
  logLines: string[];
}

export interface EntradaCanaConfig {
  apiUrls: { maquina: string; caminhao: string; tempo_patio: string };
}

export interface ColheitaListResumo {
  totalLinhas?: number;
  paginasOrds?: number;
  pesoLiquidoTotal?: number;
  pesoTotal?: number;
  qtdEquipamentos?: number;
  truncado?: boolean;
  totalCaminhoes?: number;
  totalMaquinas?: number;
  totalLinhasBase?: number;
  totalFazendas?: number;
  comVinculo?: number;
  semVinculo?: number;
  comCodSistema?: number;
  totalArea?: number;
  tchMedio?: number | null;
  totalProducao?: number;
}

export interface ColheitaCaminhaoRow {
  pesagem: number | null;
  guia: number | null;
  caminhao: number | null;
  talhao: number | null;
  etapa: number | null;
  data: string | null;
  intQueima: number | null;
  pesoBruto: number | null;
  pesoTara: number | null;
  pesoLiquido: number | null;
  fazenda: string | null;
  tipoColheita: string | null;
  safra: string | null;
  atr: number | null;
  empresa: string | null;
  codEquipamento: number | null;
}

export interface ColheitaMaquinaRow {
  maquina: number | null;
  fazenda: string | null;
  talhao: number | null;
  dataColheita: string | null;
  tipoColheita: string | null;
  tipoCana: string | null;
  peso: number | null;
  impMineral: number | null;
  safra: string | null;
  codEquipamento: number | null;
}

export interface LiberacaoColheitaRow {
  dataLiberacao: string | null;
  numeroLiberacao: number | null;
  codFazenda: number | null;
  fazenda: string | null;
  talhao: number | null;
  area: number | null;
  tchEstimado: number | null;
  producaoEstimada: number | null;
  folha: string | null;
  tipoColheita: string | null;
  tipoCana: string | null;
  codFornecedor: number | null;
  fornecedor: string | null;
}

export interface ColheitaEncerramentoOrdensResult {
  filtros: {
    dataInicio: string;
    dataFim: string;
    dataEncerramento: string;
    usuarioEncerramento: string;
    obsEncerramento: string;
  };
  resumo: {
    linhasAlteradas: number;
  };
}

export interface CaminhaoTerceiroVinculo {
  id: number;
  caminhao: string;
  nomeTerceiro: string;
  dataInicio: string;
  dataFim: string;
}

export interface EquipamentoTerceiro {
  codEquipamento: string;
  createdAt: string;
}

export type ResumoTransporteModo = "proprios" | "terceiros" | "ambos";

export interface ResumoTransporteCanaData {
  filtros: {
    safraCode: string | null;
    reportSafraCode: string;
    dataInicio: string | null;
    dataFim: string | null;
    refDate: string;
    modo?: ResumoTransporteModo;
    caminhoes: string[];
    terceiros: string[];
  };
  resumo: {
    totalLinhasEntrada: number;
    truncado?: boolean;
    totalGeral: {
      equipamentos: Record<string, number>;
      colhido: number;
      valorTotal: number;
    };
  };
  colunas: Array<{ key: string; label: string }>;
  equipamentos: string[];
  blocos: Array<{
    tipoColheita: string;
    linhas: Array<{
      fazenda: string;
      equipamentos: Record<string, number>;
      colhido: number;
      raio: number | null;
      precoTon: number | null;
      valorTotal: number;
    }>;
    totais: {
      equipamentos: Record<string, number>;
      colhido: number;
      valorTotal: number;
    };
  }>;
  parceiros: Array<{
    nome: string;
    equipamentos: Record<string, number>;
    total: number;
  }>;
}

export interface IndicadoresProducaoLinha {
  equipTag: string;
  codEquipamento: number;
  toneladaColhida: number;
  litrosCombustivel: number;
  hrsMotor: number;
  hrsElevador: number | null;
  kmRodados: number | null;
  ltTon: number | null;
  ltHr: number | null;
  tonHrMotor: number | null;
  tonHrElevador: number | null;
  tonDia: number | null;
  kmLt: number | null;
  tonViagem: number | null;
  mediaDiaria: number | null;
  custoCombustivel?: number;
  rsTon?: number | null;
  litrosPosto?: number;
  kmhsPosto?: number;
  parado: boolean;
  viagens: number | null;
  horasPotenciais?: number;
  horasOficina?: number;
  disponibilidadePct?: number | null;
}

export interface IndicadoresColheitaQualidadeLinha {
  label: string;
  pctPerda: number | null;
  tonHaPerda: number | null;
  amostras: number;
  mesRef?: string;
  codEquipamento?: number | null;
  codOperador?: number | null;
  codTipoPerda?: number | null;
  quantidade?: number;
}

export interface IndicadoresColheitaQualidadeOperadorLinha extends IndicadoresColheitaQualidadeLinha {
  equipamentos: IndicadoresColheitaQualidadeLinha[];
}

export type PerdasAnaliticoAgrupamento =
  | "tipoCorte"
  | "equipamento"
  | "operador"
  | "fazenda"
  | "frente"
  | "turno"
  | "mes"
  | "nenhum";

export interface PerdasAnaliticoLinha {
  fazZonaTalhao: string;
  areaRealizada: number | null;
  tch: number | null;
  numeroAmostra: number;
  dataAmostra: string;
  areaAmostra: number | null;
  estilhaco: number;
  desconte: number;
  canaAgarrada: number;
  canaPicada: number;
  tolete: number;
  tocoMecanizado: number;
  talhaoEncerrado: string;
  bituca: string;
  totalPerdas: number;
  perdasTcHa: number;
  pctPerdasEst: number | null;
  pctPerdasReal: number | null;
}

export interface PerdasColheitaAnaliticoData {
  filtros: {
    dataInicio: string;
    dataFim: string;
    agrupamento: PerdasAnaliticoAgrupamento;
  };
  grupos: Array<{
    chave: string;
    label: string;
    linhas: PerdasAnaliticoLinha[];
    subtotal?: PerdasAnaliticoLinha | null;
  }>;
  totais: PerdasAnaliticoLinha | null;
  amostras: number;
  equipamentosOpcoes?: Array<{
    codEquipamento: number;
    label: string;
  }>;
}

export interface IndicadoresColheitaQualidadeData {
  resumo: {
    pctPerda: number | null;
    tonHaPerda: number | null;
    amostras: number;
    impurezaMineral?: number | null;
  };
  linhaTempo: IndicadoresColheitaQualidadeLinha[];
  porEquipamento: IndicadoresColheitaQualidadeLinha[];
  porTipoPerda: IndicadoresColheitaQualidadeLinha[];
  porOperador: IndicadoresColheitaQualidadeOperadorLinha[];
  porFazenda: IndicadoresColheitaQualidadeLinha[];
  impurezaPorEquipamento?: Array<{
    codEquipamento: number;
    label: string;
    impurezaMineral: number | null;
    amostras: number;
  }>;
  equipamentosOpcoes?: Array<{
    codEquipamento: number;
    label: string;
  }>;
}

export interface IndicadoresColheitaProducaoData {
  filtros: { dataInicio: string | null; dataFim: string | null; refDate: string; dias: number; diasColheitaColhedora?: number };
  resumo: {
    categorias: Array<{
      categoria: string;
      label: string;
      total: number;
      parado: number;
      rodando: number;
      disponibilidade: number | null;
    }>;
    kpiCards: Array<{
      id: string;
      label: string;
      icon: string;
      tipos: number[];
      classificacoes: number[];
      total: number;
      parado: number;
      rodando: number;
      disponibilidade: number | null;
      equipamentos: Array<{
        codEquipamento: number;
        descricao: string | null;
        parado: boolean;
      }>;
    }>;
    truncadoEntrada?: boolean;
    truncadoHoras?: boolean;
  };
  frentes: Array<{
    codFrente: string;
    label: string;
    colhedora: { parado: number; rodando: number };
    transbordo: { parado: number; rodando: number };
    dispColhedora: number | null;
    dispTransbordo: number | null;
    dispGeral: number | null;
  }>;
  disponibilidadeDiaria: Array<{
    data: string;
    colhedora: { total: number; parado: number; rodando: number; disponibilidade: number | null };
    transbordo: { total: number; parado: number; rodando: number; disponibilidade: number | null };
    toneladaColhida?: number;
  }>;
  motivosParada?: {
    linhas: Array<{ motivo: string; horas: number; qtd: number }>;
    horasTotal: number;
  };
  tabelas: {
    colhedora: { linhas: IndicadoresProducaoLinha[]; totais: IndicadoresProducaoLinha | null };
    trator: { linhas: IndicadoresProducaoLinha[]; totais: IndicadoresProducaoLinha | null };
    caminhao: { linhas: IndicadoresProducaoLinha[]; totais: IndicadoresProducaoLinha | null };
  };
  qualidade?: IndicadoresColheitaQualidadeData | null;
}

export interface ParadaColheitaEvento {
  id: string | number | null;
  motivo: string;
  inicio: string;
  fim: string;
  horas: number;
}

export interface ParadasColheitaData {
  filtros: { dataInicio: string; dataFim: string };
  resumo: { horasTotal: number; qtd: number; qtdMotivos: number };
  motivos: Array<{ motivo: string; horas: number; qtd: number }>;
  eventos: ParadaColheitaEvento[];
}

export interface RelatorioDiarioProducaoData {
  filtros: { data: string; dataInicio?: string; dataSolicitada?: string; safraInicio: string };
  kpis: {
    moagemReal: number;
    pctMoagemReal: number | null;
    canaPropria: number;
    pctPropria: number | null;
    canaFornecedor: number;
    pctFornecedor: number | null;
    previsao24h: number;
    raioMedio: number | null;
    necessidadeFrota: number;
    frotaDisponivel: number;
    pctDisponibilidadeFrota: number | null;
    produtividadeHistoricaTh?: number | null;
    horasMaquinaDisponiveis?: number;
    capacidadeEstimada?: number | null;
    pctCapacidadeCota?: number | null;
    margemDeficit?: number | null;
    capacidadeInconsistente?: boolean;
    diasHistoricosUsados?: number;
  };
  indicadorPrincipal: Array<{
    frente: string;
    data: string | null;
    cotaUsina: number | null;
    realizado: number | null;
    colhedoras: number;
    horasMaquina: number | null;
    produtividadeHistorica: number | null;
    capacidadeNecessaria: number | null;
    capacidadeEstimada: number | null;
    diferenca: number | null;
    percentualCota: number | null;
    capacidadeSuficiente: boolean | null;
    status: string;
    estimativaInconsistente?: boolean;
    naoAtingimento?: {
      gap: number;
      atingiu: boolean;
      realizado: number;
      cota: number;
      causas: Array<{ chave: "capacidade" | "execucao"; label: string; toneladas: number; pct: number }>;
    };
  }>;
  tiposColheita: Array<{
    key: string;
    label: string;
    toneladas: number;
    percentual: number;
    impMineral: number | null;
    impVegetal: number | null;
    umidade: number | null;
    atr: number | null;
  }>;
  total: {
    key: string;
    label: string;
    toneladas: number;
    percentual: number;
    impMineral: number | null;
    impVegetal: number | null;
    umidade: number | null;
    atr: number | null;
  };
  grupos: Array<{
    key: string;
    label: string;
    toneladas: number;
    previsao24h: number;
  }>;
  gruposTotal: { toneladas: number; previsao24h: number };
  rodape: {
    diasSafra: number;
    moagemAcumulada: number;
    grupoDestaque: string | null;
    diasColheitaGrupo: number;
    mediaDiaGrupo: number;
    acumuladoGrupo: number;
  };
}

export interface IndicadoresDisponibilidadeEquipamentosData {
  meta: number;
  safraAtual: string;
  safraAnterior: string;
  dataInicio: string;
  dataFim: string;
  codTiposEquipamento: number[];
  meses: { key: string; label: string }[];
  linhas: {
    codTipo: number;
    label: string;
    highlight: boolean;
    meses: (number | null)[];
    safraAnterior: number | null;
    safraAtual: number | null;
    meta: number;
  }[];
}

export interface IndicadoresDisponibilidadePorTipoData {
  meta: number;
  safraAtual: string;
  safraAnterior: string;
  dataInicio: string;
  dataFim: string;
  meses: { key: string; label: string }[];
  linhas: {
    codTipo: number;
    label: string;
    highlight: boolean;
    meses: (number | null)[];
    safraAnterior: number | null;
    safraAtual: number | null;
    meta: number;
  }[];
}

export interface GestaoManutencaoOsFalhaItem {
  sequencial: number;
  contaNoMttr: boolean;
  values: Record<string, string>;
}

export interface GestaoManutencaoOsDetalhe {
  ordemServico: string;
  anoOs: number;
  numeroOs: number;
  codEquipamento: number | null;
  dataAbertura: string | null;
  dataEncerramento: string | null;
  aberta: boolean;
  box: string | null;
  colunas: Array<{ key: string; label: string }>;
  falhas: GestaoManutencaoOsFalhaItem[];
}

export interface GestaoManutencaoFalha {
  ordemServico: string;
  anoOs: number;
  numeroOs: number;
  codEquipamento: number;
  tipoEquipamento: string;
  categoria: string;
  dataAbertura: string;
  dataEncerramento: string | null;
  aberta: boolean;
  tempoReparoHoras: number;
}

export interface GestaoManutencaoMes {
  key: string;
  label: string;
  qtdFalhas: number;
  tempoReparoHoras: number;
  tempoOperacaoHoras: number;
  mttrHoras: number | null;
  mtbfHoras: number | null;
  disponibilidade: number | null;
  indisponibilidade: number | null;
}

export interface GestaoManutencaoData {
  ano: number;
  safra: string;
  categoria: string | null;
  codTipoEquipamento: number | null;
  codEquipamento: number | null;
  dataInicio: string;
  dataFim: string;
  filtros: {
    anos: number[];
    safras: { ano: number; label: string }[];
    categorias: string[];
    tipos: { codTipoEquipamento: number; label: string; categoria: string }[];
    equipamentos: {
      codEquipamento: number;
      label: string;
      categoria: string;
      codTipoEquipamento: number | null;
    }[];
  };
  meta: {
    mttrHoras: number;
    mtbfHoras: number;
    disponibilidade: number;
    codTipoEquipamento: number | null;
    metasPorTipo: Record<string, { metaMttrHoras: number; metaMtbfHoras: number; metaDisponibilidade: number }>;
  };
  kpis: {
    qtdFalhas: number;
    tempoReparoHoras: number;
    tempoOperacaoHoras: number;
    mttrHoras: number | null;
    mtbfHoras: number | null;
    disponibilidade: number | null;
    indisponibilidade: number | null;
  };
  meses: GestaoManutencaoMes[];
  falhasMttr: GestaoManutencaoFalha[];
  custo: {
    total: number;
    tipoMaterial: string | null;
    tiposMaterial: string[];
    codObjetoCusto: number | null;
    objetosCusto: Array<{ codObjetoCusto: number; label: string }>;
    porTipo: Record<"corretiva" | "preventiva" | "preditiva" | "melhoria", number>;
    percentual: Array<{
      tipo: "corretiva" | "preventiva" | "preditiva" | "melhoria";
      label: string;
      valor: number;
      percentual: number;
    }>;
    porMes: Array<{ key: string; label: string; valor: number }>;
    porFrota: Array<{ codEquipamento: number; label: string; valor: number }>;
    porComponente: Array<{ componente: string; label: string; valor: number }>;
    porObjetoCusto: Array<{ codObjetoCusto: number | null; objetoCusto: string; label: string; valor: number }>;
    analitico: Array<{
      data: string;
      codEquipamento: number | null;
      objetoCusto: string;
      codObjetoCusto: number | null;
      componente: string;
      tipoMaterial: string;
      quantidade: number;
      valorUnitario: number;
      valor: number;
      anoOrdemServico: number | null;
      numeroOrdemServico: number | null;
      ordemServico: string | null;
      tipo: "corretiva" | "preventiva" | "preditiva" | "melhoria";
      tipoLabel: string;
    }>;
  };
}

export type MonitoramentoOsStatus = "DENTRO DO PRAZO" | "EM ATRASO" | "INFORMAR PREVISÃO";

export interface MonitoramentoOsData {
  atualizadoEm: string;
  filtros: {
    box: number | null;
    codTipoEquipamento: number | null;
    codEquipamento: number | null;
    boxes: number[];
    tipos: { codTipoEquipamento: number; label: string }[];
    equipamentos: { codEquipamento: number; label: string; codTipoEquipamento: number | null }[];
  };
  kpis: { emAtraso: number; semPrevisao: number; totalAberta: number };
  status: Array<{ status: MonitoramentoOsStatus; qtd: number; percentual: number }>;
  prazoMedioPorBox: Array<{ box: number | null; label: string; prazoHoras: number }>;
  totalPorBox: Array<{ box: number | null; label: string; qtd: number }>;
  semPrevisaoPorBox: Array<{ box: number | null; label: string; qtd: number }>;
  itens: Array<{
    ano: number;
    os: number;
    codEquipamento: number | null;
    tipoEquipamento: string;
    box: number | null;
    dataAbertura: string | null;
    horaAbertura: string | null;
    dataPrevisao: string | null;
    horaPrevisao: string | null;
    status: MonitoramentoOsStatus;
    prazoHoras: number;
  }>;
}

export interface IndicadoresCombustivelLinha {
  origem: string;
  dataAbastecimento: string | null;
  codEquipamento: number | null;
  equipamentoDescricao?: string | null;
  codMaterial: number | null;
  codModelo: number | null;
  modeloEquipamento: string;
  tipoEquipamento: string | null;
  codTipoEquipamento: number | null;
  tipoHorimetro?: string | null;
  funcionaPorHora?: boolean;
  frota?: string;
  grupo?: string;
  codOperacaoAgricola: number | null;
  descricaoOperacao?: string | null;
  codFazenda: number | null;
  codTalhao: number | null;
  qtdeLitros: number;
  horasApontamento: number;
  horasTrabalho?: number;
  kmRodados?: number;
  kmhsRodados: number;
  areaHa: number;
  litrosPorHora: number | null;
  kmPorLitro?: number | null;
  litrosPorHa: number | null;
  custoUnitario: number | null;
  valorTotal: number;
}

export interface CombustivelFrotaGrupo {
  frota: string;
  grupo: string;
  qtdEquipamentos: number;
  qtdeLitros: number;
  valorTotal: number;
  kmRodados: number;
  horasTrabalho: number;
  kmPorLitro: number | null;
  litrosPorHora: number | null;
}

export interface CombustivelEquipamento {
  codEquipamento: number | null;
  label: string;
  descricao: string | null;
  tipoHorimetro: string | null;
  funcionaPorHora: boolean;
  qtdeLitros: number;
  valorTotal: number;
  kmRodados: number;
  horasTrabalho: number;
  kmPorLitro: number | null;
  litrosPorHora: number | null;
}

export interface CombustivelTipoEquipamento {
  codTipoEquipamento: number | null;
  tipoEquipamento: string;
  qtdEquipamentos: number;
  qtdeLitros: number;
  valorTotal: number;
  kmRodados: number;
  horasTrabalho: number;
  kmPorLitro: number | null;
  litrosPorHora: number | null;
}

export interface CombustivelDashboard {
  kpis: {
    custoTotal: number;
    litrosTotal: number;
    kmTotal: number;
    horasTotal: number;
    mediaKmPorLitro: number | null;
    mediaLitrosPorHora: number | null;
    qtdEquipamentos: number;
    qtdAbastecimentos: number;
  };
  porFrotaGrupo: CombustivelFrotaGrupo[];
  porEquipamento: CombustivelEquipamento[];
  porTipoEquipamento: CombustivelTipoEquipamento[];
}

export interface IndicadoresCombustivelModelo {
  codModelo: number | null;
  modeloEquipamento: string;
  tipoEquipamento: string | null;
  qtdEquipamentos: number;
  qtdAbastecimentos: number;
  qtdeLitros: number;
  horasApontamento: number;
  kmhsRodados: number;
  areaHa: number;
  litrosPorHora: number | null;
  litrosPorHa: number | null;
  valorTotal: number;
}

export interface IndicadoresCombustivelData {
  filtros: { dataInicio: string | null; dataFim: string | null };
  resumo: {
    totalLinhas: number;
    totalLitros: number;
    totalLitrosAutomotivo: number;
    totalLitrosPosto: number;
    totalHoras: number;
    totalKm?: number;
    totalAreaHa: number;
    totalValor: number;
    totalValorAutomotivo: number;
    totalValorPosto: number;
    totalValorBase: number;
    qtdModelos: number;
    mediaLitrosPorHora: number | null;
    mediaKmPorLitro?: number | null;
    mediaLitrosPorHa: number | null;
  };
  dashboard?: CombustivelDashboard;
  porModelo: IndicadoresCombustivelModelo[];
  dados: IndicadoresCombustivelLinha[];
}

export interface IndicadoresMapaFazendasInsumoMaterial {
  descricao: string;
  quantidade: number;
  valor: number;
}

export interface IndicadoresMapaFazendasInsumoResumo {
  qtdAplicacoes: number;
  valorTotal: number;
  materiais: IndicadoresMapaFazendasInsumoMaterial[];
}

export interface IndicadoresMapaFazendasFazendaResumo {
  codFazenda: number;
  nome: string;
  areaHa: number;
  insumos: IndicadoresMapaFazendasInsumoResumo;
}

export type IndicadoresMapaAreaStatus = "sem" | "parcial" | "concluido" | "acima" | "renovacao";

export type IndicadoresMapaEntomoIndice = "broca_comum" | "broca_gigante";

export type IndicadoresMapaEntomoFaixa = "verde" | "amarelo" | "vermelho" | "sem";

export interface IndicadoresMapaFazendasEntomologico {
  qtdeEntrenosBroca: number;
  entreNosAnalisados: number;
  canasBrocadas: number;
  indiceBrocaComum: number | null;
  canasBGigante: number;
  numeroCana: number;
  indiceBrocaGigante: number | null;
  faixaBrocaComum: IndicadoresMapaEntomoFaixa;
  faixaBrocaGigante: IndicadoresMapaEntomoFaixa;
  ultimaAnalise: string | null;
  qtdAnalises: number;
}

export interface IndicadoresMapaFazendasOperacao {
  codigo: string;
  descricao: string | null;
}

export interface IndicadoresMapaFazendasAreaAplicada {
  areaAplicada: number;
  pctAplicado: number | null;
  status: IndicadoresMapaAreaStatus;
  qtdApontamentos: number;
  ultimaAplicacao: string | null;
  operacao: string | null;
  operacaoDescricao: string | null;
}

export interface IndicadoresMapaFazendasIrrigacao {
  mmHa: number | null;
  areaIrrigada: number;
  laminaTotal: number;
  vazaoMedia: number | null;
  volumeTotal: number;
  qtdApontamentos: number;
  ultimaIrrigacao: string | null;
}

export interface IndicadoresMapaFazendasData {
  filtros: {
    safraCode: string | null;
    codSafra: number | null;
    dataInicio: string | null;
    dataFim: string | null;
    areasAplicadas: boolean;
    entomologico: boolean;
    irrigacao: boolean;
    entomologicoIndice: IndicadoresMapaEntomoIndice | null;
    operacao: string | null;
    operacaoDescricao: string | null;
  };
  resumo: {
    totalTalhoes: number;
    totalFazendas: number;
    totalAreaHa: number;
    areasAplicadas?: {
      concluido: number;
      parcial: number;
      acima: number;
      sem: number;
      renovacao: number;
    };
    entomologico?: Record<IndicadoresMapaEntomoIndice, Record<IndicadoresMapaEntomoFaixa, number>>;
    irrigacao?: {
      com: number;
      sem: number;
      mmHaMax: number;
      mmHaMedio: number | null;
    };
  };
  operacoes: IndicadoresMapaFazendasOperacao[];
  fazendas: IndicadoresMapaFazendasFazendaResumo[];
  geojson: {
    type: "FeatureCollection";
    features: Array<{
      type: "Feature";
      geometry: { type: string; coordinates: unknown };
      properties: Record<string, unknown>;
    }>;
  };
}

export interface ColheitaHorasRow {
  id: number | null;
  codEquipamento: number | null;
  data: string | null;
  horaMotor: number | null;
  horasElevador: number | null;
  turno: string | null;
  codTipoEquipamento?: number | null;
  tipoDescricao?: string | null;
}

export interface ColheitaVinculoEquipPeriodo {
  codEquipamento: number | null;
  qtdEntradas: number;
  dataInicio: string | null;
  dataFim: string | null;
}

export interface ColheitaVinculoItem {
  caminhao?: number | null;
  maquina?: number | null;
  qtdEntradas: number;
  ultimaData: string | null;
  codEquipamento: number | null;
  associacoes: ColheitaVinculoEquipPeriodo[];
}

export interface ColheitaAtualizarEquipamentoResult {
  filtros: Record<string, unknown>;
  resumo: { encontrados: number; atualizados: number; falhas: number; truncado?: boolean };
  erros: { erro: string }[];
  dados: Record<string, unknown>[];
}

export interface ColheitaFazendaEntradaRow {
  fazenda: string;
  codigoPrefixo: string | null;
  qtdEntradas: number;
  origens: string[];
  ultimaData: string | null;
  descricaoUsina: string | null;
  codSistema: number | null;
  raio: number | null;
  match: string | null;
}

export interface ColheitaFazendaSistemaRow {
  codFazenda: number | null;
  descricao: string | null;
  distancia: number | null;
}

export interface ColheitaFazendaUsinaRow {
  descricaoUsina: string | null;
  codSistema: number | null;
  raio: number | null;
}

export interface CalcRuleInput {
  kind: "material" | "activity";
  materialId?: number | null;
  activityId?: number | null;
  premise?: string;
  mode?: "area" | "days" | "hours";
  dose?: number | null;
  rateHa?: number | null;
  price?: number | null;
  excludeWeekdays?: number[] | null;
  areaPremise?: string | null;
  useActivityAuto?: boolean;
  startMonth?: number | null;
  endMonth?: number | null;
  fromMaterials?: boolean;
  costObjectIds?: number[] | null;
  safraId?: number | null;
}

export interface CalcRule {
  id: number;
  kind: "material" | "activity";
  mode?: "area" | "days" | "hours";
  materialId: number | null;
  activityId: number | null;
  materialCode: string | null;
  materialName: string | null;
  activityCode: string | null;
  activityName: string | null;
  premise: string;
  dose: number | null;
  rateHa: number | null;
  price: number | null;
  excludeWeekdays?: number[];
  areaPremise?: string | null;
  useActivityAuto?: boolean;
  startMonth?: number | null;
  endMonth?: number | null;
  fromMaterials?: boolean;
  costObjectIds?: number[];
  costObjectCodes?: string[];
  safraId: number | null;
  formula: string;
}

export interface CalcRulesData {
  safraId?: number;
  previousSafra?: Safra | null;
  previousRuleCount?: number;
  drivers: { key: string; label: string }[];
  rules: CalcRule[];
}

export interface SeedFarmRadius {
  farmCode: number;
  farmName: string;
  cadastralKm: number | null;
  averageKm: number | null;
  minKm: number | null;
  maxKm: number | null;
  trips: number;
}

export interface SeedRadiusData {
  fromDate: string | null;
  toDate: string | null;
  operation: number;
  farms: SeedFarmRadius[];
}

export interface SeedFarmTrip {
  date: string | null;
  originCode: number | null;
  originName: string;
  destCode: number | null;
  destName: string;
  distanceKm: number | null;
  quantity: number | null;
}

export interface SeedRadiusTripsData {
  farmCode: number;
  fromDate: string | null;
  toDate: string | null;
  trips: SeedFarmTrip[];
}

export interface SeedRadiusTariff {
  id: number;
  safraId: number;
  startKm: number;
  endKm: number;
  price: number;
}

export interface SeedRadiusTariffsData {
  safraId?: number;
  previousSafra?: Safra | null;
  previousCount?: number;
  tariffs: SeedRadiusTariff[];
}

export interface HarvestArea {
  id: number;
  safraId: number;
  description: string;
  area: number;
}

export interface HarvestAreasData {
  safraId?: number;
  previousSafra?: Safra | null;
  previousCount?: number;
  areas: HarvestArea[];
  total?: number;
}

export interface ParametrosTecnicos {
  safraId: number;
  areaPlantio: number;
  areaSoca: number;
  areaIrrigacao: number;
  areaArrendada: number;
  moagemLj: number;
  tonelagemManual: number;
  atr: number;
  produtividade: number;
  precoAtrConsecana: number;
  anomesInicio: string | null;
  anomesFim: string | null;
  updatedAt: string | null;
  armazenado: boolean;
}

export interface SeedTransportOption {
  codigo: number | null;
  descricao: string;
}

export interface SeedTransportOptions {
  operacoes: SeedTransportOption[];
  fazendas: SeedTransportOption[];
}

export interface SeedTransportSaveItem {
  proprietario?: string;
  placa?: string;
  data?: string;
  codOperacao?: number | string | null;
  codImplemento?: number | string | null;
  codFazendaOrigem?: number | string | null;
  codTalhaoOrigem?: number | string | null;
  codFazendaDestino?: number | string | null;
  codTalhaoDestino?: number | string | null;
  quantidade?: number | string | null;
  raioMedio?: number | string | null;
  valor?: number | string | null;
  descontoCombustivel?: number | string | null;
  imposto5?: number | string | null;
}

export interface ContractControlOption {
  codigo: number;
  descricao: string;
}

export interface ContractControlRow {
  prestador: string;
  razaoSocial: string;
  fornecedorCodigo: number | null;
  valorTotal: number;
  adiantamento: number;
  combustivel: number;
  valorPago: number;
  valorDevedor: number;
}

export interface ContractSupplierGroup {
  id: number;
  nome: string;
  fornecedores: ContractControlOption[];
}

export interface ContractControlReport {
  from: string;
  to: string;
  rows: ContractControlRow[];
  totals: Omit<ContractControlRow, "prestador" | "razaoSocial" | "fornecedorCodigo">;
}

export interface ContractOccurrenceRow {
  fornecedorCodigo: number | null;
  fornecedor: string;
  documento: string;
  parcela: number;
  sequencia: number | null;
  ocorrencia: string;
  observacao: string;
  data: string;
  valor: number;
}

export interface ContractOccurrenceReport {
  from: string;
  to: string;
  rows: ContractOccurrenceRow[];
  total: number;
}

export interface ContractFuelBaixa {
  id: number;
  data: string;
  valor: number;
}

export interface ContractFuelRow {
  id: number;
  numeroNf: string;
  fornecedor: string;
  mesCompetencia: string;
  valorNf: number;
  valorBaixado: number;
  restante: number;
  baixas: ContractFuelBaixa[];
}

export interface ContractFuelReport {
  rows: ContractFuelRow[];
  totals: Omit<ContractFuelRow, "id" | "numeroNf" | "fornecedor" | "mesCompetencia" | "baixas">;
}

export interface SeedTransportSaveBody {
  ano?: number | string | null;
  numero?: number | string | null;
  data?: string | null;
  codEquipamento?: number | string | null;
  codFornecedor?: number | string | null;
  responsavel?: number | string | null;
  codFuncionarioTerceiro?: number | string | null;
  codContrato?: number | string | null;
  itemContrato?: number | string | null;
  anoOsPlanoAgr?: number | string | null;
  numeroOsPlanoAgr?: number | string | null;
  observacoes?: string | null;
  itens: SeedTransportSaveItem[];
}

export interface BudgetStorageStatus {
  provider: "supabase" | "sqlite";
  connected: boolean;
  revision: number | null;
  updatedAt: string | null;
  checkedAt: string;
  project: string | null;
}

export const api = {
  budgetStorageStatus: (signal?: AbortSignal) => get<BudgetStorageStatus>("/api/storage/status", signal),
  login: (email: string, password: string) => send<AuthSession>("/api/auth/login", "POST", { email, password }),
  me: () => get<{ user: AuthUser }>("/api/auth/me"),
  logout: () => send<{ ok: boolean }>("/api/auth/logout", "POST"),
  adminPermissionCatalog: () => get<PermissionCatalog>("/api/admin/permissions/catalog"),
  adminUsers: () => get<AdminUserRow[]>("/api/admin/users"),
  createAdminUser: (body: {
    nome: string;
    email: string;
    password: string;
    ativo?: boolean;
    permissions?: string[];
  }) => send<AdminUserRow>("/api/admin/users", "POST", body),
  updateAdminUser: (
    id: number,
    body: { nome?: string; email?: string; password?: string; ativo?: boolean; permissions?: string[] },
  ) => send<AdminUserRow>(`/api/admin/users/${id}`, "PATCH", body),
  verifyAdminPassword: (email: string, password: string) =>
    send<{ ok: boolean; reason: string | null }>("/api/admin/users/verify-password", "POST", { email, password }),
  externalSites: () => get<ExternalSiteGroup[]>("/api/external-sites"),
  externalSitesAdmin: () => get<ExternalSiteGroup[]>("/api/external-sites/admin"),
  externalSiteGroup: (id: number) => get<ExternalSiteGroup>(`/api/external-sites/groups/${id}`),
  registerExternalSite: (body: {
    tabLabel?: string;
    subTabLabel: string;
    url: string;
    embedNativeKey?: ExternalSiteEmbedNativeKey | null;
    groupId?: number | null;
  }) => send<ExternalSiteRegisterResult>("/api/external-sites/register", "POST", body),
  deleteExternalSiteGroup: (id: number) => send<{ ok: boolean }>(`/api/external-sites/groups/${id}`, "DELETE"),
  updateExternalSiteItem: (
    id: number,
    body: {
      label?: string;
      url?: string;
      sortOrder?: number;
      visible?: boolean;
      groupId?: number;
      embedNativeKey?: ExternalSiteEmbedNativeKey;
      tabLabel?: string;
    },
  ) => send<ExternalSiteItem>(`/api/external-sites/items/${id}`, "PATCH", body),
  deleteExternalSiteItem: (id: number) => send<{ ok: boolean }>(`/api/external-sites/items/${id}`, "DELETE"),
  setNativeTabHidden: (body: { nativeKey: string; tabId: string; hidden: boolean }) =>
    send<{ nativeKey: string; tabId: string; hidden: boolean; hiddenNativeTabs: string[] }>(
      "/api/external-sites/native-tabs",
      "PATCH",
      body,
    ),
  sheets: () => get<SheetInfo[]>("/api/sheets"),
  dashboard: () => get<DashboardData>("/api/dashboard"),
  resumo: () => get<ResumoData>("/api/resumo"),
  orcadoRealizado: (params?: { safraId?: number }) => {
    const q = params?.safraId ? `?safraId=${params.safraId}` : "";
    return get<OrcadoRealizadoData>(`/api/orcado-realizado${q}`);
  },
  orcadoRealizadoGrupoGastoDetalhes: (params: {
    safraId?: number;
    grupoKey: string;
    empenhoKey: string;
    agricola?: boolean;
  }) => {
    const q = new URLSearchParams({ grupoKey: params.grupoKey, empenhoKey: params.empenhoKey });
    if (params.safraId) q.set("safraId", String(params.safraId));
    if (params.agricola) q.set("agricola", "1");
    return get<{ rows: CompareRow[] }>(`/api/orcado-realizado/grupo-gasto-detalhes?${q}`);
  },
  seedTransportOptions: () => get<SeedTransportOptions>("/api/seed-transport-report/options"),
  seedTransportTalhoes: (codFazenda: number | string) =>
    get<{ talhoes: Array<{ codigo: number | null }> }>(
      `/api/seed-transport-report/talhoes?codFazenda=${encodeURIComponent(String(codFazenda))}`,
    ),
  seedTransportSaveOracle: (body: SeedTransportSaveBody) =>
    send<{ ok: boolean; ano: number; numero: number | null; itens: number }>(
      "/api/seed-transport-report/save-oracle",
      "POST",
      body,
    ),
  contractControlOptions: () =>
    get<{ fornecedores: ContractControlOption[]; empenhos: ContractControlOption[] }>("/api/contract-control/options"),
  contractSupplierGroups: () => get<ContractSupplierGroup[]>("/api/contract-control/grupos"),
  saveContractSupplierGroup: (body: { nome: string; fornecedores: ContractControlOption[] }) =>
    send<ContractSupplierGroup[]>("/api/contract-control/grupos", "POST", body),
  deleteContractSupplierGroup: (id: number) =>
    send<ContractSupplierGroup[]>(`/api/contract-control/grupos/${id}`, "DELETE"),
  removeContractSupplierMembers: (id: number, codigos: number[]) =>
    send<ContractSupplierGroup[]>(`/api/contract-control/grupos/${id}/retirar`, "POST", { codigos }),
  contractControl: (params: {
    from: string;
    to: string;
    fornecedores?: number[];
    empenhos?: number[];
    signal?: AbortSignal;
  }) => {
    const q = new URLSearchParams({ from: params.from, to: params.to });
    if (params.fornecedores?.length) q.set("fornecedores", params.fornecedores.join(","));
    if (params.empenhos?.length) q.set("empenhos", params.empenhos.join(","));
    return get<ContractControlReport>(`/api/contract-control?${q.toString()}`, params.signal);
  },
  contractControlOccurrences: (params: { from: string; to: string; fornecedores?: number[]; signal?: AbortSignal }) => {
    const q = new URLSearchParams({ from: params.from, to: params.to });
    if (params.fornecedores?.length) q.set("fornecedores", params.fornecedores.join(","));
    return get<ContractOccurrenceReport>(`/api/contract-control/ocorrencias?${q.toString()}`, params.signal);
  },
  contractControlFuel: () => get<ContractFuelReport>("/api/contract-control/combustivel"),
  addContractFuelNote: (body: {
    numeroNf: string;
    fornecedor: string;
    mesCompetencia: string;
    valorNf: number;
  }) => send<ContractFuelReport>("/api/contract-control/combustivel", "POST", body),
  updateContractFuelNote: (id: number, body: { numeroNf?: string; fornecedor?: string; mesCompetencia?: string }) =>
    send<ContractFuelReport>(`/api/contract-control/combustivel/${id}`, "PATCH", body),
  addContractFuelBaixa: (noteId: number, body: { dataBaixa: string; valor: number }) =>
    send<ContractFuelReport>(`/api/contract-control/combustivel/${noteId}/baixas`, "POST", body),
  updateContractFuelBaixa: (id: number, body: { dataBaixa: string; valor: number }) =>
    send<ContractFuelReport>(`/api/contract-control/combustivel/baixas/${id}`, "PATCH", body),
  deleteContractFuelBaixa: (id: number) =>
    send<ContractFuelReport>(`/api/contract-control/combustivel/baixas/${id}`, "DELETE"),
  deleteContractFuelNote: (id: number) => send<ContractFuelReport>(`/api/contract-control/combustivel/${id}`, "DELETE"),
  custoDashboard: (params: Record<string, string | number | undefined | null>) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value == null || value === "") continue;
      q.set(key, String(value));
    }
    return get<CustoDashboardData>(`/api/custo/dashboard?${q}`);
  },
  custoMatrizSubprocesso: (params: Record<string, string | number | undefined | null>) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value == null || value === "") continue;
      q.set(key, String(value));
    }
    return get<CustoMatrizSubprocessoData>(`/api/custo/rateio/matriz-subprocesso?${q}`);
  },
  custoDimensoes: (params: Record<string, string | number | undefined | null>) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value == null || value === "") continue;
      q.set(key, String(value));
    }
    return get<CustoDimensoesData>(`/api/custo/objetos-custo/dimensoes?${q}`);
  },
  custoObjetosCusto: (params: Record<string, string | number | undefined | null>) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value == null || value === "") continue;
      q.set(key, String(value));
    }
    return get<{ dados: CustoObjetoCustoRow[] }>(`/api/custo/objetos-custo?${q}`);
  },
  custoRateioAtividades: (params: Record<string, string | number | undefined | null>) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value == null || value === "") continue;
      q.set(key, String(value));
    }
    return get<{ dados: unknown[]; resumo?: Record<string, number> }>(`/api/custo/rateio/atividades?${q}`);
  },
  custoRateioOficinaReconciliacao: (params: Record<string, string | number | undefined | null>) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value == null || value === "") continue;
      q.set(key, String(value));
    }
    return get<Record<string, unknown>>(`/api/custo/rateio/oficina-reconciliacao?${q}`);
  },
  custoRateioTransporteReconciliacao: (params: Record<string, string | number | undefined | null>) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value == null || value === "") continue;
      q.set(key, String(value));
    }
    return get<Record<string, unknown>>(`/api/custo/rateio/transporte-reconciliacao?${q}`);
  },
  custoRateioMecanizacaoReconciliacao: (params: Record<string, string | number | undefined | null>) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value == null || value === "") continue;
      q.set(key, String(value));
    }
    return get<Record<string, unknown>>(`/api/custo/rateio/mecanizacao-reconciliacao?${q}`);
  },
  custoRateioDiagnostico: (params: Record<string, string | number | undefined | null>) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value == null || value === "") continue;
      q.set(key, String(value));
    }
    return get<Record<string, unknown>>(`/api/custo/rateio/diagnostico?${q}`);
  },
  custoAbastecimentos: (params: Record<string, string | number | undefined | null>) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value == null || value === "") continue;
      q.set(key, String(value));
    }
    return get<{
      dados: Record<string, unknown>[];
      porModelo?: Record<string, unknown>[];
      resumo?: {
        totalLinhas?: number;
        totalLitros?: number;
        totalValor?: number;
        totalHoras?: number;
        totalAreaHa?: number;
        mediaLitrosPorHora?: number | null;
        mediaLitrosPorHa?: number | null;
        qtdModelos?: number;
      };
    }>(`/api/custo/abastecimentos?${q}`);
  },
  custoMateriaisFluxo: (params: Record<string, string | number | undefined | null>) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value == null || value === "") continue;
      q.set(key, String(value));
    }
    return get<Record<string, unknown>>(`/api/custo/materiais/fluxo?${q}`);
  },
  custoMateriais: (params: Record<string, string | number | undefined | null>) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value == null || value === "") continue;
      q.set(key, String(value));
    }
    return get<{ dados: Record<string, unknown>[] }>(`/api/custo/materiais?${q}`);
  },
  custoInsumos: (params: Record<string, string | number | undefined | null>) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value == null || value === "") continue;
      q.set(key, String(value));
    }
    return get<{ dados: Record<string, unknown>[] }>(`/api/custo/insumos?${q}`);
  },
  custoServicosTerceiro: (params: Record<string, string | number | undefined | null>) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value == null || value === "") continue;
      q.set(key, String(value));
    }
    return get<{ dados: Record<string, unknown>[] }>(`/api/custo/servicos-terceiro?${q}`);
  },
  custoFuncionariosConsulta: (params: Record<string, string | number | undefined | null>) => {
    const q = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value == null || value === "") continue;
      q.set(key, String(value));
    }
    return get<{ dados: Record<string, unknown>[] }>(`/api/custo/funcionarios?${q}`);
  },
  premissas: () => get<DashboardData["kpis"]>("/api/premissas"),
  custoColheita: (filtro: { anomesInicio: string; anomesFim: string; safraId?: number; preferirLocal?: boolean }) => {
    const q = new URLSearchParams({
      anomesInicio: filtro.anomesInicio,
      anomesFim: filtro.anomesFim,
    });
    if (filtro.safraId != null) q.set("safraId", String(filtro.safraId));
    if (filtro.preferirLocal) q.set("preferirLocal", "1");
    return get<{
      safraId: number;
      anomesInicio: string;
      anomesFim: string;
      oracleConsultado: boolean;
      secoes: { titulo: string; linhas: { objeto: string; custo: number; custoOracle: number; armazenado: boolean }[] }[];
    }>(`/api/custo-colheita?${q}`);
  },
  salvarCustoColheita: (body: {
    safraId?: number;
    anomesInicio: string;
    anomesFim: string;
    secoes: { titulo: string; linhas: { objeto: string; custo: number }[] }[];
  }) => send<{ ok: boolean; updatedAt: string }>("/api/custo-colheita", "PUT", body),
  fichaEstagio: (filtro?: { anomesInicio: string; anomesFim: string; anoSafra: number }) => {
    const q = new URLSearchParams();
    if (filtro) {
      q.set("anomesInicio", filtro.anomesInicio);
      q.set("anomesFim", filtro.anomesFim);
      q.set("anoSafra", String(filtro.anoSafra));
    }
    const qs = q.toString();
    return get<{
      secoes: {
        titulo: string;
        area: "plantio" | "soca";
        semInsumo?: boolean;
        total: number;
        linhas: {
          objeto: string;
          descricao: string;
          insumo: string;
          preco: number | null;
          dose: number | null;
          rHaInsumo: number | null;
          custo: number;
        }[];
      }[];
    }>(`/api/ficha-estagio${qs ? `?${qs}` : ""}`);
  },
  sheet: (id: number) => get<SheetDetail>(`/api/sheets/${id}`),
  sheetActivityHeads: (id: number) =>
    get<{ id: number; activityId: number; code: string; description: string }[]>(`/api/sheets/${id}/activity-heads`),
  groupCategoryByCenter: (categoryId: number) =>
    send<SheetDetail>(`/api/categories/${categoryId}/group-by-center`, "POST"),
  copyCategoryItems: (categoryId: number, body: { sourceCategoryId: number; lineIds: number[] }) =>
    send<SheetDetail>(`/api/categories/${categoryId}/copy-from`, "POST", body),
  setVisible: (id: number, visible: boolean) => send<SheetInfo>(`/api/sheets/${id}`, "PATCH", { visible }),
  setVerified: (id: number, verified: boolean) => send<SheetInfo>(`/api/sheets/${id}`, "PATCH", { verified }),
  removeSheet: (id: number) => send<{ ok: boolean }>(`/api/sheets/${id}`, "DELETE"),
  addLine: (sheetId: number, body: Record<string, unknown>) =>
    send<SheetDetail>(`/api/sheets/${sheetId}/lines`, "POST", body),
  distributeActivity: (
    sheetId: number,
    body: {
      activityId: number;
      totalValue: number;
      months: number[];
      categoryName: string;
      catalogCategoryId?: number | null;
      targets: { sheetId: number; costObjectId?: number | null }[];
    },
  ) => send<SheetDetail>(`/api/sheets/${sheetId}/distribute-activity`, "POST", body),
  reconcileEquipmentObc: (sheetId: number) =>
    send<SheetDetail>(`/api/sheets/${sheetId}/reconcile-equipment-obc`, "POST", {}),
  undoDistribution: (sheetId: number, id: number) =>
    send<SheetDetail>(`/api/sheets/${sheetId}/distributions/${id}`, "DELETE"),
  distributions: () => get<ValueDistribution[]>("/api/distributions"),
  undoAnyDistribution: (id: number) =>
    send<{ distributions: ValueDistribution[] }>(`/api/distributions/${id}`, "DELETE"),
  updateLine: (id: number, body: Record<string, unknown>) => send<SheetDetail>(`/api/lines/${id}`, "PATCH", body),
  funcionarioSubprocessos: (externalSafraId: number) =>
    get<FuncionarioSubprocessList>(`/api/funcionario-orcamento/subprocessos?safraId=${externalSafraId}`),
  funcionarioOrcamentoRefreshAll: (body: { externalSafraId?: number; safraId?: number; localSafraId?: number | null }) =>
    send<FuncionarioOrcamentoRefreshResult>("/api/funcionario-orcamento/refresh-all", "POST", body),
  deleteLine: (id: number) => send<SheetDetail>(`/api/lines/${id}`, "DELETE"),
  setMonth: (id: number, month: number, body: { value?: number | null; formula?: string | null }) =>
    send<SheetDetail>(`/api/lines/${id}/months/${month}`, "PUT", body),
  setPremissa: (row: number, col: number, input: string) =>
    send<DashboardData["kpis"]>("/api/premissas/cell", "PUT", { row, col, input }),
  setPremissaMonth: (key: string, month: number, value: string | number) =>
    send<DashboardData["kpis"]>("/api/premissas/month", "PUT", { key, month, value }),
  copyPremissa: (body: {
    destKey?: string;
    destName?: string;
    destSuffix?: string;
    sourceKey: string;
    sourceScope: "current" | "previous";
    startMonth: number;
    endMonth: number;
  }) => send<DashboardData["kpis"]>("/api/premissas/copy", "PUT", body),
  deletePremissaCopy: (id: number) => send<DashboardData["kpis"]>(`/api/premissas/copy/${id}`, "DELETE"),
  addPremissaItem: (body: {
    name: string;
    suffix?: string;
    kind?: "subprocess" | "producao_propria";
    qty?: number | string;
    qtyPerDay?: number | string;
    startDay?: string;
    endDay?: string;
  }) => send<DashboardData["kpis"]>("/api/premissas/items", "POST", body),
  savePremissaSubprocess: (
    key: string,
    body: { qty?: number | string; startDay?: string | null; endDay?: string | null },
  ) => send<DashboardData["kpis"]>("/api/premissas/subprocess", "PUT", { key, ...body }),
  savePremissaProduction: (
    key: string,
    body: { qtyPerDay?: number | string; startDay?: string | null; endDay?: string | null },
  ) => send<DashboardData["kpis"]>("/api/premissas/production", "PUT", { key, ...body }),
  deletePremissaItem: (key: string) =>
    send<DashboardData["kpis"]>(`/api/premissas/items/${encodeURIComponent(key)}`, "DELETE"),
  reset: () => send<{ imported: boolean }>("/api/reset", "POST"),
  activities: () => get<Activity[]>("/api/activities"),
  activityLinks: (safraId?: number) =>
    get<ActivityLinksData>(safraId ? `/api/activity-links?safraId=${safraId}` : "/api/activity-links"),
  activitySourceOptions: (
    source: ActivityRealizadoLink["source"],
    safraId?: number,
    matchBy?: string,
  ) => {
    const q = new URLSearchParams({ source });
    if (safraId) q.set("safraId", String(safraId));
    if (matchBy) q.set("matchBy", matchBy);
    return get<ActivitySourceOptionsData>(`/api/activity-links/sources?${q}`);
  },
  addActivityLink: (body: {
    activityId: number;
    source: ActivityRealizadoLink["source"];
    sourceCode?: string;
    sourceCodes?: string[];
    sourceLabel?: string | null;
    matchBy?: string | null;
    safraId?: number | null;
  }) => send<ActivityLinksData>("/api/activity-links", "POST", body),
  deleteActivityLink: (id: number, safraId?: number) =>
    send<ActivityLinksData>(
      safraId ? `/api/activity-links/${id}?safraId=${safraId}` : `/api/activity-links/${id}`,
      "DELETE",
    ),
  unRealizadoSources: (safraId?: number) =>
    get<UnRealizadoSourcesData>(
      safraId ? `/api/un-realizado-sources?safraId=${safraId}` : "/api/un-realizado-sources",
    ),
  unRealizadoKinds: () =>
    get<{
      kinds: {
        id: UnRealizadoKind;
        label: string;
        needsOperations: boolean;
        metrics: UnRealizadoMetric[];
      }[];
    }>("/api/un-realizado-sources/kinds"),
  unRealizadoOperations: () =>
    get<{ items: { code: string; label: string }[] }>("/api/un-realizado-sources/operations"),
  saveUnRealizadoSource: (body: {
    sheetId: number;
    sourceKind: UnRealizadoKind;
    metric?: UnRealizadoMetric;
    operations?: { code: string; label?: string }[];
    safraId?: number | null;
  }) => send<UnRealizadoSourcesData>("/api/un-realizado-sources", "POST", body),
  deleteUnRealizadoSource: (id: number, safraId?: number) =>
    send<UnRealizadoSourcesData>(
      safraId ? `/api/un-realizado-sources/${id}?safraId=${safraId}` : `/api/un-realizado-sources/${id}`,
      "DELETE",
    ),
  oracleActivities: () => get<{ items: OracleActivity[] }>("/api/activities/oracle"),
  importOracleActivities: (codes?: string[]) =>
    send<{ imported: number; skipped: number; activities: Activity[] }>("/api/activities/import-oracle", "POST", { codes }),
  empenhos: () => get<Empenho[]>("/api/empenhos"),
  oracleEmpenhos: () => get<{ items: OracleEmpenho[] }>("/api/empenhos/oracle"),
  importOracleEmpenhos: (codes?: string[]) =>
    send<{ imported: number; updated: number; empenhos: Empenho[] }>("/api/empenhos/import-oracle", "POST", { codes }),
  addActivity: (body: { code: string; description: string; empenho?: string }) => send<Activity>("/api/activities", "POST", body),
  updateActivity: (id: number, body: { code?: string; description?: string; empenho?: string | null }) =>
    send<Activity>(`/api/activities/${id}`, "PATCH", body),
  deleteActivity: (id: number) => send<{ ok: boolean }>(`/api/activities/${id}`, "DELETE"),
  fazendas: () => get<Fazenda[]>("/api/fazendas"),
  oracleFazendas: () => get<{ items: OracleFazenda[] }>("/api/fazendas/oracle"),
  importOracleFazendas: (codes?: string[]) =>
    send<{ imported: number; updated: number; skipped: number; fazendas: Fazenda[] }>(
      "/api/fazendas/import-oracle",
      "POST",
      { codes },
    ),
  addFazenda: (body: { code: string; description: string; distancia?: number | null }) =>
    send<Fazenda>("/api/fazendas", "POST", body),
  updateFazenda: (id: number, body: { code?: string; description?: string; distancia?: number | null }) =>
    send<Fazenda>(`/api/fazendas/${id}`, "PATCH", body),
  deleteFazenda: (id: number) => send<{ ok: boolean }>(`/api/fazendas/${id}`, "DELETE"),
  materials: () => get<Material[]>("/api/materials"),
  materialGroups: () => get<{ groups: string[]; source: "oracle" | "local" }>("/api/materials/groups"),
  syncMaterialGroups: () => send<{ updated: number; materials: Material[] }>("/api/materials/sync-groups", "POST"),
  materialsEntradaSaida: (params: { dataInicio?: string; dataFim?: string; tipos?: string[] }) => {
    const q = new URLSearchParams();
    if (params.dataInicio) q.set("dataInicio", params.dataInicio);
    if (params.dataFim) q.set("dataFim", params.dataFim);
    for (const tipo of params.tipos ?? []) {
      if (tipo.trim()) q.append("tipos", tipo.trim());
    }
    const qs = q.toString();
    return get<MaterialEntradaSaidaRelatorio>(`/api/materials/relatorio-entrada-saida${qs ? `?${qs}` : ""}`);
  },
  oracleMaterials: (q?: string) => {
    const query = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
    return get<{ items: OracleMaterial[]; truncated: boolean }>(`/api/materials/oracle${query}`);
  },
  importOracleMaterials: (codes: string[]) =>
    send<{ imported: number; skipped: number; materials: Material[] }>("/api/materials/import-oracle", "POST", { codes }),
  materialLastPrice: (id: number) => get<MaterialLastPrice>(`/api/materials/${id}/last-price`),
  addMaterial: (body: {
    code: string;
    description: string;
    tipo: "E" | "G";
    empenho?: string;
    valor?: number | null;
    grupo?: string | null;
  }) => send<Material>("/api/materials", "POST", body),
  updateMaterial: (
    id: number,
    body: Partial<Pick<Material, "code" | "description" | "tipo" | "empenho" | "valor" | "grupo">>,
  ) => send<Material>(`/api/materials/${id}`, "PATCH", body),
  deleteMaterial: (id: number) => send<{ ok: boolean }>(`/api/materials/${id}`, "DELETE"),
  costObjects: () => get<CostObject[]>("/api/cost-objects"),
  costObjectHourCost: () => get<CostObjectHourCostData>("/api/cost-objects/hour-cost"),
  equipmentHourCost: (costObjectId: number) =>
    get<EquipmentHourCostData>(`/api/cost-objects/${costObjectId}/equipment-hour-cost`),
  equipments: () => get<EquipmentCatalogItem[]>("/api/equipments"),
  equipmentCostObjects: (codes: string[]) =>
    get<{ items: EquipmentCostObjectMapping[] }>(
      `/api/equipments/cost-objects?codes=${encodeURIComponent(codes.join(","))}`,
    ),
  activityApontamentoEquipment: (activityId: number) =>
    get<ApontamentoEquipmentData>(`/api/activities/${activityId}/apontamento-equipment`),
  addCostObject: (body: { code: string; description: string }) => send<CostObject>("/api/cost-objects", "POST", body),
  updateCostObject: (id: number, body: { code?: string; description?: string }) =>
    send<CostObject>(`/api/cost-objects/${id}`, "PATCH", body),
  deleteCostObject: (id: number) => send<{ ok: boolean }>(`/api/cost-objects/${id}`, "DELETE"),
  catalogCategories: () => get<CatalogCategory[]>("/api/category-catalog"),
  addCatalogCategory: (body: { name: string }) => send<CatalogCategory>("/api/category-catalog", "POST", body),
  updateCatalogCategory: (id: number, body: { name: string }) =>
    send<CatalogCategory>(`/api/category-catalog/${id}`, "PATCH", body),
  deleteCatalogCategory: (id: number) => send<{ ok: boolean }>(`/api/category-catalog/${id}`, "DELETE"),
  addCategory: (sheetId: number, body: { name?: string; catalogId?: number }) =>
    send<SheetDetail>(`/api/sheets/${sheetId}/categories`, "POST", body),
  deleteCategory: (id: number) => send<SheetDetail>(`/api/categories/${id}`, "DELETE"),
  calcRules: (safraId?: number) =>
    get<CalcRulesData>(safraId ? `/api/calc-rules?safraId=${safraId}` : "/api/calc-rules"),
  addCalcRule: (body: CalcRuleInput) => send<CalcRulesData>("/api/calc-rules", "POST", body),
  copyCalcRulesFromPrevious: (safraId?: number) =>
    send<CalcRulesData>("/api/calc-rules/copy-previous", "POST", { safraId }),
  updateCalcRule: (id: number, body: Partial<CalcRuleInput>) => send<CalcRulesData>(`/api/calc-rules/${id}`, "PATCH", body),
  deleteCalcRule: (id: number) => send<CalcRulesData>(`/api/calc-rules/${id}`, "DELETE"),
  seedRadius: (from?: string, to?: string) => {
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    const suffix = q.toString() ? `?${q}` : "";
    return get<SeedRadiusData>(`/api/seed-radius${suffix}`);
  },
  seedRadiusTrips: (farmCode: number, from?: string, to?: string) => {
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    const suffix = q.toString() ? `?${q}` : "";
    return get<SeedRadiusTripsData>(`/api/seed-radius/${farmCode}/trips${suffix}`);
  },
  seedRadiusTariffs: (safraId?: number) =>
    get<SeedRadiusTariffsData>(safraId ? `/api/seed-radius-tariffs?safraId=${safraId}` : "/api/seed-radius-tariffs"),
  addSeedRadiusTariff: (body: { startKm: number; endKm: number; price: number; safraId?: number }) =>
    send<SeedRadiusTariffsData>("/api/seed-radius-tariffs", "POST", body),
  copySeedRadiusTariffsFromPrevious: (safraId?: number) =>
    send<SeedRadiusTariffsData>("/api/seed-radius-tariffs/copy-previous", "POST", { safraId }),
  updateSeedRadiusTariff: (id: number, body: Partial<{ startKm: number; endKm: number; price: number }>) =>
    send<SeedRadiusTariffsData>(`/api/seed-radius-tariffs/${id}`, "PATCH", body),
  deleteSeedRadiusTariff: (id: number) => send<SeedRadiusTariffsData>(`/api/seed-radius-tariffs/${id}`, "DELETE"),
  harvestAreas: (safraId?: number) =>
    get<HarvestAreasData>(safraId ? `/api/areas?safraId=${safraId}` : "/api/areas"),
  periodosParametrosTecnicos: () => get<{ periodos: { safraId: number; safraLabel: string; anomesInicio: string; anomesFim: string }[] }>("/api/parametros-tecnicos/periodos"),
  parametrosTecnicos: (safraId: number | undefined, anomesInicio: string, anomesFim: string) => {
    const q = new URLSearchParams({ anomesInicio, anomesFim });
    if (safraId != null) q.set("safraId", String(safraId));
    return get<ParametrosTecnicos>(`/api/parametros-tecnicos?${q}`);
  },
  extrairParametrosTecnicos: (body: { safraId?: number; anomesInicio: string; anomesFim: string }) =>
    send<ParametrosTecnicos>("/api/parametros-tecnicos/extrair", "POST", body),
  salvarParametrosTecnicos: (body: {
    safraId?: number;
    areaPlantio: number;
    areaSoca: number;
    areaIrrigacao: number;
    areaArrendada: number;
    moagemLj: number;
    tonelagemManual: number;
    atr: number;
    produtividade: number;
    precoAtrConsecana: number;
    anomesInicio: string;
    anomesFim: string;
  }) => send<ParametrosTecnicos>("/api/parametros-tecnicos", "PUT", body),
  addHarvestArea: (body: { description: string; area: number; safraId?: number }) =>
    send<HarvestAreasData>("/api/areas", "POST", body),
  copyHarvestAreasFromPrevious: (safraId?: number) =>
    send<HarvestAreasData>("/api/areas/copy-previous", "POST", { safraId }),
  updateHarvestArea: (id: number, body: Partial<{ description: string; area: number }>) =>
    send<HarvestAreasData>(`/api/areas/${id}`, "PATCH", body),
  deleteHarvestArea: (id: number) => send<HarvestAreasData>(`/api/areas/${id}`, "DELETE"),
  arrendamentoPorSafra: () => get<{ dados: ArrendamentoSafra[] }>("/api/custo/arrendamento-por-safra"),
  safras: () => get<SafrasData>("/api/safras"),
  addSafra: (code: string, label?: string, copyFrom = true) =>
    send<SafrasData>("/api/safras", "POST", { code, label, copyFrom }),
  updateSafra: (id: number, body: { code?: string; label?: string }) =>
    send<SafrasData>(`/api/safras/${id}`, "PATCH", body),
  deleteSafra: (id: number) => send<SafrasData>(`/api/safras/${id}`, "DELETE"),
  setSafra: (id: number) => send<SafrasData>("/api/safras/current", "PUT", { id }),
  entradaCanaConfig: () => get<EntradaCanaConfig>("/api/entrada-cana/config"),
  entradaCanaImport: (body: { files: EntradaCanaFileInput[]; options: EntradaCanaImportOptions }) =>
    send<EntradaCanaImportResult>("/api/entrada-cana/import", "POST", body),
  colheitaEntradaCaminhao: (params: { dataInicio?: string; dataFim?: string; busca?: string; caminhao?: string }) => {
    const q = new URLSearchParams();
    if (params.dataInicio) q.set("dataInicio", params.dataInicio);
    if (params.dataFim) q.set("dataFim", params.dataFim);
    if (params.busca) q.set("busca", params.busca);
    if (params.caminhao) q.set("caminhao", params.caminhao);
    return get<{ resumo: ColheitaListResumo; dados: ColheitaCaminhaoRow[] }>(`/api/entrada-cana-caminhao?${q}`);
  },
  colheitaEntradaMaquina: (params: { dataInicio?: string; dataFim?: string; busca?: string; maquina?: string }) => {
    const q = new URLSearchParams();
    if (params.dataInicio) q.set("dataInicio", params.dataInicio);
    if (params.dataFim) q.set("dataFim", params.dataFim);
    if (params.busca) q.set("busca", params.busca);
    if (params.maquina) q.set("maquina", params.maquina);
    return get<{ resumo: ColheitaListResumo; dados: ColheitaMaquinaRow[] }>(`/api/entrada-cana-maquina?${q}`);
  },
  colheitaCaminhoesDistinct: (params: { dataInicio?: string; dataFim?: string }) => {
    const q = new URLSearchParams();
    if (params.dataInicio) q.set("dataInicio", params.dataInicio);
    if (params.dataFim) q.set("dataFim", params.dataFim);
    return get<{ resumo: ColheitaListResumo; dados: ColheitaVinculoItem[] }>(`/api/entrada-cana-caminhao/caminhoes?${q}`);
  },
  colheitaMaquinasDistinct: (params: { dataInicio?: string; dataFim?: string }) => {
    const q = new URLSearchParams();
    if (params.dataInicio) q.set("dataInicio", params.dataInicio);
    if (params.dataFim) q.set("dataFim", params.dataFim);
    return get<{ resumo: ColheitaListResumo; dados: ColheitaVinculoItem[] }>(`/api/entrada-cana-maquina/maquinas?${q}`);
  },
  colheitaAtualizarEquipamentoCaminhao: (body: {
    caminhao: string;
    dataInicio: string;
    dataFim: string;
    codEquipamento?: string | number | null;
    limpar?: boolean;
  }) => send<ColheitaAtualizarEquipamentoResult>("/api/entrada-cana-caminhao/atualizar-equipamento", "POST", body),
  colheitaAtualizarEquipamentoMaquina: (body: {
    maquina: string;
    dataInicio: string;
    dataFim: string;
    codEquipamento?: string | number | null;
    limpar?: boolean;
  }) => send<ColheitaAtualizarEquipamentoResult>("/api/entrada-cana-maquina/atualizar-equipamento", "POST", body),
  colheitaHorasMaquina: (params: {
    dataInicio?: string;
    dataFim?: string;
    busca?: string;
    equipamento?: string;
    codTipoEquipamento?: number | null;
  }) => {
    const q = new URLSearchParams();
    if (params.dataInicio) q.set("dataInicio", params.dataInicio);
    if (params.dataFim) q.set("dataFim", params.dataFim);
    if (params.busca) q.set("busca", params.busca);
    if (params.equipamento) q.set("equipamento", params.equipamento);
    if (params.codTipoEquipamento != null) q.set("codTipoEquipamento", String(params.codTipoEquipamento));
    return get<{
      resumo: ColheitaListResumo;
      dados: ColheitaHorasRow[];
      filtros?: {
        tipos?: { codTipoEquipamento: number; label: string }[];
        codTipoEquipamento?: number | null;
      };
    }>(`/api/horas-maquina?${q}`);
  },
  colheitaLiberacaoOpcoes: (params: { safraCode?: string; dataInicio?: string; dataFim?: string }) => {
    const q = new URLSearchParams();
    if (params.safraCode) q.set("safraCode", params.safraCode);
    if (params.dataInicio) q.set("dataInicio", params.dataInicio);
    if (params.dataFim) q.set("dataFim", params.dataFim);
    return get<{
      codFazendas: PremiseOption[];
      fazendas: PremiseOption[];
      talhoes: PremiseOption[];
    }>(`/api/liberacao-colheita/opcoes?${q}`);
  },
  colheitaLiberacao: (params: {
    safraCode?: string;
    dataInicio?: string;
    dataFim?: string;
    busca?: string;
    codFazendas?: string[];
    fazendas?: string[];
    talhoes?: string[];
  }) => {
    const q = new URLSearchParams();
    if (params.safraCode) q.set("safraCode", params.safraCode);
    if (params.dataInicio) q.set("dataInicio", params.dataInicio);
    if (params.dataFim) q.set("dataFim", params.dataFim);
    if (params.busca) q.set("busca", params.busca);
    for (const cod of params.codFazendas ?? []) q.append("codFazenda", cod);
    for (const fazenda of params.fazendas ?? []) q.append("fazenda", fazenda);
    for (const talhao of params.talhoes ?? []) q.append("talhao", talhao);
    return get<{ resumo: ColheitaListResumo; dados: LiberacaoColheitaRow[] }>(`/api/liberacao-colheita?${q}`);
  },
  colheitaEncerrarOrdens: (body: {
    dataInicio: string;
    dataFim: string;
    dataEncerramento?: string;
    obsEncerramento?: string;
    usuarioEncerramento?: string;
  }) => send<ColheitaEncerramentoOrdensResult>("/api/colheita/encerrar-ordens", "POST", body),
  colheitaCaminhaoTerceiroList: (params: { caminhao?: string; dataInicio?: string; dataFim?: string }) => {
    const q = new URLSearchParams();
    if (params.caminhao) q.set("caminhao", params.caminhao);
    if (params.dataInicio) q.set("dataInicio", params.dataInicio);
    if (params.dataFim) q.set("dataFim", params.dataFim);
    return get<{ dados: CaminhaoTerceiroVinculo[] }>(`/api/colheita/caminhao-terceiro?${q}`);
  },
  colheitaCaminhaoTerceiroSave: (body: {
    caminhao: string;
    nomeTerceiro: string;
    dataInicio: string;
    dataFim: string;
  }) => send<CaminhaoTerceiroVinculo>("/api/colheita/caminhao-terceiro", "POST", body),
  colheitaCaminhaoTerceiroRemove: (id: number) =>
    send<CaminhaoTerceiroVinculo>(`/api/colheita/caminhao-terceiro/${id}`, "DELETE"),
  colheitaEquipamentoTerceiroList: (params: { busca?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.busca) q.set("busca", params.busca);
    return get<{ dados: EquipamentoTerceiro[] }>(`/api/colheita/equipamento-terceiro?${q}`);
  },
  colheitaEquipamentoTerceiroSave: (body: { codEquipamento: string }) =>
    send<EquipamentoTerceiro>("/api/colheita/equipamento-terceiro", "POST", body),
  colheitaEquipamentoTerceiroRemove: (codEquipamento: string) =>
    send<EquipamentoTerceiro>(`/api/colheita/equipamento-terceiro/${encodeURIComponent(codEquipamento)}`, "DELETE"),
  colheitaResumoTransporteOpcoes: (params: {
    safraCode?: string;
    dataInicio?: string;
    dataFim?: string;
    modo?: ResumoTransporteModo;
  }) => {
    const q = new URLSearchParams();
    if (params.safraCode) q.set("safraCode", params.safraCode);
    if (params.dataInicio) q.set("dataInicio", params.dataInicio);
    if (params.dataFim) q.set("dataFim", params.dataFim);
    if (params.modo) q.set("modo", params.modo);
    return get<{ caminhoes: PremiseOption[]; terceiros: PremiseOption[]; truncado?: boolean; modo?: ResumoTransporteModo }>(
      `/api/resumo-transporte-cana/opcoes?${q}`,
    );
  },
  colheitaResumoTransporte: (params: {
    safraCode?: string;
    reportSafraCode?: string;
    dataInicio?: string;
    dataFim?: string;
    refDate?: string;
    caminhoes?: string[];
    terceiros?: string[];
    modo?: ResumoTransporteModo;
  }) => {
    const q = new URLSearchParams();
    if (params.safraCode) q.set("safraCode", params.safraCode);
    if (params.reportSafraCode) q.set("reportSafraCode", params.reportSafraCode);
    if (params.dataInicio) q.set("dataInicio", params.dataInicio);
    if (params.dataFim) q.set("dataFim", params.dataFim);
    if (params.refDate) q.set("refDate", params.refDate);
    if (params.modo) q.set("modo", params.modo);
    for (const cam of params.caminhoes ?? []) q.append("caminhao", cam);
    for (const ter of params.terceiros ?? []) q.append("terceiro", ter);
    return get<ResumoTransporteCanaData>(`/api/resumo-transporte-cana?${q}`);
  },
  indicadoresColheitaProducaoFrota: (params?: { refDate?: string }) => {
    const q = new URLSearchParams();
    if (params?.refDate) q.set("refDate", params.refDate);
    return get<IndicadoresColheitaProducaoData>(`/api/indicadores/colheita-producao/frota?${q}`);
  },
  indicadoresColheitaProducao: (params: {
    dataInicio?: string;
    dataFim?: string;
    refDate?: string;
    codTipoEquipamento?: number;
    codEquipamentos?: number[];
    modo?: "completo" | "producao-total";
  }) => {
    const q = new URLSearchParams();
    if (params.dataInicio) q.set("dataInicio", params.dataInicio);
    if (params.dataFim) q.set("dataFim", params.dataFim);
    if (params.refDate) q.set("refDate", params.refDate);
    if (params.modo) q.set("modo", params.modo);
    if (params.codTipoEquipamento != null) q.set("codTipoEquipamento", String(params.codTipoEquipamento));
    if (params.codEquipamentos?.length) q.set("codEquipamento", params.codEquipamentos.join(","));
    return get<IndicadoresColheitaProducaoData>(`/api/indicadores/colheita-producao?${q}`);
  },
  indicadoresColheitaQualidade: (params: {
    dataInicio: string;
    dataFim: string;
    codEquipamentos?: number[];
  }) => {
    const q = new URLSearchParams({
      dataInicio: params.dataInicio,
      dataFim: params.dataFim,
    });
    if (params.codEquipamentos?.length) q.set("codEquipamento", params.codEquipamentos.join(","));
    return get<IndicadoresColheitaQualidadeData>(`/api/indicadores/colheita-qualidade?${q}`);
  },
  indicadoresColheitaOleoHidraulico: (params: {
    dataInicio: string;
    dataFim: string;
    safraCode?: string;
  }) => {
    const q = new URLSearchParams({
      dataInicio: params.dataInicio,
      dataFim: params.dataFim,
    });
    if (params.safraCode) q.set("safraCode", params.safraCode);
    return get<ConsumoOleoHidraulicoData>(`/api/indicadores/colheita-oleo-hidraulico?${q}`);
  },
  indicadoresColheitaPerdasAnalitico: (params: {
    dataInicio: string;
    dataFim: string;
    agrupamento?: PerdasAnaliticoAgrupamento;
    codEquipamentos?: number[];
  }) => {
    const q = new URLSearchParams({
      dataInicio: params.dataInicio,
      dataFim: params.dataFim,
    });
    if (params.agrupamento) q.set("agrupamento", params.agrupamento);
    if (params.codEquipamentos?.length) q.set("codEquipamento", params.codEquipamentos.join(","));
    return get<PerdasColheitaAnaliticoData>(`/api/indicadores/colheita-perdas-analitico?${q}`);
  },
  indicadoresColheitaDiaria: (params: {
    dataInicio: string;
    dataFim: string;
    fonte?: "entradacanamaquina" | "colheitadiaria";
  }) => {
    const q = new URLSearchParams({ dataInicio: params.dataInicio, dataFim: params.dataFim });
    if (params.fonte) q.set("fonte", params.fonte);
    return get<{ dados: Array<{ data: string; toneladas: number; previsao: number | null }> }>(
      `/api/indicadores/colheita-diaria?${q}`,
    );
  },
  indicadoresRelatorioDiarioProducao: (params: { data: string; dataInicio?: string | null; safraInicio?: string | null }) => {
    const q = new URLSearchParams({ data: params.data });
    if (params.dataInicio) q.set("dataInicio", params.dataInicio);
    if (params.safraInicio) q.set("safraInicio", params.safraInicio);
    return get<RelatorioDiarioProducaoData>(`/api/indicadores/relatorio-diario-producao?${q}`);
  },
  indicadoresParadasColheita: (params: { dataInicio: string; dataFim: string }) => {
    const q = new URLSearchParams({ dataInicio: params.dataInicio, dataFim: params.dataFim });
    return get<ParadasColheitaData>(`/api/indicadores/paradas-colheita?${q}`);
  },
  indicadoresDisponibilidadeEquipamentos: (params?: {
    safraCode?: string;
    dataInicio?: string;
    dataFim?: string;
    codTiposEquipamento?: number[];
  }) => {
    const q = new URLSearchParams();
    if (params?.safraCode) q.set("safraCode", params.safraCode);
    if (params?.dataInicio) q.set("dataInicio", params.dataInicio);
    if (params?.dataFim) q.set("dataFim", params.dataFim);
    for (const cod of params?.codTiposEquipamento ?? []) {
      q.append("codTipoEquipamento", String(cod));
    }
    const suffix = q.toString() ? `?${q}` : "";
    return get<IndicadoresDisponibilidadeEquipamentosData>(`/api/indicadores/disponibilidade-equipamentos${suffix}`);
  },
  indicadoresDisponibilidadePorTipo: (params?: {
    safraCode?: string;
    dataInicio?: string;
    dataFim?: string;
  }) => {
    const q = new URLSearchParams();
    if (params?.safraCode) q.set("safraCode", params.safraCode);
    if (params?.dataInicio) q.set("dataInicio", params.dataInicio);
    if (params?.dataFim) q.set("dataFim", params.dataFim);
    const suffix = q.toString() ? `?${q}` : "";
    return get<IndicadoresDisponibilidadePorTipoData>(`/api/indicadores/disponibilidade-por-tipo${suffix}`);
  },
  indicadoresGestaoManutencao: (params?: {
    ano?: number;
    dataInicio?: string | null;
    dataFim?: string | null;
    categoria?: string | null;
    codTipoEquipamento?: number | null;
    codEquipamento?: number | null;
    tipoMaterial?: string | null;
    codObjetoCusto?: number | null;
  }) => {
    const q = new URLSearchParams();
    if (params?.ano != null) q.set("ano", String(params.ano));
    if (params?.dataInicio) q.set("dataInicio", params.dataInicio);
    if (params?.dataFim) q.set("dataFim", params.dataFim);
    if (params?.categoria) q.set("categoria", params.categoria);
    if (params?.codTipoEquipamento != null) q.set("codTipoEquipamento", String(params.codTipoEquipamento));
    if (params?.codEquipamento != null) q.set("codEquipamento", String(params.codEquipamento));
    if (params?.tipoMaterial) q.set("tipoMaterial", params.tipoMaterial);
    if (params?.codObjetoCusto != null) q.set("codObjetoCusto", String(params.codObjetoCusto));
    const suffix = q.toString() ? `?${q}` : "";
    return get<GestaoManutencaoData>(`/api/indicadores/gestao-manutencao${suffix}`);
  },
  indicadoresGestaoManutencaoOs: (anoOs: number, numeroOs: number) =>
    get<GestaoManutencaoOsDetalhe>(
      `/api/indicadores/gestao-manutencao/os?ano=${encodeURIComponent(String(anoOs))}&numero=${encodeURIComponent(String(numeroOs))}`,
    ),
  indicadoresMonitoramentoOs: (params?: {
    box?: number | null;
    codTipoEquipamento?: number | null;
    codEquipamento?: number | null;
  }) => {
    const q = new URLSearchParams();
    if (params?.box != null) q.set("box", String(params.box));
    if (params?.codTipoEquipamento != null) q.set("codTipoEquipamento", String(params.codTipoEquipamento));
    if (params?.codEquipamento != null) q.set("codEquipamento", String(params.codEquipamento));
    const suffix = q.toString() ? `?${q}` : "";
    return get<MonitoramentoOsData>(`/api/indicadores/gestao-manutencao/monitoramento-os${suffix}`);
  },
  indicadoresGestaoManutencaoConfig: () =>
    get<{
      metaMttrHoras: number;
      metaMtbfHoras: number;
      metaDisponibilidade: number;
      metasPorTipo: Record<string, { metaMttrHoras: number; metaMtbfHoras: number; metaDisponibilidade: number }>;
    }>(
      "/api/indicadores/gestao-manutencao/config",
    ),
  indicadoresGestaoManutencaoConfigSave: (body: {
    metaMttrHoras?: number;
    metaMtbfHoras?: number;
    metaDisponibilidade?: number;
    metasPorTipo?: Record<string, { metaMttrHoras: number; metaMtbfHoras: number; metaDisponibilidade: number }>;
  }) =>
    send<{
      metaMttrHoras: number;
      metaMtbfHoras: number;
      metaDisponibilidade: number;
      metasPorTipo: Record<string, { metaMttrHoras: number; metaMtbfHoras: number; metaDisponibilidade: number }>;
    }>(
      "/api/indicadores/gestao-manutencao/config",
      "PUT",
      body,
    ),
  indicadoresCombustivel: (params?: { dataInicio?: string; dataFim?: string }) => {
    const q = new URLSearchParams();
    if (params?.dataInicio) q.set("dataInicio", params.dataInicio);
    if (params?.dataFim) q.set("dataFim", params.dataFim);
    const suffix = q.toString() ? `?${q}` : "";
    return get<IndicadoresCombustivelData>(`/api/indicadores/combustivel${suffix}`);
  },
  indicadoresMapaFazendas: (params: {
    safraCode?: string;
    dataInicio?: string;
    dataFim?: string;
    areasAplicadas?: boolean;
    entomologico?: boolean;
    irrigacao?: boolean;
    entomologicoIndice?: IndicadoresMapaEntomoIndice;
    operacao?: string;
    operacaoDescricao?: string;
  }) => {
    const q = new URLSearchParams();
    if (params.safraCode) q.set("safraCode", params.safraCode);
    if (params.dataInicio) q.set("dataInicio", params.dataInicio);
    if (params.dataFim) q.set("dataFim", params.dataFim);
    if (params.areasAplicadas) q.set("areasAplicadas", "1");
    if (params.entomologico) q.set("entomologico", "1");
    if (params.irrigacao) q.set("irrigacao", "1");
    if (params.entomologicoIndice) q.set("entomologicoIndice", params.entomologicoIndice);
    if (params.operacao) q.set("operacao", params.operacao);
    if (params.operacaoDescricao) q.set("operacaoDescricao", params.operacaoDescricao);
    // Cada clique em Consultar deve buscar uma resposta nova, mesmo quando os
    // filtros são idênticos à consulta anterior.
    q.set("_ts", String(Date.now()));
    return get<IndicadoresMapaFazendasData>(`/api/indicadores/mapa-fazendas?${q}`);
  },
  indicadoresControleEstoque: (params?: { anomes?: string; busca?: string; almoxarifado?: number | string }) => {
    const q = new URLSearchParams();
    if (params?.anomes) q.set("anomes", params.anomes);
    if (params?.busca) q.set("busca", params.busca);
    if (params?.almoxarifado != null && String(params.almoxarifado).trim() !== "") {
      q.set("almoxarifado", String(params.almoxarifado));
    }
    const suffix = q.toString() ? `?${q}` : "";
    return get<ControleEstoqueData>(`/api/indicadores/controle-estoque${suffix}`);
  },
  indicadoresIrrigacaoOpcoes: () =>
    get<IndicadoresIrrigacaoData["opcoes"]>("/api/indicadores/irrigacao/opcoes"),
  indicadoresIrrigacao: (params?: {
    dataInicio?: string;
    dataFim?: string;
    codEquipamento?: string;
    codFazenda?: string;
    campo?: string;
    tipoEquipamento?: string;
  }) => {
    const q = new URLSearchParams();
    if (params?.dataInicio) q.set("dataInicio", params.dataInicio);
    if (params?.dataFim) q.set("dataFim", params.dataFim);
    if (params?.codEquipamento) q.set("codEquipamento", params.codEquipamento);
    if (params?.codFazenda) q.set("codFazenda", params.codFazenda);
    if (params?.campo) q.set("campo", params.campo);
    if (params?.tipoEquipamento) q.set("tipoEquipamento", params.tipoEquipamento);
    const suffix = q.toString() ? `?${q}` : "";
    return get<IndicadoresIrrigacaoData>(`/api/indicadores/irrigacao${suffix}`);
  },
  indicadoresIrrigacaoDashboard: (params?: {
    safraCode?: string;
    dataInicio?: string;
    dataFim?: string;
    sistemas?: IrrigacaoDashboardSistemaId[];
  }) => {
    const q = new URLSearchParams();
    if (params?.safraCode) q.set("safraCode", params.safraCode);
    if (params?.dataInicio) q.set("dataInicio", params.dataInicio);
    if (params?.dataFim) q.set("dataFim", params.dataFim);
    for (const sistema of params?.sistemas ?? []) {
      q.append("sistema", sistema);
    }
    const suffix = q.toString() ? `?${q}` : "";
    return get<IrrigacaoDashboardData>(`/api/indicadores/irrigacao/dashboard${suffix}`);
  },
  indicadoresGestaoMateriais: (params?: {
    dataInicio?: string;
    dataFim?: string;
    tipos?: string[];
    almoxarifado?: string;
    codMaterial?: string;
    codObjetoCusto?: string;
    mesesEstoque?: string;
    mesesSugerida?: string;
  }) => {
    const q = new URLSearchParams();
    if (params?.dataInicio) q.set("dataInicio", params.dataInicio);
    if (params?.dataFim) q.set("dataFim", params.dataFim);
    for (const tipo of params?.tipos ?? []) {
      if (tipo.trim()) q.append("tipos", tipo.trim());
    }
    if (params?.almoxarifado) q.set("almoxarifado", params.almoxarifado);
    if (params?.codMaterial) q.set("codMaterial", params.codMaterial);
    if (params?.codObjetoCusto) q.set("codObjetoCusto", params.codObjetoCusto);
    if (params?.mesesEstoque) q.set("mesesEstoque", params.mesesEstoque);
    if (params?.mesesSugerida) q.set("mesesSugerida", params.mesesSugerida);
    const suffix = q.toString() ? `?${q}` : "";
    return get<GestaoMateriaisData>(`/api/indicadores/gestao-materiais${suffix}`);
  },
  indicadoresManutencaoProgramada: () => get<ManutencaoProgramadaQuadroData>("/api/indicadores/manutencao-programada"),
  indicadoresManutencaoConfig: () =>
    get<ManutencaoProgramadaConfig>("/api/indicadores/manutencao-programada/config"),
  salvarIndicadoresManutencaoConfig: (body: ManutencaoProgramadaConfig) =>
    send<ManutencaoProgramadaConfig>("/api/indicadores/manutencao-programada/config", "PUT", body),
  indicadoresManutencaoPlanos: () =>
    get<{ planos: ManutencaoPlanoPrevencaoItem[] }>("/api/indicadores/manutencao-programada/planos"),
  indicadoresLubrificacao: (params?: { codEquipamento?: number | string; ano?: number; mes?: number }) => {
    const q = new URLSearchParams();
    if (params?.codEquipamento != null && String(params.codEquipamento).trim() !== "") {
      q.set("codEquipamento", String(params.codEquipamento));
    }
    if (params?.ano != null && Number.isFinite(params.ano)) q.set("ano", String(params.ano));
    if (params?.mes != null && Number.isFinite(params.mes)) q.set("mes", String(params.mes));
    const suffix = q.toString() ? `?${q}` : "";
    return get<LubrificacaoDashboardData>(`/api/indicadores/lubrificacao${suffix}`);
  },
  indicadoresPneus: () => get<PneusData>("/api/indicadores/pneus"),
  indicadoresManutencaoComponentes: (params?: { codEquipamento?: number | string | null }) => {
    const q = new URLSearchParams();
    if (params?.codEquipamento != null && String(params.codEquipamento).trim() !== "") {
      q.set("codEquipamento", String(params.codEquipamento));
    }
    const suffix = q.toString() ? `?${q}` : "";
    return get<ManutencaoProgramadaComponentesData>(`/api/indicadores/manutencao-programada/componentes${suffix}`);
  },
  colheitaFazendasEntrada: (params: { dataInicio?: string; dataFim?: string; busca?: string }) => {
    const q = new URLSearchParams();
    if (params.dataInicio) q.set("dataInicio", params.dataInicio);
    if (params.dataFim) q.set("dataFim", params.dataFim);
    if (params.busca) q.set("busca", params.busca);
    return get<{ resumo: ColheitaListResumo; dados: ColheitaFazendaEntradaRow[] }>(`/api/fazenda-usina/fazendas-entrada?${q}`);
  },
  colheitaFazendasSistema: (busca?: string) =>
    get<{ resumo: ColheitaListResumo; dados: ColheitaFazendaSistemaRow[] }>(
      busca ? `/api/fazenda-usina/sistema?busca=${encodeURIComponent(busca)}` : "/api/fazenda-usina/sistema",
    ),
  colheitaFazendaUsina: (busca?: string) =>
    get<{ resumo: ColheitaListResumo; dados: ColheitaFazendaUsinaRow[] }>(
      busca ? `/api/fazenda-usina?busca=${encodeURIComponent(busca)}` : "/api/fazenda-usina",
    ),
  colheitaSalvarFazendaUsina: (body: {
    descricaoUsina?: string;
    fazenda?: string;
    codSistema?: number | string | null;
    raio?: number | string | null;
    limpar?: boolean;
  }) => send<{ resumo: Record<string, unknown> }>("/api/fazenda-usina/salvar", "POST", body),
};
