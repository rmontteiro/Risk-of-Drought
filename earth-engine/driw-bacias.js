// ============================================================================
// DRIW - DROUGHT RISK INDEX WATERSHED
// ESPÍRITO SANTO
//
// METODOLOGIA:
//
// NDVI_anomaly = NDVI_current - NDVI_historical
// Rain_anomaly = Rain_current - Rain_historical
// SM_anomaly   = SM_current   - SM_historical
//
// NDVI_norm = NDVI_anomaly / NDVI_historical
// Rain_norm = Rain_anomaly / Rain_historical
// SM_norm   = SM_anomaly   / SM_historical
//
// DRIW = -NDVI_norm -Rain_norm -SM_norm
//
// Alto risco = DRIW > 1.0
//
// EXPORTAÇÃO:
//
// GEE
//   ↓
// DRIW_GEE_STAGING
//   ↓
// Google Apps Script
//   ↓
// SEAMA/El Niño 2026/BOLETINS/INDICES DE SECA/
// DROUGHT RISK WATERSHED
//
// ID DA PASTA FINAL:
// 1Skb_3hAm0amh2gx8tQOSfdIaM6-sVtKK
//
// ============================================================================


// ============================================================================
// 1. ASSETS
// ============================================================================

var municipiosES = ee.FeatureCollection(
  'projects/ee-aguascapixabas/assets/MUNICIPIOS_ES'
);

var baciasRaw = ee.FeatureCollection(
  'projects/ee-aguascapixabas/assets/bacias_hidrograficas_AGERH'
);

var BASIN_FIELD = 'nom_regiao';


// ============================================================================
// 2. BASES DE DADOS
// ============================================================================

var s2 = ee.ImageCollection(
  'COPERNICUS/S2_SR_HARMONIZED'
);

var chirps = ee.ImageCollection(
  'UCSB-CHC/CHIRPS/V3/DAILY_SAT'
);

var smap = ee.ImageCollection(
  'NASA/SMAP/SPL4SMGP/008'
);


// ============================================================================
// 3. CONFIGURAÇÕES
// ============================================================================

var CURRENT_YEAR = 2026;

var MAX_CLOUD_PERCENT = 20;

var ANALYSIS_CRS = 'EPSG:31984';

var SCALE_INDEX = 5000;

var SCALE_EXPORT = 250;

var HIGH_RISK_THRESHOLD = 1.0;


// ============================================================================
// 4. EXPORTAÇÃO
// ============================================================================

// Pasta temporária exclusiva do Earth Engine.
var GEE_STAGING_FOLDER =
  'DRIW_GEE_STAGING';


// ID exato da pasta final.
// Não é passado ao Export.image.toDrive().
var FINAL_DRIVE_FOLDER_ID =
  '1Skb_3hAm0amh2gx8tQOSfdIaM6-sVtKK';


var FINAL_DRIVE_PATH =
  'SEAMA/El Niño 2026/BOLETINS/INDICES DE SECA/DROUGHT RISK WATERSHED';


// ============================================================================
// 5. NOMES DAS CAMADAS
// ============================================================================

var LAYER_DRIW_CLASS =
  'DRIW — classes interpretativas';

var LAYER_DRIW_CONT =
  'DRIW — índice contínuo';

var LAYER_NDVI =
  'Anomalia NDVI';

var LAYER_RAIN =
  'Anomalia precipitação';

var LAYER_SM =
  'Anomalia umidade do solo';

var LAYER_HIGH =
  'Alto risco (> 1,00)';


var MAIN_LAYER_OPTIONS = [
  LAYER_DRIW_CLASS,
  LAYER_DRIW_CONT,
  LAYER_NDVI,
  LAYER_RAIN,
  LAYER_SM,
  LAYER_HIGH
];


// ============================================================================
// 6. CORES
// ============================================================================

var DRIW_CLASS_COLORS = [
  '2E7D32',
  'C7E9B4',
  'FFEB3B',
  'FF9800',
  'D32F2F'
];


// ============================================================================
// 7. DISSOLVER BACIAS POR nom_regiao
// ============================================================================

var basinNames = ee.List(
  baciasRaw.aggregate_array(BASIN_FIELD)
)
.distinct()
.sort();


var baciasES = ee.FeatureCollection(
  basinNames.map(function(name) {

    name = ee.String(name);

    var parts = baciasRaw.filter(
      ee.Filter.eq(BASIN_FIELD, name)
    );

    return ee.Feature(
      parts.geometry()
    )
    .set(BASIN_FIELD, name);

  })
);


// ============================================================================
// 8. ESTADO DA APLICAÇÃO
// ============================================================================

var basinValueMap = {};

var lastTable = null;

var lastIndex = null;

var lastClass = null;

var lastROI = null;

var lastRefStartMillis = null;

var lastRefEndMillis = null;

var lastHistoricalText = null;

var analyticalLayers = {};

var boundaryLayer = null;


// ============================================================================
// 9. FUNÇÕES AUXILIARES
// ============================================================================

function pad2(value) {

  value = Number(value);

  return value < 10
    ? '0' + value
    : String(value);

}


function formatDateUTC(milliseconds) {

  var d = new Date(milliseconds);

  return (
    d.getUTCFullYear() +
    '-' +
    pad2(d.getUTCMonth() + 1) +
    '-' +
    pad2(d.getUTCDate())
  );

}


function formatDateFileUTC(milliseconds) {

  var d = new Date(milliseconds);

  return (
    pad2(d.getUTCDate()) +
    '_' +
    pad2(d.getUTCMonth() + 1) +
    '_' +
    d.getUTCFullYear()
  );

}


function formatGenerationDate() {

  var d = new Date();

  return (
    pad2(d.getDate()) +
    '_' +
    pad2(d.getMonth() + 1) +
    '_' +
    d.getFullYear()
  );

}


function buildDRIWOutputName(
  startMillis,
  endMillis
) {

  return (
    'DRIW_' +
    formatGenerationDate() +
    '_REF' +
    formatDateFileUTC(startMillis) +
    '_' +
    formatDateFileUTC(endMillis)
  );

}


function buildOutputName() {

  if (
    lastRefStartMillis === null ||
    lastRefEndMillis === null
  ) {
    return null;
  }

  return buildDRIWOutputName(
    lastRefStartMillis,
    lastRefEndMillis
  );

}


function createYearList(first, last) {

  var out = [];

  for (
    var y = first;
    y <= last;
    y++
  ) {
    out.push(String(y));
  }

  return out;

}


// ============================================================================
// 10. TIPAGEM
// ============================================================================

function castImageBand(
  image,
  bandName
) {

  var types = {};

  types[bandName] = 'float';

  return ee.Image(image)
    .cast(types, [bandName]);

}


