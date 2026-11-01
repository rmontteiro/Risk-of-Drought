# Documentação técnica de DRIW e DRIM

## 1. Escopo e rastreabilidade

Esta leitura técnica foi elaborada em 1 de novembro de 2026 com base nos dois arquivos fornecidos pelo responsável pelo projeto, preservados em [DRIW](../earth-engine/driw-bacias.js) e [DRIM](../earth-engine/drim-municipios.js). Os comentários de intenção foram confrontados com as funções efetivamente implementadas. Não foram fornecidos resultados, validação de campo, assets vetoriais ou código de Google Apps Script.

As aplicações permitem uma análise estadual com resumo por unidade ou uma análise de unidade específica. Não calculam vazão, balanço hídrico completo, reservação, demanda de água, exposição ou vulnerabilidade socioeconômica. O produto chamado de “risco” no código expressa um sinal integrado de anomalias ambientais no período escolhido; não é uma previsão meteorológica nem uma probabilidade de impacto.

## 2. Bases de entrada

| Componente | Coleção/asset exato | Campo ou banda | Uso na implementação |
|---|---|---|---|
| Vegetação | `COPERNICUS/S2_SR_HARMONIZED` | `B8`, `B4`, `CLOUDY_PIXEL_PERCENTAGE` | NDVI de cada cena e média temporal |
| Chuva | `UCSB-CHC/CHIRPS/V3/DAILY_SAT` | `precipitation` | Soma no período, em mm |
| Umidade do solo | `NASA/SMAP/SPL4SMGP/008` | `sm_surface` | Média temporal da umidade superficial, em m³/m³ |
| Municípios | `projects/ee-aguascapixabas/assets/MUNICIPIOS_ES` | `nome` no DRIM | Recorte estadual e unidades municipais |
| Bacias | `projects/ee-aguascapixabas/assets/bacias_hidrograficas_AGERH` | `nom_regiao` | Unidades de resumo do DRIW |

### Links de acesso aos layers

