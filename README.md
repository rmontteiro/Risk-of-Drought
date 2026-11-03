# Risk-of-Drought — risco de seca no Espírito Santo

Este projeto reúne dois scripts JavaScript do **Google Earth Engine (GEE)** para monitorar o sinal integrado de seca no Espírito Santo. Eles combinam desvios relativos de NDVI, precipitação e umidade superficial do solo em relação ao mesmo período de anos anteriores.

| Aplicação | Unidade de resumo | Código |
|---|---|---|
| DRIW — Drought Risk Index Watershed | Bacia hidrográfica, agrupada por `nom_regiao` | [driw-bacias.js](earth-engine/driw-bacias.js) |
| DRIM — Drought Risk Index Municipality | Município, agrupado por `nome` | [drim-municipios.js](earth-engine/drim-municipios.js) |

Ambos calculam o índice por pixel e depois resumem os resultados por unidade territorial. Os nomes DRIW e DRIM distinguem o recorte e os produtos; a fórmula é a mesma.

## Procedimento metodológico de cálculo

DRIW e DRIM aplicam a mesma equação a cada pixel. A diferença está na unidade territorial usada para definir o recorte e resumir o resultado: bacias hidrográficas no DRIW e municípios no DRIM. O processamento segue as etapas abaixo.

### 1. Definição da unidade espacial

Os scripts reorganizam os assets vetoriais antes do cálculo para produzir uma feição por unidade nominal:

- no **DRIM**, as feições são agrupadas pelo campo `nome`. A geometria de todas as feições com o mesmo nome é reunida e recebe os atributos `nome` e `MUNICIPIO`;
- no **DRIW**, as bacias são agrupadas por `nom_regiao`. A geometria de todas as feições com o mesmo valor é reunida e recebe os atributos `nom_regiao` e `UNIDADE_NOME`.

Quando o usuário escolhe todo o Espírito Santo, o DRIM usa a geometria conjunta dos municípios como região de processamento e como zonas de resumo. O DRIW também usa os municípios para recortar a análise estadual, mas resume os pixels pelas bacias. Quando uma unidade específica é escolhida, o recorte passa a ser a geometria integral do município ou da bacia selecionada.

O agrupamento pressupõe nomes preenchidos e únicos. Feições distintas que compartilhem o mesmo nome serão reunidas na mesma unidade.

### 2. Definição da janela temporal

O período atual é escolhido na interface. O código está configurado para **2026** e inclui a data final informada: internamente, acrescenta um dia ao limite final porque `filterDate` do Earth Engine usa o fim de forma exclusiva.

Para cada ano histórico, o script reproduz a mesma combinação de mês e dia do período atual. Assim, uma análise de 1 a 31 de julho de 2026 é comparada com 1 a 31 de julho de cada ano selecionado, e não com médias anuais completas.

Há três modos de referência:

| Modo | NDVI | Chuva | Umidade do solo |
|---|---:|---:|---:|
| Período comum | 2018–2025 | 2018–2025 | 2018–2025 |
| Máxima série configurada, padrão | 2018–2025 | 1981–2025 | 2016–2025 |
| Personalizado | intervalo dentro de 2018–2025 | intervalo dentro de 1981–2025 | intervalo dentro de 2016–2025 |

Se a opção de limitar à última data comum estiver ativa, o script consulta a data mais recente disponível em 2026 para Sentinel-2, CHIRPS e SMAP. O fim efetivo da análise passa a ser o menor valor entre a data solicitada e a mais antiga dessas três datas de disponibilidade. Essa verificação indica atualidade das coleções, mas não garante cobertura completa de todos os pixels ou dias.

### 3. Cálculo dos componentes atuais

Cada componente é calculado como uma imagem raster para a região e o período selecionados.

#### NDVI atual

1. Filtra `COPERNICUS/S2_SR_HARMONIZED` pelo período e pela região de interesse.
2. Mantém cenas com `CLOUDY_PIXEL_PERCENTAGE ≤ 20`.
3. Para cada cena, calcula:

   ```text
   NDVI = (B8 − B4) / (B8 + B4)
   ```

4. Calcula a média temporal do NDVI de todas as cenas aceitas.

O filtro de nuvens usa o percentual registrado para a cena inteira. O código não aplica uma máscara adicional de nuvem e sombra por pixel.

#### Chuva atual

1. Filtra `UCSB-CHC/CHIRPS/V3/DAILY_SAT` pelo período.
2. Seleciona a banda `precipitation`.
3. Soma as imagens diárias, produzindo a precipitação acumulada do período em milímetros.

#### Umidade atual do solo

1. Filtra `NASA/SMAP/SPL4SMGP/008` pelo período.
2. Seleciona a banda `sm_surface`.
3. Calcula a média temporal do período, em m³/m³.

As três imagens resultantes são convertidas para ponto flutuante e recortadas pela região de interesse.

### 4. Construção das referências históricas