function castCollectionBand(
  collection,
  bandName
) {

  var types = {};

  types[bandName] = 'float';

  return ee.ImageCollection(collection)
    .cast(types, [bandName]);

}


// ============================================================================
// 11. INTERFACE
// ============================================================================

var PANEL_WIDTH = '325px';

var CONTROL_WIDTH = '305px';

var HALF_WIDTH = '108px';

var FONT_TITLE = '13px';

var FONT_SECTION = '10px';

var FONT_NORMAL = '9px';

var FONT_SMALL = '8px';


function section(text) {

  return ui.Label(
    text,
    {
      fontSize: FONT_SECTION,
      fontWeight: 'bold',
      margin: '4px 0 1px 0',
      padding: '0'
    }
  );

}


function smallLabel(text) {

  return ui.Label(
    text,
    {
      fontSize: FONT_NORMAL,
      margin: '1px 3px 1px 0',
      padding: '0'
    }
  );

}


function row(widgets) {

  return ui.Panel({
    widgets: widgets,
    layout: ui.Panel.Layout.flow('horizontal'),
    style: {
      padding: '0',
      margin: '0'
    }
  });

}


function compactSelect(
  items,
  value,
  width
) {

  return ui.Select({
    items: items,
    value: value,
    style: {
      width: width || CONTROL_WIDTH,
      fontSize: FONT_NORMAL,
      margin: '1px 0',
      padding: '0'
    }
  });

}


// ============================================================================
// 12. PAINEL
// ============================================================================

var panel = ui.Panel({
  style: {
    position: 'top-left',
    width: PANEL_WIDTH,
    padding: '5px'
  }
});


panel.add(
  ui.Label(
    'DRIW — RISCO DE SECA POR BACIAS',
    {
      fontSize: FONT_TITLE,
      fontWeight: 'bold',
      margin: '0 0 2px 0'
    }
  )
);


var availabilityLabel = ui.Label(
  'Disponibilidade: verificada ao executar',
  {
    fontSize: FONT_SMALL,
    margin: '0 0 2px 0'
  }
);


panel.add(
  availabilityLabel
);


// ============================================================================
// 13. RECORTE ESPACIAL
// ============================================================================

panel.add(
  section(
    '1. RECORTE ESPACIAL'
  )
);


var scopeSelect = compactSelect(
  [
    'Todo o Espírito Santo',
    'Bacia específica'
  ],
  'Todo o Espírito Santo'
);


panel.add(
  scopeSelect
);


var basinPanel = ui.Panel({
  style: {
    padding: '0',
    margin: '1px 0'
  }
});


panel.add(
  basinPanel
);


var basinSelect = ui.Select({
  items: [],
  placeholder: 'Selecione a bacia',
  style: {
    width: CONTROL_WIDTH,
    fontSize: FONT_NORMAL,
    margin: '1px 0'
  }
});


function updateSpatialInterface() {

  basinPanel.clear();

  if (
    scopeSelect.getValue() ===
    'Todo o Espírito Santo'
  ) {

    basinPanel.add(
      ui.Label(
        'Análise estadual com resumo por bacia.',
        {
          fontSize: FONT_SMALL,
          margin: '1px 0'
        }
      )
    );

    return;

  }

  basinPanel.add(
    ui.Label(
      'Bacia — campo nom_regiao',
      {
        fontSize: FONT_SMALL,
        margin: '1px 0'
      }
    )
  );

  basinPanel.add(
    basinSelect
  );

}


scopeSelect.onChange(
  updateSpatialInterface
);


// ============================================================================
// 14. CARREGAR BACIAS
// ============================================================================

baciasES
  .aggregate_array(BASIN_FIELD)
  .distinct()
  .evaluate(function(values, error) {

    if (error) {

      print(
        'ERRO AO CARREGAR BACIAS:',
        error
      );

      return;

    }

    var labels = [];

    values.forEach(function(value) {

      if (
        value === null ||
        value === undefined
      ) {
        return;
      }

      var label = String(value);

      basinValueMap[label] = value;

      labels.push(label);

    });

    labels.sort();

    basinSelect
      .items()
      .reset(labels);

    if (labels.length > 0) {

      basinSelect.setValue(
        labels[0],
        false
      );

    }

  });


// ============================================================================
// 15. PERÍODO
// ============================================================================

panel.add(
  section(
    '2. PERÍODO ANALISADO'
  )
);


var startDate = ui.DateSlider({
  start: '2026-01-01',
  end: '2026-12-31',
  value: '2026-07-01',
  period: 1,
  style: {
    width: '255px',
    fontSize: FONT_SMALL,
    margin: '0'
  }
});


panel.add(
  row([
    smallLabel('Início:'),
    startDate
  ])
);


var endDate = ui.DateSlider({
  start: '2026-01-01',
  end: '2026-12-31',
  value: '2026-07-31',
  period: 1,
  style: {
    width: '255px',
    fontSize: FONT_SMALL,
    margin: '0'
  }
});


panel.add(
  row([
    smallLabel('Fim:'),
    endDate
  ])
);


var limitCommonDate = ui.Checkbox({
  label: 'Limitar à última data comum',
  value: true,
  style: {
    fontSize: FONT_SMALL,
    margin: '1px 0'
  }
});


panel.add(
  limitCommonDate
);


// ============================================================================
// 16. REFERÊNCIA HISTÓRICA
// ============================================================================

panel.add(
  section(
    '3. REFERÊNCIA HISTÓRICA'
  )
);


var COMMON_YEARS =
  createYearList(2018, 2025);

var NDVI_YEARS =
  createYearList(2018, 2025);

var RAIN_YEARS =
  createYearList(1981, 2025);

var SM_YEARS =
  createYearList(2016, 2025);


var histMode = compactSelect(
  [
    'Período comum',
    'Máxima série de cada base',
    'Personalizado'
  ],
  'Máxima série de cada base'
);


panel.add(
  histMode
);


var histPanel = ui.Panel({
  style: {
    padding: '0',
    margin: '1px 0'
  }
});


panel.add(
  histPanel
);


var commonStart =
  compactSelect(
    COMMON_YEARS,
    '2018',
    HALF_WIDTH
  );

var commonEnd =
  compactSelect(
    COMMON_YEARS,
    '2025',
    HALF_WIDTH
  );

var ndviStart =
  compactSelect(
    NDVI_YEARS,
    '2018',
    HALF_WIDTH
  );

var ndviEnd =
  compactSelect(
    NDVI_YEARS,
    '2025',
    HALF_WIDTH
  );