| Layer | Abrir no Earth Engine | Uso |
|---|---|---|
| Municípios do Espírito Santo | [MUNICIPIOS_ES](https://code.earthengine.google.com/?asset=projects/ee-aguascapixabas/assets/MUNICIPIOS_ES) | Recorte estadual e análise municipal; campo `nome` no DRIM |
| Bacias hidrográficas | [bacias_hidrograficas_AGERH](https://code.earthengine.google.com/?asset=projects/ee-aguascapixabas/assets/bacias_hidrograficas_AGERH) | Análise por bacias; campo `nom_regiao` no DRIW |

Os links abrem os assets no Code Editor do GEE. É necessário entrar com uma conta habilitada para o Earth Engine. O acesso depende das permissões de compartilhamento de cada asset; disponibilizar o link não altera essas permissões nem autentica este ambiente. A leitura dos assets por estes links não foi verificada nesta atualização.

Os dados raster são lidos no servidor do GEE; não é necessário fornecer CSV de chuva ou baixar imagens previamente. Os assets vetoriais precisam estar publicados e compartilhados com a identidade executora. Os identificadores dos assets não concedem acesso por si só.

Os campos territoriais devem conter nomes consistentes, não nulos e sem colisões entre unidades distintas. Os scripts obtêm os nomes distintos, ordenam-nos e reúnem as geometrias de feições com o mesmo nome. Isso agrega partes de uma unidade, mas também reúne indevidamente unidades diferentes que tenham o mesmo valor. Os demais atributos originais não são preservados nessa reconstrução.

No DRIW estadual, a região de interesse é a geometria dos municípios, enquanto as zonas são as bacias agrupadas. No modo de bacia específica, a região é a geometria inteira da bacia selecionada; não há interseção explícita com o limite estadual. Se o asset de bacias ultrapassar o estado, os dois modos podem ter suportes espaciais diferentes. No DRIM, o recorte e as zonas derivam dos municípios agrupados.

## 3. Parâmetros e datas

| Parâmetro | Valor recebido | Efeito |
|---|---|---|
| `CURRENT_YEAR` | `2026` | Ano dos dados atuais e da consulta de disponibilidade |
| Datas da interface | 2026-01-01 a 2026-12-31 | Padrão selecionado: 2026-07-01 a 2026-07-31 |
| `MAX_CLOUD_PERCENT` | `20` | Aceita cenas Sentinel-2 com metadado de nuvens ≤ 20% |
| `ANALYSIS_CRS` | `EPSG:31984` | SIRGAS 2000 / UTM zona 24S |
| `SCALE_INDEX` | `5000` m | Escala solicitada nas médias territoriais |
| `SCALE_EXPORT` | `250` m | Tamanho de pixel solicitado no GeoTIFF |
| `HIGH_RISK_THRESHOLD` | `1.0` | Máscara de alto risco estritamente acima de 1 |

A data final é incluída: `endOfPeriod` acrescenta um dia para uso em `filterDate`, cujo limite final é exclusivo. As mesmas combinações de mês e dia são aplicadas a cada ano histórico. O processamento atual usa `CURRENT_YEAR`, não extrai o ano para o cálculo a partir do controle de datas. Uma atualização anual exige revisar tanto a constante quanto os limites/padrões da interface e os anos de referência.

### Referências históricas

| Modo | NDVI | Chuva | Umidade |
|---|---|---|---|
| Período comum | Anos escolhidos entre 2018 e 2025 | Mesmos anos | Mesmos anos |
| Máxima série de cada base (padrão) | 2018–2025 | 1981–2025 | 2016–2025 |
| Personalizado | Intervalo próprio entre 2018 e 2025 | Intervalo próprio entre 1981 e 2025 | Intervalo próprio entre 2016 e 2025 |

“Máxima série” significa os intervalos fixados no código, sem descoberta automática da maior série disponível. Os anos extremos são incluídos. Intervalos históricos invertidos e data final anterior à inicial são rejeitados.

### Última data comum

`checkLatestDate` consulta o maior `system:time_start` de cada coleção em 2026 e toma o menor dos três valores. Para Sentinel-2, aplica recorte espacial e filtro de nuvens; para CHIRPS e SMAP, a consulta de disponibilidade não aplica recorte espacial. Com a opção ativada, o fim efetivo é o menor entre o fim solicitado e essa data comum. Se o início ultrapassar esse fim, o processamento é interrompido.

Essa regra verifica atualidade das coleções, não completude diária, coincidência de observações, cobertura de cada pixel ou existência de dados em todos os anos históricos. Mesmo desativando o limite, a consulta de disponibilidade continua sendo executada e exige dados nas três bases no ano atual.

## 4. Processamento e fórmula

### 4.1 Agregação temporal

Para cada ano `y` e para a mesma janela de mês/dia:

1. `annualNDVI` filtra Sentinel-2 por datas, interseção com a região e nuvens da cena. Calcula `NDVI = (B8 − B4)/(B8 + B4)` por imagem e toma a média temporal por pixel. Não calcula NDVI a partir da média das bandas.
2. `annualRain` soma os valores de `precipitation` na janela. “Anual” no nome da função indica a repetição por ano; não implica somar o ano inteiro.
3. `annualSM` toma a média temporal de `sm_surface` na janela.
4. `get*Current` chama as funções para 2026, converte/tipa as bandas em ponto flutuante e recorta a região.
5. `build*Historical` calcula um agregado por ano e depois a média desses agregados anuais. Assim, a referência de chuva é a média de totais da janela, e não a soma de todos os anos. Cada agregado anual válido recebe o mesmo peso, independentemente do número de cenas que o originou.

### 4.2 Anomalias e normalização

Para `X` em NDVI, chuva e umidade:

```text
A_X = X_atual − H_X
N_X = A_X / H_X
I   = −N_NDVI − N_chuva − N_umidade
```

`H_X` é a média histórica da janela correspondente. As camadas de anomalia no mapa mostram `A_X`, nas unidades originais. As colunas `*_ANOM_PCT` mostram `100 × N_X`. O índice combina as frações, sem multiplicar por 100 e sem dividir a soma por três.

Os três coeficientes são iguais a −1. Isso dá o mesmo coeficiente nominal às variáveis, mas não garante influência estatística igual: amplitudes, variabilidade, denominadores e dependência entre chuva, vegetação e solo diferem. Excedentes de uma variável podem compensar déficits de outra. O índice não é padronizado por desvio-padrão, não é SPI/SPEI e não tem faixa universal de 0 a 1. A interpretação de sinal pressupõe referências positivas; referências negativas de NDVI podem inverter a interpretação do desvio relativo.

### 4.3 Classes implementadas

| Código raster | Intervalo exato | Interpretação exibida | Cor |
|---|---|---|---|
| 0 | `I < 0` | Condição mais úmida que a referência | Verde escuro |
| 1 | `0 ≤ I < 0,25` | Déficit integrado fraco | Verde claro |
| 2 | `0,25 ≤ I < 0,50` | Déficit integrado moderado | Amarelo |
| 3 | `0,50 ≤ I ≤ 1,00` | Déficit integrado forte | Laranja |
| 4 | `I > 1,00` | Alto risco de seca | Vermelho |

O valor exatamente igual a 1 pertence à classe 3. As funções `classifyDRIW` e `classifyDRIM` usam limites literais; alterar apenas `HIGH_RISK_THRESHOLD` não atualiza automaticamente as classes ou os textos das legendas. A máscara de alto risco usa a constante e `selfMask`, exibindo somente pixels acima do limiar.

Esses rótulos e limiares são convenções da implementação fornecida. Não foi apresentada evidência de calibração regional. O rótulo da classe 0 descreve o saldo integrado; uma variável individual ainda pode estar deficitária.

## 5. Produtos e dicionário de dados

### Mapas e resumo

A interface alterna entre classes, índice contínuo, três anomalias absolutas e máscara de alto risco; os limites territoriais podem ser ligados ou desligados. O índice contínuo é visualizado entre 0 e 1,5, mas essa faixa de cores não limita seus valores numéricos. Valores negativos e extremos podem ficar visualmente saturados.

`buildTable` empilha os componentes e usa `reduceRegions` com `ee.Reducer.mean()`, escala de 5 km, CRS configurado e `tileScale: 4`. Não calcula primeiro uma média territorial dos insumos para depois construir o índice. O índice é calculado por pixel e então resumido. Médias de razões não equivalem, em geral, à razão das médias.

| Campo CSV | Conteúdo |
|---|---|
| `nom_regiao` / `nome` | Chave original de agrupamento das bacias / municípios |
| `UNIDADE_NOME` / `MUNICIPIO` | Nome da bacia no DRIW / município no DRIM |
| `AREA_KM2` | Área da geometria da zona em km²; não é a área de pixels válidos ou em alto risco |
| `NDVI_ATUAL`, `NDVI_HIST` | Médias espaciais do NDVI atual e da referência |
| `NDVI_ANOM_PCT` | Média espacial do desvio relativo de NDVI × 100 |
| `CHUVA_ATUAL_MM`, `CHUVA_HIST_MM` | Médias espaciais dos totais de chuva atual e histórico da janela |
| `CHUVA_ANOM_PCT` | Média espacial do desvio relativo de chuva × 100 |
| `SM_ATUAL`, `SM_HIST` | Médias espaciais da umidade atual e histórica |
| `SM_ANOM_PCT` | Média espacial do desvio relativo de umidade × 100 |
| `INDICE_SECA` / `DRIM` | Média espacial do índice DRIW / DRIM |
| `CLASSE_DRIW` / `DRIM_CLASS` | Média espacial dos códigos de classe |
| `PERIODO_INICIO`, `PERIODO_FIM` | Datas de início e fim efetivo usadas |
| `REFERENCIA_HISTORICA` | Texto com os anos históricos configurados |
| `LIMIAR_ALTO_RISCO` / `LIMIAR_ALTO_RISCO_DRIM` | Limiar registrado no produto DRIW / DRIM |

O CSV pode incluir identificadores gerados pelo GEE; não há lista `selectors` fixa na exportação. As geometrias são removidas antes da exportação.

**A média dos códigos de classe pode ser fracionária e não é uma classe territorial.** Para classificar o índice médio ou medir o percentual de área em alto risco seria necessário um cálculo adicional, não implementado. Cada banda pode ter suporte válido diferente por causa das máscaras; comparar médias exige conferir cobertura. No modo estadual DRIW, `AREA_KM2` ainda usa a geometria inteira da bacia, mesmo que a imagem esteja recortada pelo estado.

O valor médio mostrado no painel usa outro `reduceRegion`, sobre a região de interesse, com `bestEffort: true`, `tileScale: 8` e `maxPixels: 1e8`. A escala efetiva pode aumentar com `bestEffort`; o valor não deve ser tratado como média aritmética das linhas do CSV.

### Exportação

| Item | DRIW | DRIM |
|---|---|---|
| Pasta temporária | `DRIW_GEE_STAGING` | `DRIM_GEE_STAGING` |
| Bandas raster | `DRIW`, `DRIW_CLASS` | `DRIM`, `DRIM_CLASS` |
| Prefixo de arquivo | `DRIW_` | `DRIM_` |

Nomenclatura: `<PRODUTO>_DD_MM_AAAA_REFDD_MM_AAAA_DD_MM_AAAA`, com data de geração e início/fim efetivo da análise. O CSV acrescenta `_TABELA`. As datas de referência são formatadas em UTC; a geração usa a data local do ambiente JavaScript. Recorte e anos históricos não integram o nome; execuções diferentes podem gerar nomes iguais no mesmo dia.

O raster é GeoTIFF com opção `cloudOptimized: true`, duas bandas convertidas para `float`, CRS `EPSG:31984`, pixel de 250 m, `maxPixels: 1e13` e `skipEmptyTiles: true`. As classes são calculadas como byte, mas exportadas como float para compatibilidade com a banda contínua. Não há `noData` explícito. O GEE pode produzir múltiplos arquivos conforme o tamanho da exportação.

Os scripts atribuem propriedades de produto, datas, referência, limiar e destino à imagem; não se deve pressupor que todas sejam preservadas como metadados portáveis no GeoTIFF. Conserve também o CSV e um registro da execução.

### Dependência externa de Google Drive

Ambos os arquivos apontam para o mesmo destino configurado:

```text
SEAMA/El Niño 2026/BOLETINS/INDICES DE SECA/DROUGHT RISK WATERSHED
ID: 1Skb_3hAm0amh2gx8tQOSfdIaM6-sVtKK
```

Apesar do nome municipal, o DRIM recebido também aponta para essa pasta de bacias. Isso é um fato de configuração a confirmar com o responsável.

`Export.image.toDrive` e `Export.table.toDrive` recebem **o nome da pasta temporária**, não o ID final. A hierarquia final não é criada ou percorrida por esses scripts. Os comentários descrevem posterior movimentação por Google Apps Script, mas essa automação não foi fornecida, chamada ou validada. O ID final serve como propriedade informativa na imagem e saída de console, sem efetuar a transferência. Evite pastas temporárias homônimas e confirme o destino real das tarefas.

## 6. Limites e pontos de atenção da implementação

- **Nuvens:** há filtro de percentual da cena, sem máscara adicional por pixel de nuvem/sombra via SCL/QA. Uma cena aceita ainda pode conter pixels contaminados na região estudada.
- **Denominadores:** não há proteção explícita contra referência zero, próxima de zero ou negativa. Isso pode produzir resultados extremos ou inadequados; conferir os componentes é essencial antes de interpretar o índice.
- **Ausência de dados:** não há auditoria de quantidade de imagens/dias por janela e ano, nem mínimo de cobertura. Máscaras e coleções vazias podem afetar o produto; uma última data recente não assegura uma série completa.
- **Resolução:** os insumos têm resoluções diferentes (bandas de NDVI a 10 m; CHIRPS em grade de aproximadamente 0,05°; SMAP em aproximadamente 9 km). A exportação a 250 m reamostra o produto, sem criar observações hidrológicas nessa resolução. Não há harmonização explícita das grades ou método de reamostragem no código. As especificações devem ser confirmadas no catálogo das versões utilizadas.
- **Escala territorial:** a redução de 5 km pode representar mal unidades pequenas e áreas heterogêneas. Não há cálculo da fração territorial com dados válidos ou em alto risco.
- **Comparabilidade:** trocar janela, anos históricos, recorte ou disponibilidade pode alterar o índice. Compare execuções com configuração e suporte espacial registrados.
- **Processamento diferido:** operações `ee` são avaliadas no servidor sob demanda. A mensagem “Análise concluída” aparece após a construção das operações; não prova que todas as avaliações ou tarefas de exportação terminaram sem erro.
- **Calendário:** a interface atual restringe tudo a 2026. Se houver adaptação para outros anos, testar 29 de fevereiro e janelas que atravessem dezembro/janeiro; não há tratamento específico implementado.
- **Validação científica:** não há comparação com estações, vazões, impactos ou índices externos, análise de sensibilidade ou estimativa de incerteza. Não atribuir desempenho ou reconhecimento oficial ao modelo sem evidência adicional.

## 7. Verificação e reprodução de uma análise

1. Execute cada script separadamente no Code Editor, com projeto habilitado e leitura autorizada aos assets. Confira nomes, geometrias, agrupamentos e extensão estadual.
2. Registre versão/commit do código, data de execução, unidade, datas solicitadas e efetivas, modo e anos históricos, última data de cada coleção e parâmetros de escala/CRS.
3. Escolha uma unidade e janela com dados conhecidos. Inspecione contagens e cobertura de imagens, NDVI, chuva e umidade atuais/históricos, denominadores e máscaras. Essa inspeção adicional não é automatizada nos scripts recebidos.
4. Confira em um pixel válido a fórmula e os limites exatos de classe, especialmente 0, 0,25, 0,50 e 1,00. Compare padrões espaciais com evidências independentes antes de usar os resultados em boletins.
5. Crie e execute as tarefas CSV e GeoTIFF. Verifique conclusão, nomes, bandas, CRS, resolução, ausência de dados e valores exportados. Não compare diretamente a classe média do CSV a uma classe inteira do raster.
6. Se houver automação externa, valide separadamente a movimentação das duas pastas temporárias ao destino final e a prevenção de duplicações. Preserve um registro de execução junto aos produtos.

Nesta entrega foi feita leitura estática dos dois códigos e verificação de sintaxe com `node --check`. Não foi executado processamento GEE, teste de acesso aos assets ou exportação Drive. A verificação local de sintaxe não valida chamadas à API ou disponibilidade de dados.

## 8. Referências para consulta

- [Sentinel-2 SR Harmonized no catálogo GEE](https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S2_SR_HARMONIZED)
- [CHIRPS V3 DAILY_SAT no catálogo GEE](https://developers.google.com/earth-engine/datasets/catalog/UCSB-CHC_CHIRPS_V3_DAILY_SAT)
- [SMAP SPL4SMGP 008 no catálogo GEE](https://developers.google.com/earth-engine/datasets/catalog/NASA_SMAP_SPL4SMGP_008)
- [Filtro de datas](https://developers.google.com/earth-engine/apidocs/ee-imagecollection-filterdate)
- [Redução por regiões](https://developers.google.com/earth-engine/apidocs/ee-image-reduceregions)
- [Exportação de imagem ao Drive](https://developers.google.com/earth-engine/apidocs/export-image-todrive)

Os links são referências para conferência das APIs e dos produtos; a documentação acima descreve o código fornecido, sem alegar verificação online das versões do catálogo.
