# Risk-of-Drought — risco de seca no Espírito Santo

Este projeto reúne dois scripts JavaScript do **Google Earth Engine (GEE)** para monitorar o sinal integrado de seca no Espírito Santo. Eles combinam desvios relativos de NDVI, precipitação e umidade superficial do solo em relação ao mesmo período de anos anteriores.

| Aplicação | Unidade de resumo | Código |
|---|---|---|
| DRIW — Drought Risk Index Watershed | Bacia hidrográfica, agrupada por `nom_regiao` | [driw-bacias.js](earth-engine/driw-bacias.js) |
| DRIM — Drought Risk Index Municipality | Município, agrupado por `nome` | [drim-municipios.js](earth-engine/drim-municipios.js) |

Ambos calculam o índice por pixel e depois resumem os resultados por unidade territorial. Os nomes DRIW e DRIM distinguem o recorte e os produtos; a fórmula é a mesma.

## Como o índice funciona

Para cada variável `X`, o script calcula `desvio_relativo = (X_atual − X_histórico) / X_histórico`. O índice é:

```text
I = −desvio_NDVI −desvio_chuva −desvio_umidade
```

Com referências positivas, déficits elevam o índice; excedentes reduzem-no. Por exemplo, déficits de 20% no NDVI, 50% na chuva e 40% na umidade resultam em `I = 1,10`, acima do limiar de alto risco adotado no código (`I > 1`). Esse é um exemplo matemático, não um resultado observado.

O índice é adimensional e não representa uma probabilidade de seca. Não há calibração, validação de impactos ou estimativa de incerteza implementada nos arquivos fornecidos.

## Insumos necessários

- Conta e projeto habilitados para executar o Earth Engine no [Code Editor](https://code.earthengine.google.com/).
- Acesso de leitura ao asset `projects/ee-aguascapixabas/assets/MUNICIPIOS_ES`, com geometrias válidas e campo `nome` para o DRIM. O DRIW também usa esse asset para o recorte estadual.
- Para o DRIW, acesso ao asset `projects/ee-aguascapixabas/assets/bacias_hidrograficas_AGERH`, com campo `nom_regiao`.
- Acesso às coleções Sentinel-2 SR Harmonized, CHIRPS V3 DAILY_SAT e SMAP SPL4SMGP versão 008, consultadas diretamente no GEE.
- Definição do recorte, período analisado e referência histórica. O ano atual está fixado em **2026** nos scripts.
- Permissão de exportação ao Google Drive e espaço disponível. A transferência da pasta temporária para a pasta final exige automação externa não incluída.

## Acesso aos assets vetoriais

| Layer | Abrir no Earth Engine | Uso |
|---|---|---|
| Municípios do Espírito Santo | [MUNICIPIOS_ES](https://code.earthengine.google.com/?asset=projects/ee-aguascapixabas/assets/MUNICIPIOS_ES) | Recorte estadual e análise municipal; campo `nome` no DRIM |
| Bacias hidrográficas | [bacias_hidrograficas_AGERH](https://code.earthengine.google.com/?asset=projects/ee-aguascapixabas/assets/bacias_hidrograficas_AGERH) | Análise por bacias; campo `nom_regiao` no DRIW |

Os links abrem os assets no Code Editor do GEE. É necessário entrar com uma conta habilitada para o Earth Engine. O acesso depende das permissões de compartilhamento de cada asset; disponibilizar o link não altera essas permissões nem autentica este ambiente. A leitura dos assets por estes links não foi verificada nesta atualização.

## Execução

1. Abra um dos arquivos de `earth-engine/` no Code Editor e execute-o separadamente. Não é uma aplicação Node.js nem requer `npm install`.
2. Confirme o acesso aos assets e a presença dos campos de seleção.
3. Escolha todo o Espírito Santo ou uma unidade específica, as datas e a referência histórica. O padrão é 1 a 31 de julho de 2026, com a máxima série configurada de cada base.
4. Mantenha, se apropriado, a opção de limitar à última data comum das coleções. Clique em **EXECUTAR** e confira o console, as camadas, os valores e as máscaras de dados.
5. Use **CSV** ou **DRIVE** para criar tarefas de exportação. Inicie e acompanhe essas tarefas na aba **Tasks/Tarefas** do GEE; criar a tarefa não conclui a exportação.

Consulte a [documentação técnica](docs/metodologia.md) para as fórmulas, etapas, classes, dicionário das saídas, limitações e roteiro de verificação.

## Estado dos arquivos

Os dois scripts foram preservados integralmente a partir dos textos fornecidos pelo responsável pelo projeto. A documentação descreve a implementação recebida; não modifica sua metodologia. A sintaxe JavaScript foi verificada com `node --check`, mas os cálculos e as exportações não foram executados no Earth Engine nesta documentação. O acesso aos assets, a disponibilidade das coleções e os resultados geoespaciais dependem de validação na conta GEE autorizada.