var rainStart =
  compactSelect(
    RAIN_YEARS,
    '1981',
    HALF_WIDTH
  );

var rainEnd =
  compactSelect(
    RAIN_YEARS,
    '2025',
    HALF_WIDTH
  );

var smStart =
  compactSelect(
    SM_YEARS,
    '2016',
    HALF_WIDTH
  );

var smEnd =
  compactSelect(
    SM_YEARS,
    '2025',
    HALF_WIDTH
  );


function updateHistoricalInterface() {

  histPanel.clear();

  var mode =
    histMode.getValue();


  if (
    mode ===
    'Período comum'
  ) {

    histPanel.add(
      row([
        smallLabel('De'),
        commonStart,
        smallLabel('até'),
        commonEnd
      ])
    );

    return;

  }


  if (
    mode ===
    'Máxima série de cada base'
  ) {

    histPanel.add(
      ui.Label(
        'NDVI 2018–2025 | CHIRPS 1981–2025 | SMAP 2016–2025',
        {
          fontSize: FONT_SMALL,
          margin: '2px 0'
        }
      )
    );

    return;

  }


  histPanel.add(
    row([
      smallLabel('NDVI'),
      ndviStart,
      ndviEnd
    ])
  );


  histPanel.add(
    row([
      smallLabel('Chuva'),
      rainStart,
      rainEnd
    ])
  );


  histPanel.add(
    row([
      smallLabel('SMAP'),
      smStart,
      smEnd
    ])
  );

}


histMode.onChange(
  updateHistoricalInterface
);


// ============================================================================
// 17. CAMADA EXIBIDA
// ============================================================================

panel.add(
  section(
    '4. CAMADA EXIBIDA'
  )
);


var mainLayerSelect = ui.Select({
  items: MAIN_LAYER_OPTIONS,
  placeholder: 'Execute a análise',
  disabled: true,
  style: {
    width: CONTROL_WIDTH,
    fontSize: FONT_NORMAL,
    margin: '1px 0'
  }
});


panel.add(
  mainLayerSelect
);


var showBordersCheckbox = ui.Checkbox({
  label: 'Exibir limites das bacias',
  value: true,
  style: {
    fontSize: FONT_SMALL,
    margin: '1px 0'
  }
});


panel.add(
  showBordersCheckbox
);


// ============================================================================
// 18. STATUS
// ============================================================================

var status = ui.Label(
  'Configure a análise.',
  {
    fontSize: FONT_SMALL,
    fontWeight: 'bold',
    margin: '3px 0 1px 0'
  }
);


panel.add(
  status
);


var resultLabel = ui.Label(
  '',
  {
    fontSize: FONT_SMALL,
    margin: '1px 0 2px 0'
  }
);


panel.add(
  resultLabel
);


// ============================================================================
// 19. BOTÕES
// ============================================================================

var runButton = ui.Button({
  label: 'EXECUTAR',
  style: {
    width: '75px',
    fontSize: FONT_NORMAL
  }
});


var csvButton = ui.Button({
  label: 'CSV',
  disabled: true,
  style: {
    width: '45px',
    fontSize: FONT_NORMAL
  }
});


var rasterButton = ui.Button({
  label: 'DRIVE',
  disabled: true,
  style: {
    width: '58px',
    fontSize: FONT_NORMAL
  }
});


var clearButton = ui.Button({
  label: 'LIMPAR',
  style: {
    width: '60px',
    fontSize: FONT_NORMAL
  }
});


panel.add(
  row([
    runButton,
    csvButton,
    rasterButton,
    clearButton
  ])
);


// ============================================================================
// 20. LEGENDA DINÂMICA
// ============================================================================

var legendPanel = ui.Panel({
  style: {
    position: 'bottom-right',
    padding: '8px 10px',
    width: '325px',
    backgroundColor: 'white'
  }
});


var LEGEND_CONFIG = {};


// DRIW CLASSIFICADO
LEGEND_CONFIG[LAYER_DRIW_CLASS] = {

  title:
    'DRIW — classes interpretativas',

  subtitle:
    'Classificação do sinal integrado de risco de seca.',

  note:
    '> 1,00 corresponde ao limiar de alto risco do modelo.',

  entries: [

    {
      color: '2E7D32',
      label: '< 0 | condição mais úmida que a referência'
    },

    {
      color: 'C7E9B4',
      label: '0,00–0,25 | déficit integrado fraco'
    },

    {
      color: 'FFEB3B',
      label: '0,25–0,50 | déficit integrado moderado'
    },

    {
      color: 'FF9800',
      label: '0,50–1,00 | déficit integrado forte'
    },

    {
      color: 'D32F2F',
      label: '> 1,00 | alto risco de seca'
    }

  ]

};


// DRIW CONTÍNUO
LEGEND_CONFIG[LAYER_DRIW_CONT] = {

  title:
    'DRIW — índice contínuo',

  subtitle:
    'Valores crescentes representam intensificação do sinal integrado de seca.',

  note:
    'DRIW > 1,00 representa alto risco.',

  entries: [

    {
      color: 'FFFFFF',
      label: '0,00'
    },

    {
      color: 'FFF59D',
      label: '≈ 0,38'
    },

    {
      color: 'FFB74D',
      label: '≈ 0,75'
    },

    {
      color: 'F4511E',
      label: '≈ 1,13'
    },

    {
      color: 'B71C1C',
      label: '1,50 ou superior'
    }

  ]

};


// NDVI
LEGEND_CONFIG[LAYER_NDVI] = {

  title:
    'Anomalia de NDVI',

  subtitle:
    'NDVI atual menos média histórica do mesmo período.',

  note:
    'Valores negativos indicam vigor vegetativo inferior à referência.',

  entries: [

    {
      color: 'FF0000',
      label: '-0,30 | forte anomalia negativa'
    },

    {
      color: 'F08080',
      label: '-0,15 | anomalia negativa'
    },

    {
      color: 'FFFFFF',
      label: '0,00 | referência'
    },

    {
      color: '90EE90',
      label: '+0,15 | anomalia positiva'
    },

    {
      color: '008000',
      label: '+0,30 | forte anomalia positiva'
    }

  ]

};


// CHUVA
LEGEND_CONFIG[LAYER_RAIN] = {

  title:
    'Anomalia de precipitação',

  subtitle:
    'Precipitação atual acumulada menos média histórica.',

  note:
    'Valores negativos representam déficit de precipitação.',

  entries: [

    {
      color: '8B4513',
      label: '-100 mm | forte déficit'
    },

    {
      color: 'D2B48C',
      label: '-50 mm | déficit'
    },

    {
      color: 'FFFFFF',
      label: '0 mm | referência'
    },

    {
      color: 'ADD8E6',
      label: '+50 mm | excedente'
    },

    {
      color: '0000FF',
      label: '+100 mm | forte excedente'
    }

  ]

};


