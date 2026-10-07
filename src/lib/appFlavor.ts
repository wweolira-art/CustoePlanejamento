/** `custo` = orçamento e cadastros. Qualquer outro valor = colheita e indicadores. */
export const APP_FLAVOR = (import.meta.env.VITE_APP_FLAVOR || "agricola").trim().toLowerCase();
export const IS_CUSTO_APP = APP_FLAVOR === "custo";
export const APP_PRODUCT_NAME = IS_CUSTO_APP ? "Custo e Planejamento" : "Controle Agrícola";