Para cada variável e para cada ano histórico `y`, o script repete o cálculo da etapa anterior usando a mesma janela de mês e dia:

```text
NDVI_y  = média do NDVI das cenas do período no ano y
CHUVA_y = soma da precipitação diária do período no ano y
SM_y    = média da umidade superficial do período no ano y
```

Depois calcula a média entre os agregados anuais:

```text
NDVI_hist  = média(NDVI_y)
CHUVA_hist = média(CHUVA_y)
SM_hist    = média(SM_y)
```

Cada ano recebe o mesmo peso na referência. Para a chuva, portanto, a referência é a média dos totais da janela em cada ano; não é a soma de todos os valores históricos. Para NDVI e umidade, primeiro se calcula a média dentro de cada ano e depois a média entre anos.

### 5. Anomalias e normalização

O desvio absoluto de cada componente é a diferença entre o valor atual e sua referência:

```text
A_NDVI  = NDVI_atual  − NDVI_hist
A_CHUVA = CHUVA_atual − CHUVA_hist
A_SM    = SM_atual    − SM_hist
```

Essas anomalias preservam as unidades de origem e são usadas nas camadas temáticas. Para combinar variáveis com escalas diferentes, o script divide cada anomalia pelo respectivo valor histórico:

```text
N_NDVI  = A_NDVI  / NDVI_hist
N_CHUVA = A_CHUVA / CHUVA_hist
N_SM    = A_SM    / SM_hist
```

Os valores `N` são desvios relativos. Por exemplo, `N_CHUVA = −0,50` representa chuva 50% abaixo da referência histórica, desde que o denominador seja positivo.

Não há proteção explícita para referências iguais ou próximas de zero. Esses casos, bem como referências negativas de NDVI, devem ser inspecionados antes da interpretação.

### 6. Composição do DRIW e do DRIM

Os três desvios relativos entram com coeficiente `−1` e sem pesos adicionais:

```text
DRIW = −N_NDVI − N_CHUVA − N_SM
DRIM = −N_NDVI − N_CHUVA − N_SM
```

O sinal negativo faz com que déficits, representados por anomalias relativas negativas, aumentem o índice. Excedentes reduzem o índice e podem compensar déficits de outro componente.

Por exemplo, déficits de 20% no NDVI, 50% na chuva e 40% na umidade produzem:

```text
I = −(−0,20) − (−0,50) − (−0,40) = 1,10
```

Esse valor supera o limiar de alto risco adotado no código. Trata-se apenas de uma demonstração matemática, não de um resultado observado.

### 7. Classificação dos pixels

O índice contínuo é convertido nas seguintes classes:

| Código | Intervalo | Interpretação exibida |
|---:|---:|---|
| 0 | `I < 0` | condição mais úmida que a referência |
| 1 | `0 ≤ I < 0,25` | déficit integrado fraco |
| 2 | `0,25 ≤ I < 0,50` | déficit integrado moderado |
| 3 | `0,50 ≤ I ≤ 1,00` | déficit integrado forte |
| 4 | `I > 1,00` | alto risco de seca |

O valor exatamente igual a `1,00` pertence à classe 3. A máscara de alto risco mostra apenas pixels com índice estritamente maior que `1,00`.

### 8. Resumo por município ou bacia

O índice é calculado primeiro por pixel. Depois, o script empilha os valores atuais, históricos, anomalias relativas, índice contínuo e classe, e aplica `reduceRegions` com média espacial, escala de 5 km e CRS `EPSG:31984`.

- O **DRIM** calcula essas médias para cada município agrupado por `nome`.
- O **DRIW** calcula essas médias para cada bacia agrupada por `nom_regiao`. Na análise estadual, apenas os pixels da imagem recortada pelo limite dos municípios entram no resumo, embora `AREA_KM2` continue representando a geometria integral da bacia.

As colunas `*_ANOM_PCT` do CSV são os desvios relativos multiplicados por 100. `INDICE_SECA` no DRIW e `DRIM` no DRIM são médias espaciais do índice calculado por pixel.

A média dos códigos raster também é exportada. Ela pode ser fracionária e não deve ser interpretada como uma classe territorial. Classificar a média do índice ou calcular a proporção da área em alto risco exigiria um procedimento adicional.

### 9. Produtos gerados

Os scripts disponibilizam mapas do índice contínuo, classes, anomalias absolutas de cada componente e máscara de alto risco. O CSV contém o resumo territorial e o GeoTIFF contém o índice e a classe por pixel. A redução territorial usa 5 km, enquanto o GeoTIFF é solicitado com pixel de 250 m; essa exportação mais fina não aumenta a resolução observacional dos insumos, especialmente CHIRPS e SMAP.

DRIW e DRIM são índices adimensionais. Eles expressam um sinal integrado de anomalias ambientais e não uma probabilidade de seca. Não há calibração regional dos limiares, validação de impactos ou estimativa de incerteza implementada nos scripts.

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