// SMAP
LEGEND_CONFIG[LAYER_SM] = {

  title:
    'Anomalia de umidade do solo',

  subtitle:
    'Umidade superficial atual menos referência histórica.',

  note:
    'Valores negativos representam condição mais seca.',

  entries: [

    {
      color: 'FFD700',
      label: '-0,05 | forte anomalia negativa'
    },

    {
      color: 'FFF2A8',
      label: '-0,025 | anomalia negativa'
    },

    {
      color: 'FFFFFF',
      label: '0,00 | referência'
    },

    {
      color: 'ADD8E6',
      label: '+0,025 | anomalia positiva'
    },

    {
      color: '0000FF',
      label: '+0,05 | forte anomalia positiva'
    }

  ]

};


// ALTO RISCO
LEGEND_CONFIG[LAYER_HIGH] = {

  title:
    'Alto risco de seca',

  subtitle:
    'Áreas onde o índice integrado ultrapassa o limiar.',

  note:
    'Somente pixels com DRIW > 1,00.',

  entries: [

    {
      color: 'D32F2F',
      label: 'DRIW > 1,00 | alto risco'
    }

  ]

};


function addLegendEntry(
  color,
  label
) {

  var colorBox = ui.Label(
    '',
    {
      backgroundColor: '#' + color,
      padding: '8px',
      margin: '0 6px 3px 0'
    }
  );


  var text = ui.Label(
    label,
    {
      fontSize: '9px',
      margin: '1px 0 3px 0'
    }
  );


  legendPanel.add(
    ui.Panel({
      widgets: [
        colorBox,
        text
      ],
      layout:
        ui.Panel.Layout.flow('horizontal'),
      style: {
        margin: '0',
        padding: '0'
      }
    })
  );

}


function renderLegend(layerName) {

  legendPanel.clear();


  if (
    !layerName ||
    !LEGEND_CONFIG[layerName]
  ) {

    legendPanel.add(
      ui.Label(
        'LEGENDA',
        {
          fontSize: '12px',
          fontWeight: 'bold',
          margin: '0 0 3px 0'
        }
      )
    );


    legendPanel.add(
      ui.Label(
        'Execute a análise e selecione a camada a ser exibida.',
        {
          fontSize: '9px',
          margin: '0'
        }
      )
    );


    return;

  }


  var config =
    LEGEND_CONFIG[layerName];


  legendPanel.add(
    ui.Label(
      config.title,
      {
        fontSize: '12px',
        fontWeight: 'bold',
        margin: '0 0 3px 0'
      }
    )
  );


  legendPanel.add(
    ui.Label(
      config.subtitle,
      {
        fontSize: '9px',
        margin: '0 0 5px 0'
      }
    )
  );


  config.entries.forEach(
    function(entry) {

      addLegendEntry(
        entry.color,
        entry.label
      );

    }
  );


  if (config.note) {

    legendPanel.add(
      ui.Label(
        config.note,
        {
          fontSize: '8px',
          margin: '4px 0 0 0'
        }
      )
    );

  }

}


// ============================================================================
// 21. CONTROLE DE CAMADAS
// ============================================================================

function showSelectedAnalyticalLayer(
  layerName
) {

  var names =
    Object.keys(analyticalLayers);


  names.forEach(function(name) {

    analyticalLayers[name]
      .setShown(
        name === layerName
      );

  });


  if (boundaryLayer) {

    boundaryLayer.setShown(
      showBordersCheckbox.getValue()
    );

  }


  renderLegend(
    layerName
  );


  status.setValue(
    'Camada exibida: ' +
    layerName
  );

}


mainLayerSelect.onChange(
  function(value) {

    showSelectedAnalyticalLayer(
      value
    );

  }
);


showBordersCheckbox.onChange(
  function(value) {

    if (boundaryLayer) {

      boundaryLayer.setShown(
        value
      );

    }

  }
);


// ============================================================================
// 22. RECORTE ESPACIAL
// ============================================================================

function resolveSpatialSelection() {

  if (
    scopeSelect.getValue() ===
    'Todo o Espírito Santo'
  ) {

    return {

      name:
        'Espírito Santo',

      geometry:
        municipiosES.geometry(),

      zones:
        baciasES

    };

  }


  var label =
    basinSelect.getValue();


  if (!label) {
    return null;
  }


  var value =
    basinValueMap[label];


  var selected =
    baciasES.filter(
      ee.Filter.eq(
        BASIN_FIELD,
        value
      )
    );


  var feature =
    ee.Feature(
      selected.geometry()
    )
    .set(
      BASIN_FIELD,
      value
    );


  return {

    name:
      label,

    geometry:
      feature.geometry(),

    zones:
      ee.FeatureCollection([
        feature
      ])

  };

}


// ============================================================================
// 23. DATAS
// ============================================================================

function startOfPeriod(
  year,
  month,
  day
) {

  return ee.Date.fromYMD(
    ee.Number(year),
    month,
    day
  );

}


function endOfPeriod(
  year,
  month,
  day
) {

  return ee.Date.fromYMD(
    ee.Number(year),
    month,
    day
  )
  .advance(
    1,
    'day'
  );

}


// ============================================================================
// 24. NDVI ANUAL
// ============================================================================

function annualNDVI(
  year,
  startMonth,
  startDay,
  endMonth,
  endDay,
  roi
) {

  var start =
    startOfPeriod(
      year,
      startMonth,
      startDay
    );


  var end =
    endOfPeriod(
      year,
      endMonth,
      endDay
    );


  var col =
    s2
      .filterDate(
        start,
        end
      )
      .filterBounds(
        roi
      )
      .filter(
        ee.Filter.lte(
          'CLOUDY_PIXEL_PERCENTAGE',
          MAX_CLOUD_PERCENT
        )
      )
      .map(function(image) {

        return image
          .normalizedDifference([
            'B8',
            'B4'
          ])
          .rename(
            'NDVI'
          )
          .toFloat();

      });


  return col
    .mean()
    .set(
      'year',
      year
    );

}


// ============================================================================
// 25. CHIRPS ANUAL
// ============================================================================

function annualRain(
  year,
  startMonth,
  startDay,
  endMonth,
  endDay,
  roi
) {

  var start =
    startOfPeriod(
      year,
      startMonth,
      startDay
    );


  var end =
    endOfPeriod(
      year,
      endMonth,
      endDay
    );


  return chirps
    .filterDate(
      start,
      end
    )
    .filterBounds(
      roi
    )
    .select(
      'precipitation'
    )
    .sum()
    .set(
      'year',
      year
    );

}


