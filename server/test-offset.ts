const sql = `SELECT p.cod_empresa,
              p.cod_filial,
              p.cod_safra,
              p.numero_amostra,
              p.data_amostra,
              TO_CHAR(p.data_amostra, 'YYYY-MM') AS mes_ref,
              p.cod_equipamento,
              NVL(e.tag, TO_CHAR(p.cod_equipamento)) AS equip_tag,
              p.cod_operador,
              NVL(TRIM(vo.desc_operador), NVL(TRIM(f.cscfuncionario), 'Operador ' || p.cod_operador)) AS nome_operador,
              p.cod_fazenda,
              p.cod_talhao,
              TRIM(
                CASE
                  WHEN fz.descricao IS NOT NULL AND p.cod_talhao IS NOT NULL THEN fz.descricao || ' ' || p.cod_talhao
                  WHEN fz.descricao IS NOT NULL THEN fz.descricao
                  WHEN p.cod_fazenda IS NOT NULL AND p.cod_talhao IS NOT NULL THEN 'FAZ ' || p.cod_fazenda || ' ' || p.cod_talhao
                  ELSE 'FAZ ' || NVL(TO_CHAR(p.cod_fazenda), '?')
                END
              ) AS fazenda_desc,
              t.rendimentoagricola,
              pi.cod_tipoperda,
              NVL(tp.descricao, 'Tipo ' || pi.cod_tipoperda) AS tipo_perda_desc,
              NVL(pi.quantidade, 0) AS quantidade
         FROM agricola.perdas p
         LEFT JOIN agricola.perdas_itens pi
           ON pi.cod_grupoempresa = p.cod_grupoempresa
          AND pi.cod_empresa = p.cod_empresa
          AND pi.cod_filial = p.cod_filial
          AND pi.cod_safra = p.cod_safra
          AND pi.numero_amostra = p.numero_amostra
         LEFT JOIN agricola.tipo_perdacolheita tp
           ON tp.cod_tipoperda = pi.cod_tipoperda
         LEFT JOIN (
           SELECT cod_fazenda,
                  cod_talhao,
                  cod_safra,
                  MAX(rendimentoagricola) AS rendimentoagricola
             FROM agricola.talhao
            GROUP BY cod_fazenda, cod_talhao, cod_safra
         ) t
           ON t.cod_fazenda = p.cod_fazenda
          AND t.cod_talhao = p.cod_talhao
          AND t.cod_safra = p.cod_safra
         LEFT JOIN automotivo.equipamento e
           ON e.cod_equipamento = p.cod_equipamento
         LEFT JOIN agricola.sga_funcionario f
           ON TRIM(TO_CHAR(f.cdgfuncionario)) = TRIM(TO_CHAR(p.cod_operador))
         LEFT JOIN (
           SELECT TRIM(TO_CHAR(cod_funcionario)) AS cod_funcionario,
                  MAX(TRIM(desc_operador)) AS desc_operador
             FROM agricola.vw_operador
            WHERE cod_funcionario IS NOT NULL
            GROUP BY TRIM(TO_CHAR(cod_funcionario))
         ) vo
           ON vo.cod_funcionario = TRIM(TO_CHAR(p.cod_operador))
         LEFT JOIN agricola.fazenda fz
           ON fz.cod_fazenda = p.cod_fazenda
          AND fz.cod_grupoempresa = p.cod_grupoempresa
        WHERE p.cod_grupoempresa = :codGrupo
          AND p.data_amostra IS NOT NULL
          AND TRUNC(p.data_amostra) BETWEEN TO_DATE(:dataInicio, 'YYYY-MM-DD') AND TO_DATE(:dataFim, 'YYYY-MM-DD')
          AND EXISTS (
            SELECT 1
              FROM automotivo.historico_tipoequipamento ht
             WHERE ht.cod_equipamento = p.cod_equipamento
               AND ht.data_fim IS NULL
               AND ht.cod_tipoequipamento = :codTipoEquipamento
          )`;

const around = sql.substring(2370, 2420);
console.log("Offset 2392 area:", JSON.stringify(around));
console.log("Char at 2392:", JSON.stringify(sql[2392]));
// show context
console.log("sql[2380..2410]:", JSON.stringify(sql.substring(2380, 2410)));