// ============================================================================
// 26. SMAP ANUAL
// ============================================================================

function annualSM(
  year,
  startMonth,
  startDay,
  endMonth,
  endDay,
  roi
) {

  var start =
    startOfPeriod(
      year,
      startMonth,
      startDay
    );


  var end =
    endOfPeriod(
      year,
      endMonth,
      endDay
    );


  return smap
    .filterDate(
      start,
      end
    )
    .filterBounds(
      roi
    )
    .select(
      'sm_surface'
    )
    .mean()
    .set(
      'year',
      year
    );

}


// ============================================================================
// 27. ATUAIS
// ============================================================================

function getNDVICurrent(
  startMonth,
  startDay,
  endMonth,
  endDay,
  roi
) {

  return castImageBand(

    annualNDVI(
      CURRENT_YEAR,
      startMonth,
      startDay,
      endMonth,
      endDay,
      roi
    ),

    'NDVI'

  )
  .rename(
    'NDVI'
  )
  .clip(
    roi
  );

}


function getRainCurrent(
  startMonth,
  startDay,
  endMonth,
  endDay,
  roi
) {

  return castImageBand(

    annualRain(
      CURRENT_YEAR,
      startMonth,
      startDay,
      endMonth,
      endDay,
      roi
    ),

    'precipitation'

  )
  .rename(
    'Rain'
  )
  .clip(
    roi
  );

}


function getSMCurrent(
  startMonth,
  startDay,
  endMonth,
  endDay,
  roi
) {

  return castImageBand(

    annualSM(
      CURRENT_YEAR,
      startMonth,
      startDay,
      endMonth,
      endDay,
      roi
    ),

    'sm_surface'

  )
  .rename(
    'SM'
  )
  .clip(
    roi
  );

}


// ============================================================================
// 28. HISTÓRICO NDVI
// ============================================================================

function buildNDVIHistorical(
  firstYear,
  lastYear,
  startMonth,
  startDay,
  endMonth,
  endDay,
  roi
) {

  var images =
    ee.List.sequence(
      firstYear,
      lastYear
    )
    .map(function(year) {

      return annualNDVI(
        year,
        startMonth,
        startDay,
        endMonth,
        endDay,
        roi
      );

    });


  var collection =
    castCollectionBand(
      ee.ImageCollection.fromImages(
        images
      ),
      'NDVI'
    );


  return collection
    .mean()
    .rename(
      'NDVI'
    )
    .toFloat()
    .clip(
      roi
    );

}


// ============================================================================
// 29. HISTÓRICO CHIRPS
// ============================================================================

function buildRainHistorical(
  firstYear,
  lastYear,
  startMonth,
  startDay,
  endMonth,
  endDay,
  roi
) {

  var images =
    ee.List.sequence(
      firstYear,
      lastYear
    )
    .map(function(year) {

      return annualRain(
        year,
        startMonth,
        startDay,
        endMonth,
        endDay,
        roi
      );

    });


  var collection =
    castCollectionBand(
      ee.ImageCollection.fromImages(
        images
      ),
      'precipitation'
    );


  return collection
    .mean()
    .rename(
      'Rain'
    )
    .toFloat()
    .clip(
      roi
    );

}


// ============================================================================
// 30. HISTÓRICO SMAP
// ============================================================================

function buildSMHistorical(
  firstYear,
  lastYear,
  startMonth,
  startDay,
  endMonth,
  endDay,
  roi
) {

  var images =
    ee.List.sequence(
      firstYear,
      lastYear
    )
    .map(function(year) {

      return annualSM(
        year,
        startMonth,
        startDay,
        endMonth,
        endDay,
        roi
      );

    });


  var collection =
    castCollectionBand(
      ee.ImageCollection.fromImages(
        images
      ),
      'sm_surface'
    );


  return collection
    .mean()
    .rename(
      'SM'
    )
    .toFloat()
    .clip(
      roi
    );

}


// ============================================================================
// 31. PARÂMETROS HISTÓRICOS
// ============================================================================

function getHistoricalParameters() {

  var mode =
    histMode.getValue();


  var p = {};


  if (
    mode ===
    'Período comum'
  ) {

    var first =
      Number(
        commonStart.getValue()
      );


    var last =
      Number(
        commonEnd.getValue()
      );


    if (last < first) {
      return null;
    }


    p.ndviStart = first;
    p.ndviEnd = last;

    p.rainStart = first;
    p.rainEnd = last;

    p.smStart = first;
    p.smEnd = last;

    p.text =
      first +
      '-' +
      last;


    return p;

  }


  if (
    mode ===
    'Máxima série de cada base'
  ) {

    p.ndviStart = 2018;
    p.ndviEnd = 2025;

    p.rainStart = 1981;
    p.rainEnd = 2025;

    p.smStart = 2016;
    p.smEnd = 2025;

    p.text =
      'NDVI 2018-2025 | ' +
      'CHIRPS 1981-2025 | ' +
      'SMAP 2016-2025';


    return p;

  }


  p.ndviStart =
    Number(
      ndviStart.getValue()
    );

  p.ndviEnd =
    Number(
      ndviEnd.getValue()
    );

  p.rainStart =
    Number(
      rainStart.getValue()
    );

  p.rainEnd =
    Number(
      rainEnd.getValue()
    );

  p.smStart =
    Number(
      smStart.getValue()
    );

  p.smEnd =
    Number(
      smEnd.getValue()
    );


  if (
    p.ndviEnd < p.ndviStart ||
    p.rainEnd < p.rainStart ||
    p.smEnd < p.smStart
  ) {

    return null;

  }


  p.text =
    'NDVI ' +
    p.ndviStart +
    '-' +
    p.ndviEnd +
    ' | CHIRPS ' +
    p.rainStart +
    '-' +
    p.rainEnd +
    ' | SMAP ' +
    p.smStart +
    '-' +
    p.smEnd;


  return p;

}


// ============================================================================
// 32. DISPONIBILIDADE
// ============================================================================

function checkLatestDate(
  spatial,
  callback
) {

  var roi =
    spatial.geometry;


  var start =
    ee.Date.fromYMD(
      CURRENT_YEAR,
      1,
      1
    );


  var end =
    ee.Date.fromYMD(
      CURRENT_YEAR + 1,
      1,
      1
    );


  var dates =
    ee.Dictionary({

      sentinel:
        s2
          .filterDate(
            start,
            end
          )
          .filterBounds(
            roi
          )
          .filter(
            ee.Filter.lte(
              'CLOUDY_PIXEL_PERCENTAGE',
              MAX_CLOUD_PERCENT
            )
          )
          .aggregate_max(
            'system:time_start'
          ),

      chirps:
        chirps
          .filterDate(
            start,
            end
          )
          .aggregate_max(
            'system:time_start'
          ),

      smap:
        smap
          .filterDate(
            start,
            end
          )
          .aggregate_max(
            'system:time_start'
          )

    });


  status.setValue(
    'Verificando disponibilidade...'
  );


  dates.evaluate(
    function(data, error) {

      if (error) {

        status.setValue(
          'Erro na disponibilidade.'
        );

        print(
          'ERRO DISPONIBILIDADE:',
          error
        );

        return;

      }


      if (
        data.sentinel === null ||
        data.chirps === null ||
        data.smap === null
      ) {

        status.setValue(
          'Alguma base não possui dados.'
        );

        return;

      }


      var common =
        Math.min(
          data.sentinel,
          data.chirps,
          data.smap
        );


      availabilityLabel.setValue(
        'Última data comum: ' +
        formatDateUTC(common)
      );


      print(
        'Última Sentinel-2:',
        formatDateUTC(
          data.sentinel
        )
      );

      print(
        'Última CHIRPS:',
        formatDateUTC(
          data.chirps
        )
      );

      print(
        'Última SMAP:',
        formatDateUTC(
          data.smap
        )
      );

      print(
        'Última comum:',
        formatDateUTC(
          common
        )
      );


      callback(
        common
      );

    }
  );

}


// ============================================================================
// 33. CLASSIFICAÇÃO DRIW
// ============================================================================

function classifyDRIW(
  droughtRisk,
  roi
) {

  return ee.Image.constant(0)

    .where(
      droughtRisk
        .gte(0)
        .and(
          droughtRisk.lt(0.25)
        ),
      1
    )

    .where(
      droughtRisk
        .gte(0.25)
        .and(
          droughtRisk.lt(0.50)
        ),
      2
    )

    .where(
      droughtRisk
        .gte(0.50)
        .and(
          droughtRisk.lte(1.00)
        ),
      3
    )

    .where(
      droughtRisk.gt(1.00),
      4
    )

    .updateMask(
      droughtRisk.mask()
    )

    .rename(
      'DRIW_CLASS'
    )

    .toByte()

    .clip(
      roi
    );

}


// ============================================================================
// 34. TABELA
// ============================================================================

function buildTable(
  zones,
  droughtRisk,
  droughtClass,
  ndviCurrent,
  ndviHistorical,
  ndviNorm,
  rainCurrent,
  rainHistorical,
  rainNorm,
  smCurrent,
  smHistorical,
  smNorm,
  startText,
  endText,
  historicalText
) {

  var stack =
    ndviCurrent
      .rename('NDVI_ATUAL')

      .addBands(
        ndviHistorical
          .rename('NDVI_HIST')
      )

      .addBands(
        ndviNorm
          .multiply(100)
          .rename('NDVI_ANOM_PCT')
      )

      .addBands(
        rainCurrent
          .rename('CHUVA_ATUAL_MM')
      )

      .addBands(
        rainHistorical
          .rename('CHUVA_HIST_MM')
      )

      .addBands(
        rainNorm
          .multiply(100)
          .rename('CHUVA_ANOM_PCT')
      )

      .addBands(
        smCurrent
          .rename('SM_ATUAL')
      )

      .addBands(
        smHistorical
          .rename('SM_HIST')
      )

      .addBands(
        smNorm
          .multiply(100)
          .rename('SM_ANOM_PCT')
      )

      .addBands(
        droughtRisk
          .rename('INDICE_SECA')
      )

      .addBands(
        droughtClass
          .toFloat()
          .rename('CLASSE_DRIW')
      )

      .toFloat();


  var table =
    stack.reduceRegions({

      collection:
        zones,

      reducer:
        ee.Reducer.mean(),

      scale:
        SCALE_INDEX,

      crs:
        ANALYSIS_CRS,

      tileScale:
        4

    });


  return table.map(
    function(feature) {

      var areaKm2 =
        feature
          .geometry()
          .area(1)
          .divide(1e6);


      return feature.set({

        UNIDADE_NOME:
          feature.get(
            BASIN_FIELD
          ),

        AREA_KM2:
          areaKm2,

        PERIODO_INICIO:
          startText,

        PERIODO_FIM:
          endText,

        REFERENCIA_HISTORICA:
          historicalText,

        LIMIAR_ALTO_RISCO:
          HIGH_RISK_THRESHOLD

      });

    }
  );

}


// ============================================================================
// 35. EXPORTAÇÃO RASTER
// ============================================================================

function createDRIWExportTask(
  droughtRisk,
  droughtClass,
  roi,
  startMillis,
  endMillis,
  historicalText
) {

  var outputName =
    buildDRIWOutputName(
      startMillis,
      endMillis
    );


  var exportImage =
    droughtRisk

      .rename(
        'DRIW'
      )

      .toFloat()

      .addBands(
        droughtClass
          .rename(
            'DRIW_CLASS'
          )
          .toFloat()
      )

      .set({

        produto:
          'DRIW',

        arquivo:
          outputName,

        periodo_inicio:
          formatDateUTC(
            startMillis
          ),

        periodo_fim:
          formatDateUTC(
            endMillis
          ),

        referencia_historica:
          historicalText,

        destino_final_id:
          FINAL_DRIVE_FOLDER_ID,

        destino_final:
          FINAL_DRIVE_PATH,

        limiar_alto_risco:
          HIGH_RISK_THRESHOLD

      });


  print(
    '============================================'
  );

  print(
    'EXPORTAÇÃO RASTER DRIW'
  );

  print(
    'Arquivo:',
    outputName
  );

  print(
    'Staging:',
    GEE_STAGING_FOLDER
  );

  print(
    'Destino final:',
    FINAL_DRIVE_PATH
  );

  print(
    'ID final:',
    FINAL_DRIVE_FOLDER_ID
  );


  Export.image.toDrive({

    image:
      exportImage,

    description:
      outputName,

    folder:
      GEE_STAGING_FOLDER,

    fileNamePrefix:
      outputName,

    region:
      roi,

    scale:
      SCALE_EXPORT,

    crs:
      ANALYSIS_CRS,

    fileFormat:
      'GeoTIFF',

    maxPixels:
      1e13,

    skipEmptyTiles:
      true,

    formatOptions: {
      cloudOptimized:
        true
    }

  });


  print(
    'Tarefa criada em Tarefas.'
  );

  print(
    '============================================'
  );


  return outputName;

}


// ============================================================================
// 36. EXPORTAÇÃO CSV
// ============================================================================

function createDRIWCSVExportTask(
  table,
  startMillis,
  endMillis
) {

  var outputName =
    buildDRIWOutputName(
      startMillis,
      endMillis
    )
    + '_TABELA';


  var tableNoGeometry =
    table.map(function(feature) {

      return ee.Feature(
        null,
        feature.toDictionary()
      );

    });


  Export.table.toDrive({

    collection:
      tableNoGeometry,

    description:
      outputName,

    folder:
      GEE_STAGING_FOLDER,

    fileNamePrefix:
      outputName,

    fileFormat:
      'CSV'

  });


  print(
    'Tarefa CSV:',
    outputName
  );


  print(
    'Staging:',
    GEE_STAGING_FOLDER
  );


  return outputName;

}


// ============================================================================
// 37. PROCESSAMENTO
// ============================================================================

function processAnalysis(
  spatial,
  commonLast
) {

  var roi =
    spatial.geometry;


  var startMillis =
    startDate
      .getValue()[0];


  var requestedEnd =
    endDate
      .getValue()[0];


  if (
    requestedEnd <
    startMillis
  ) {

    status.setValue(
      'Data final anterior à inicial.'
    );

    return;

  }


  var effectiveEnd =
    requestedEnd;


  if (
    limitCommonDate.getValue()
  ) {

    effectiveEnd =
      Math.min(
        requestedEnd,
        commonLast
      );

  }


  if (
    effectiveEnd <
    startMillis
  ) {

    status.setValue(
      'Período fora da disponibilidade.'
    );

    return;

  }


  var startText =
    formatDateUTC(
      startMillis
    );


  var endText =
    formatDateUTC(
      effectiveEnd
    );


  var startJS =
    new Date(
      startMillis
    );


  var endJS =
    new Date(
      effectiveEnd
    );


  var startMonth =
    startJS.getUTCMonth() + 1;


  var startDay =
    startJS.getUTCDate();


  var endMonth =
    endJS.getUTCMonth() + 1;


  var endDay =
    endJS.getUTCDate();


  var hist =
    getHistoricalParameters();


  if (!hist) {

    status.setValue(
      'Referência histórica inválida.'
    );

    return;

  }


  status.setValue(
    'Construindo imagens...'
  );


  // =========================================================================
  // ATUAIS
  // =========================================================================

  var ndviCurrent =
    getNDVICurrent(
      startMonth,
      startDay,
      endMonth,
      endDay,
      roi
    );


  var rainCurrent =
    getRainCurrent(
      startMonth,
      startDay,
      endMonth,
      endDay,
      roi
    );


  var smCurrent =
    getSMCurrent(
      startMonth,
      startDay,
      endMonth,
      endDay,
      roi
    );


  // =========================================================================
  // HISTÓRICOS
  // =========================================================================

  var ndviHistorical =
    buildNDVIHistorical(
      hist.ndviStart,
      hist.ndviEnd,
      startMonth,
      startDay,
      endMonth,
      endDay,
      roi
    );


  var rainHistorical =
    buildRainHistorical(
      hist.rainStart,
      hist.rainEnd,
      startMonth,
      startDay,
      endMonth,
      endDay,
      roi
    );


  var smHistorical =
    buildSMHistorical(
      hist.smStart,
      hist.smEnd,
      startMonth,
      startDay,
      endMonth,
      endDay,
      roi
    );


  // =========================================================================
  // ANOMALIAS
  // =========================================================================

  var ndviAnomaly =
    ndviCurrent
      .subtract(
        ndviHistorical
      )
      .rename(
        'NDVI_Anomaly'
      )
      .toFloat();


  var rainAnomaly =
    rainCurrent
      .subtract(
        rainHistorical
      )
      .rename(
        'Rain_Anomaly'
      )
      .toFloat();


  var smAnomaly =
    smCurrent
      .subtract(
        smHistorical
      )
      .rename(
        'SM_Anomaly'
      )
      .toFloat();


  // =========================================================================
  // NORMALIZAÇÃO
  // ============================================================================

  var ndviNorm =
    ndviAnomaly
      .divide(
        ndviHistorical
      )
      .rename(
        'NDVI_norm'
      )
      .toFloat();


  var rainNorm =
    rainAnomaly
      .divide(
        rainHistorical
      )
      .rename(
        'Rain_norm'
      )
      .toFloat();


  var smNorm =
    smAnomaly
      .divide(
        smHistorical
      )
      .rename(
        'SM_norm'
      )
      .toFloat();


  // =========================================================================
  // DRIW
  // ============================================================================

  var droughtRisk =
    ndviNorm

      .multiply(-1)

      .add(
        rainNorm.multiply(-1)
      )

      .add(
        smNorm.multiply(-1)
      )

      .rename(
        'DRIW'
      )

      .toFloat()

      .clip(
        roi
      );


  var droughtClass =
    classifyDRIW(
      droughtRisk,
      roi
    );


  var highDrought =
    droughtRisk

      .gt(
        HIGH_RISK_THRESHOLD
      )

      .selfMask()

      .rename(
        'High_Drought_Risk'
      );


  // =========================================================================
  // MAPA
  // =========================================================================

  Map.layers().reset();


  analyticalLayers = {};

  boundaryLayer = null;


  analyticalLayers[
    LAYER_DRIW_CLASS
  ] = Map.addLayer(

    droughtClass,

    {
      min: 0,
      max: 4,
      palette:
        DRIW_CLASS_COLORS
    },

    LAYER_DRIW_CLASS,

    false
  );


  analyticalLayers[
    LAYER_DRIW_CONT
  ] = Map.addLayer(

    droughtRisk,

    {
      min: 0,
      max: 1.5,
      palette: [
        'FFFFFF',
        'FFF59D',
        'FFB74D',
        'F4511E',
        'B71C1C'
      ]
    },

    LAYER_DRIW_CONT,

    false
  );


  analyticalLayers[
    LAYER_NDVI
  ] = Map.addLayer(

    ndviAnomaly,

    {
      min: -0.3,
      max: 0.3,
      palette: [
        'FF0000',
        'FFFFFF',
        '008000'
      ]
    },

    LAYER_NDVI,

    false
  );


  analyticalLayers[
    LAYER_RAIN
  ] = Map.addLayer(

    rainAnomaly,

    {
      min: -100,
      max: 100,
      palette: [
        '8B4513',
        'FFFFFF',
        '0000FF'
      ]
    },

    LAYER_RAIN,

    false
  );


  analyticalLayers[
    LAYER_SM
  ] = Map.addLayer(

    smAnomaly,

    {
      min: -0.05,
      max: 0.05,
      palette: [
        'FFD700',
        'FFFFFF',
        '0000FF'
      ]
    },

    LAYER_SM,

    false
  );


  analyticalLayers[
    LAYER_HIGH
  ] = Map.addLayer(

    highDrought,

    {
      palette: [
        'D32F2F'
      ]
    },

    LAYER_HIGH,

    false
  );


  boundaryLayer =
    Map.addLayer(

      spatial.zones.style({
        color: '303030',
        fillColor: '00000000',
        width: 2
      }),

      {},

      'Limites das bacias',

      showBordersCheckbox
        .getValue()

    );


  mainLayerSelect
    .setDisabled(false);


  mainLayerSelect.setValue(
    LAYER_DRIW_CLASS,
    true
  );


  Map.centerObject(
    spatial.zones,
    spatial.name ===
      'Espírito Santo'
      ? 8
      : 10
  );


  // =========================================================================
  // TABELA
  // =========================================================================

  lastTable =
    buildTable(
      spatial.zones,
      droughtRisk,
      droughtClass,
      ndviCurrent,
      ndviHistorical,
      ndviNorm,
      rainCurrent,
      rainHistorical,
      rainNorm,
      smCurrent,
      smHistorical,
      smNorm,
      startText,
      endText,
      hist.text
    );


  print(
    'TABELA POR BACIA:',
    lastTable
  );


  print(
    'TABELA ORDENADA:',
    lastTable.sort(
      'INDICE_SECA',
      false
    )
  );


  // =========================================================================
  // SALVAR RESULTADOS
  // =========================================================================

  lastIndex =
    droughtRisk;

  lastClass =
    droughtClass;

  lastROI =
    roi;

  lastRefStartMillis =
    startMillis;

  lastRefEndMillis =
    effectiveEnd;

  lastHistoricalText =
    hist.text;


  csvButton.setDisabled(
    false
  );


  rasterButton.setDisabled(
    false
  );


  status.setValue(
    'Análise concluída.'
  );


  resultLabel.setValue(
    'Saída: ' +
    buildOutputName()
  );


  // =========================================================================
  // DRIW MÉDIO
  // =========================================================================

  var meanIndex =
    droughtRisk.reduceRegion({

      reducer:
        ee.Reducer.mean(),

      geometry:
        roi,

      scale:
        SCALE_INDEX,

      bestEffort:
        true,

      tileScale:
        8,

      maxPixels:
        1e8

    });


  meanIndex.evaluate(
    function(result, error) {

      if (error) {

        print(
          'ERRO DRIW médio:',
          error
        );

        return;

      }


      var value =
        result.DRIW;


      if (
        value === null ||
        value === undefined
      ) {

        return;

      }


      resultLabel.setValue(

        'DRIW médio: ' +

        Number(value)
          .toFixed(3) +

        ' | ' +

        buildOutputName()

      );

    }
  );

}


// ============================================================================
// 38. EXECUTAR
// ============================================================================

function runAnalysis() {

  lastTable = null;

  lastIndex = null;

  lastClass = null;

  lastROI = null;

  lastRefStartMillis = null;

  lastRefEndMillis = null;

  lastHistoricalText = null;


  analyticalLayers = {};

  boundaryLayer = null;


  csvButton.setDisabled(
    true
  );


  rasterButton.setDisabled(
    true
  );


  mainLayerSelect.setDisabled(
    true
  );


  resultLabel.setValue(
    ''
  );


  renderLegend(
    null
  );


  var spatial =
    resolveSpatialSelection();


  if (!spatial) {

    status.setValue(
      'Selecione a bacia.'
    );

    return;

  }


  checkLatestDate(
    spatial,
    function(commonLast) {

      processAnalysis(
        spatial,
        commonLast
      );

    }
  );

}


runButton.onClick(
  runAnalysis
);


// ============================================================================
// 39. CSV
// ============================================================================

csvButton.onClick(
  function() {

    if (
      lastTable === null
    ) {

      status.setValue(
        'Execute a análise primeiro.'
      );

      return;

    }


    var outputName =
      createDRIWCSVExportTask(

        lastTable,

        lastRefStartMillis,

        lastRefEndMillis

      );


    status.setValue(
      'CSV preparado: ' +
      outputName
    );

  }
);


// ============================================================================
// 40. RASTER
// ============================================================================

rasterButton.onClick(
  function() {

    if (
      lastIndex === null ||
      lastClass === null ||
      lastROI === null ||
      lastRefStartMillis === null ||
      lastRefEndMillis === null
    ) {

      status.setValue(
        'Execute a análise primeiro.'
      );

      return;

    }


    var outputName =
      createDRIWExportTask(

        lastIndex,

        lastClass,

        lastROI,

        lastRefStartMillis,

        lastRefEndMillis,

        lastHistoricalText

      );


    status.setValue(

      'Tarefa criada: ' +

      outputName +

      ' → ' +

      GEE_STAGING_FOLDER

    );

  }
);


// ============================================================================
// 41. LIMPAR
// ============================================================================

clearButton.onClick(
  function() {

    Map.layers().reset();


    lastTable = null;

    lastIndex = null;

    lastClass = null;

    lastROI = null;

    lastRefStartMillis = null;

    lastRefEndMillis = null;

    lastHistoricalText = null;


    analyticalLayers = {};

    boundaryLayer = null;


    csvButton.setDisabled(
      true
    );


    rasterButton.setDisabled(
      true
    );


    mainLayerSelect.setDisabled(
      true
    );


    resultLabel.setValue(
      ''
    );


    availabilityLabel.setValue(
      'Disponibilidade: verificada ao executar'
    );


    status.setValue(
      'Resultados removidos.'
    );


    renderLegend(
      null
    );


    Map.addLayer(

      baciasES.style({
        color: '303030',
        fillColor: '00000000',
        width: 1
      }),

      {},

      'Bacias hidrográficas',

      true

    );


    Map.centerObject(
      municipiosES,
      8
    );

  }
);


// ============================================================================
// 42. INICIALIZAÇÃO
// ============================================================================

updateSpatialInterface();

updateHistoricalInterface();

renderLegend(
  null
);


Map.add(
  panel
);


Map.add(
  legendPanel
);


Map.setControlVisibility({

  all: true,

  layerList: false,

  zoomControl: true,

  scaleControl: true,

  mapTypeControl: true,

  fullscreenControl: true,

  drawingToolsControl: false

});


Map.addLayer(

  baciasES.style({
    color: '303030',
    fillColor: '00000000',
    width: 1
  }),

  {},

  'Bacias hidrográficas',

  true

);


Map.centerObject(
  municipiosES,
  8
);


// ============================================================================
// FIM
// ============================================================================