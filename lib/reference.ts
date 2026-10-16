/**
 * Busca e ranqueia referências do catálogo de plantas mantido na planilha
 * Google. A planilha nunca é acessada pelo navegador: somente este módulo de
 * servidor usa as credenciais configuradas em variáveis de ambiente.
 */

export type ReferenceSearch = {
  configured: boolean;
  sheetId?: string;
  range?: string;
  minimumCompatibility: number;
  qualified: ReferenceCandidate[];
  closest: ReferenceCandidate[];
  totalRows: number;
  message?: string;
};

export type ReferenceCandidate = {
  projectId: string;
  sourceImage: string;
  duplicateOf: string;
  compatibility: number;
  scoreBreakdown: {
    area: number;
    bedrooms: number;
    suites: number;
    sala: number;
    cozinha: number;
  };
  summary: {
    area?: number;
    bedrooms?: number;
    suites?: number;
    bathrooms?: number;
    rooms: string[];
    width?: number;
    depth?: number;
    confidence?: string;
    observations?: string;
  };
  geometryBrief?: unknown;
};

const DEFAULT_SHEET_ID = '1QAnTM566ueEBUitjZuTRx1XYvoxxWFFRhT2czLGMA4A';
const DEFAULT_RANGE = 'Página1!A:R';
const MINIMUM_COMPATIBILITY = 90;
let cachedServiceToken: { value: string; expiresAt: number } | undefined;

const asNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const clean = value.trim().replace(/\s/g, '');
  if (!clean) return undefined;
  const normalized = clean.includes(',')
    ? clean.replace(/\./g, '').replace(',', '.')
    : clean;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : undefined;
};

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const normalized = (value: unknown) => String(value ?? '')
  .toLocaleLowerCase('pt-BR')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '');

function csvRows(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some(value => value.trim())) rows.push(row);
  }
  return rows;
}

function normalizeCatalogGeometry(value: any) {
  const brief = value?.geometryBrief && typeof value.geometryBrief === 'object' ? value.geometryBrief : value;
  if (!brief || brief.idProjeto !== 'PRJ-001') return value;

  // PRJ-001 foi extraído originalmente com os eixos trocados (8,50 ×
  // 23,19). A imagem de referência mostra o lote horizontal de 20,00 ×
  // 10,00 m: recuo lateral esquerdo de 2,00 m, corpo principal de 14,00 m,
  // jardim lateral de 4,00 m e recuo frontal de 1,50 m. Os ambientes abaixo
  // usam essas cotas como coordenadas no mesmo sistema do editor: origem no
  // canto superior esquerdo do lote, x para a direita e y para a frente.
  const room = (id: string, name: string, tipo: string, x: number, y: number, largura: number, profundidade: number, paredesCompartilhadasCom: string[], observacao: string) => ({
    id, name, tipo, x, y, largura, profundidade,
    area: Math.round(largura * profundidade * 100) / 100,
    paredesCompartilhadasCom,
    observacao,
  });
  const rooms = [
    room('r1', 'Sala de Estar / Jantar · Sala de TV', 'social', 9.05, 0, 6.15, 4.19, ['r2', 'r9', 'r10', 'r11'], 'Ambiente social aberto; Sala de Jantar e Sala de TV são zonas distintas sem parede divisória.'),
    room('r2', 'Cozinha', 'social', 11.75, 4.19, 3, 4.3, ['r1', 'r3', 'r8', 'r9'], 'Cota legível de 3,00 × 4,30 m.'),
    room('r3', 'Garagem', 'externo', 14.75, 4.19, 5, 4.3, ['r2', 'r12'], 'Garagem externa para dois carros; avanço controlado dentro do lote.'),
    room('r4', 'Dormitório 02', 'privado', 2, 4.64, 3, 3.71, ['r11', 'r13', 'r14'], 'Cota legível de 3,00 × 3,71 m.'),
    room('r5', 'Dormitório 01', 'privado', 5.5, 4.64, 3.55, 3.71, ['r11', 'r14'], 'Cota legível de 3,55 × 3,71 m; dormitório frontal aproximadamente 20% maior.'),
    room('r6', 'Suíte Casal', 'privado', 2, 0, 3.5, 4.64, ['r7', 'r11', 'r13'], 'Cota legível de 3,50 × 4,64 m.'),
    room('r7', 'Banho Suíte', 'serviço', 5.5, 0, 1.5, 3.14, ['r6', 'r11'], 'Cota legível de 1,50 × 3,14 m.'),
    room('r8', 'Lavanderia', 'serviço', 9.65, 5.69, 2.1, 2.21, ['r2', 'r9', 'r14'], 'Cota legível de 2,10 × 2,21 m.'),
    room('r9', 'Banho Social', 'serviço', 9.05, 4.19, 2.7, 1.5, ['r1', 'r2', 'r8', 'r11'], 'Cota legível de 2,70 × 1,50 m; acesso pela circulação.'),
    room('r10', 'Área de Luz', 'externo', 7.05, 0, 2, 3.14, ['r1', 'r11'], 'Cota legível de 2,00 × 3,14 m; vazio externo de iluminação.'),
    room('r11', 'Circulação', 'circulação', 5.5, 3.14, 3.55, 1.05, ['r4', 'r5', 'r6', 'r7', 'r9', 'r10'], 'Corredor horizontal de ligação; largura e área mantidas como estudo da imagem.'),
    room('r12', 'Jardim dos Fundos', 'externo', 16, 0, 4, 4.19, ['r3'], 'Área verde externa indicada pela cota de 4,00 m.'),
    room('r13', 'Recuo Lateral Esquerdo', 'externo', 0, 0, 2, 8.5, ['r4', 'r6'], 'Faixa lateral esquerda indicada pela cota de 2,00 m.'),
    room('r14', 'Recuo Frontal / Entrada', 'externo', 2, 8.5, 14, 1.5, ['r2', 'r3', 'r4', 'r5', 'r8'], 'Faixa frontal indicada pela cota de 1,50 m.'),
  ];
  const doors = [
    { id: 'd1', nome: 'Porta de Entrada', posicao: { x: 13.2, y: 4.19 }, largura: .9, parede: 'frontal', sentidoAbertura: 'para_dentro_direita', ambiente: 'r1', conectaCom: 'exterior' },
    { id: 'd2', nome: 'Porta Garagem / Sala', posicao: { x: 14.75, y: 4.19 }, largura: .8, parede: 'compartilhada', sentidoAbertura: 'para_dentro_esquerda', ambiente: 'r3', conectaCom: 'r1' },
    { id: 'd3', nome: 'Porta Cozinha / Lavanderia', posicao: { x: 11.75, y: 6.55 }, largura: .8, parede: 'compartilhada', sentidoAbertura: 'para_dentro_direita', ambiente: 'r2', conectaCom: 'r8' },
    { id: 'd4', nome: 'Porta da Suíte', posicao: { x: 5.5, y: 3.65 }, largura: .8, parede: 'compartilhada', sentidoAbertura: 'para_dentro_direita', ambiente: 'r6', conectaCom: 'r11' },
    { id: 'd5', nome: 'Porta Banho Social', posicao: { x: 9.05, y: 4.9 }, largura: .7, parede: 'compartilhada', sentidoAbertura: 'para_dentro_esquerda', ambiente: 'r9', conectaCom: 'r11' },
    { id: 'd6', nome: 'Porta Dormitório 01', posicao: { x: 7.2, y: 4.64 }, largura: .8, parede: 'compartilhada', sentidoAbertura: 'para_dentro_esquerda', ambiente: 'r5', conectaCom: 'r11' },
    { id: 'd7', nome: 'Porta Dormitório 02', posicao: { x: 4.9, y: 4.64 }, largura: .8, parede: 'compartilhada', sentidoAbertura: 'para_dentro_direita', ambiente: 'r4', conectaCom: 'r11' },
    { id: 'd8', nome: 'Porta Banho Suíte', posicao: { x: 6.25, y: 3.14 }, largura: .7, parede: 'compartilhada', sentidoAbertura: 'para_dentro_direita', ambiente: 'r7', conectaCom: 'r11' },
    { id: 'd9', nome: 'Porta Área de Luz / Circulação', posicao: { x: 8.05, y: 3.14 }, largura: .8, parede: 'compartilhada', sentidoAbertura: 'correr', ambiente: 'r10', conectaCom: 'r11' },
    { id: 'd10', nome: 'Acesso Sala / Circulação', posicao: { x: 9.05, y: 3.65 }, largura: .9, parede: 'compartilhada', sentidoAbertura: 'correr', ambiente: 'r1', conectaCom: 'r11' },
  ];
  const windows = [
    { id: 'w1', ambiente: 'r1', posicao: { x: 12.1, y: 0 }, largura: 1.8, altura: 1.2, peitoril: 1, orientacao: 'posterior' },
    { id: 'w2', ambiente: 'r2', posicao: { x: 13, y: 8.49 }, largura: 1.2, altura: 1.2, peitoril: 1, orientacao: 'frontal' },
    { id: 'w3', ambiente: 'r4', posicao: { x: 2, y: 6.45 }, largura: 1.4, altura: 1.2, peitoril: 1, orientacao: 'lateral_esquerda' },
    { id: 'w4', ambiente: 'r5', posicao: { x: 5.5, y: 6.45 }, largura: 1.4, altura: 1.2, peitoril: 1, orientacao: 'lateral_esquerda' },
    { id: 'w5', ambiente: 'r6', posicao: { x: 2, y: 2.3 }, largura: 1.6, altura: 1.2, peitoril: 1, orientacao: 'lateral_esquerda' },
    { id: 'w6', ambiente: 'r7', posicao: { x: 6.25, y: 0 }, largura: .8, altura: .6, peitoril: 1.6, orientacao: 'posterior' },
    // O Banho Social fica no núcleo interno da planta (entre circulação,
    // sala/cozinha e lavanderia) e não possui uma parede externa legível na
    // imagem. Não inventamos uma janela sobre a porta; a ventilação deve ser
    // confirmada no editor/projeto executivo.
  ];
  const corrected = {
    ...brief,
    schemaVersion: '1.1',
    idProjeto: 'PRJ-001',
    sourceImage: 'pha (1).jpg',
    coordinateSystem: {
      unit: 'm',
      origin: 'canto superior esquerdo do lote',
      front: 'y=10',
      back: 'y=0',
      status: 'coordenadas corrigidas pelas cotas visíveis da imagem; sem sobreposição intencional',
    },
    lotDimensions: { width: 20, depth: 10, area: 200 },
    buildingFootprint: { x: 2, y: 0, width: 14, depth: 8.5, area: 119 },
    setbacks: { left: 2, right: 4, front: 1.5, rear: 0, alignment: 14 },
    siteZones: [
      { id: 'z1', name: 'Recuo Lateral Esquerdo', x: 0, y: 0, width: 2, depth: 8.5, area: 17 },
      { id: 'z2', name: 'Jardim dos Fundos', x: 16, y: 0, width: 4, depth: 4.19, area: 16.76 },
      { id: 'z3', name: 'Recuo Frontal / Entrada', x: 2, y: 8.5, width: 14, depth: 1.5, area: 21 },
    ],
    rooms,
    doors,
    windows,
    validation: [
      'Lote corrigido para 20,00 × 10,00 m.',
      'Corpo principal corrigido para x=2,00, y=0,00, largura=14,00 m e profundidade=8,50 m.',
      'Recuo lateral esquerdo de 2,00 m, jardim de 4,00 m e recuo frontal de 1,50 m registrados.',
      'Sala de Estar/Jantar e Sala de TV permanecem como zonas abertas do mesmo ambiente social, sem parede fictícia.',
      'Circulação, Banho Social e Área de Luz receberam conexões e portas compatíveis com a planta.',
      'Portas dos dormitórios e do Banho Suíte foram adicionadas às paredes de acesso.',
      'Janelas dos dormitórios e da suíte foram alinhadas às paredes laterais esquerdas da imagem.',
    ],
    metadata: {
      ...(brief.metadata || {}),
      confidence: 'alta',
      notes: 'Geometria corrigida a partir da imagem pha (1).jpg e das cotas impressas; salas social/jantar e TV são zonas abertas, não ambientes sobrepostos.',
    },
  };
  return value?.geometryBrief && typeof value.geometryBrief === 'object' ? { ...value, geometryBrief: corrected } : corrected;
}

function parseGeometry(value: string | undefined) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return normalizeCatalogGeometry(parsed?.geometryBrief ?? parsed);
  } catch {
    return undefined;
  }
}

function valuesFromApi(values: unknown): string[][] {
  if (!Array.isArray(values)) return [];
  return values.map(row => Array.isArray(row) ? row.map(value => String(value ?? '')) : []);
}

async function readSheetRows(sheetId: string, range: string): Promise<{ rows: string[][]; configured: boolean; message?: string }> {
  const csvUrl = process.env.GOOGLE_SHEETS_CSV_URL;
  if (csvUrl) {
    const response = await fetch(csvUrl, { headers: { Accept: 'text/csv' } });
    if (!response.ok) throw new Error(`CSV da planilha respondeu ${response.status}`);
    return { rows: csvRows(await response.text()), configured: true };
  }

  const directAccessToken = process.env.GOOGLE_SHEETS_ACCESS_TOKEN;
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const accessToken = directAccessToken || (serviceAccountJson ? await serviceAccountToken(serviceAccountJson) : undefined);
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
  if (!accessToken && !apiKey) {
    // When the sheet is shared as "anyone with the link can view", Google’s
    // gviz endpoint exposes a read-only CSV without an API key. This keeps the
    // catalog useful out of the box while private sheets can still use one of
    // the server-side credentials above.
    const sheetName = range.split('!')[0]?.replace(/^'+|'+$/g, '') || 'Página1';
    const publicCsvUrl = new URL(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq`);
    publicCsvUrl.searchParams.set('tqx', 'out:csv');
    publicCsvUrl.searchParams.set('sheet', sheetName);
    const response = await fetch(publicCsvUrl, { headers: { Accept: 'text/csv' } });
    if (!response.ok) {
      return {
        rows: [],
        configured: false,
        message: `A planilha não está pública e nenhuma credencial de servidor foi configurada (Google respondeu ${response.status}).`,
      };
    }
    return { rows: csvRows(await response.text()), configured: true };
  }

  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}`);
  if (apiKey) url.searchParams.set('key', apiKey);
  const response = await fetch(url, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });
  const data = await response.json() as { values?: unknown; error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message || `Google Sheets respondeu ${response.status}`);
  return { rows: valuesFromApi(data.values), configured: true };
}

function base64Url(value: Uint8Array | string): string {
  const binary = typeof value === 'string'
    ? value
    : Array.from(value).map(byte => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemBytes(pem: string): Uint8Array {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----/g, '').replace(/-----END PRIVATE KEY-----/g, '').replace(/\s/g, '');
  const binary = atob(base64);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function serviceAccountToken(raw: string): Promise<string> {
  if (cachedServiceToken && cachedServiceToken.expiresAt > Date.now() + 60_000) return cachedServiceToken.value;
  const credentials = JSON.parse(raw) as { client_email?: string; private_key?: string; token_uri?: string };
  if (!credentials.client_email || !credentials.private_key) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON não contém client_email e private_key.');
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64Url(JSON.stringify({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: credentials.token_uri || 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemBytes(credentials.private_key.replace(/\\n/g, '\n')) as unknown as ArrayBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)));
  const assertion = `${unsigned}.${base64Url(signature)}`;
  const tokenResponse = await fetch(credentials.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(assertion)}`,
  });
  const tokenData = await tokenResponse.json() as { access_token?: string; expires_in?: number; error_description?: string };
  if (!tokenResponse.ok || !tokenData.access_token) throw new Error(tokenData.error_description || 'Não foi possível autenticar a conta de serviço Google.');
  cachedServiceToken = { value: tokenData.access_token, expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000 };
  return tokenData.access_token;
}

function requirementRoomTokens(label: string): string[] {
  const key = normalized(label);
  if (key === 'quartos') return ['quarto', 'suite', 'dormitorio'];
  if (key === 'banheiros') return ['banheiro', 'bwc', 'lavabo'];
  if (key === 'sala') return ['sala', 'living'];
  if (key === 'cozinha') return ['cozinha'];
  if (key === 'lavanderia') return ['lavanderia', 'servico'];
  if (key === 'area gourmet') return ['gourmet', 'churrasqueira'];
  if (key === 'escritorio') return ['escritorio', 'home office'];
  if (key === 'corredor') return ['corredor', 'circulacao', 'hall'];
  if (key === 'closet') return ['closet'];
  if (key === 'piscina') return ['piscina'];
  if (key === 'garagem') return ['garagem'];
  if (key === 'edicula') return ['edicula', 'anexo'];
  return [key];
}

function rowCandidate(row: string[], requirements: any): ReferenceCandidate {
  const geometryBrief = parseGeometry(row[17]);
  const geometryRooms = Array.isArray(geometryBrief?.rooms) ? geometryBrief.rooms : [];
  const roomNames: string[] = geometryRooms.length
    ? geometryRooms.map((room: any) => String(room?.name || '')).filter(Boolean)
    : String(row[13] || '').split(';').map(value => value.trim()).filter(Boolean);
  const summary = {
    area: asNumber(row[6]),
    bedrooms: asNumber(row[7]),
    suites: asNumber(row[8]),
    bathrooms: asNumber(row[9]),
    rooms: roomNames,
    width: asNumber(row[4]),
    depth: asNumber(row[5]),
    confidence: row[15] || undefined,
    observations: row[16] || undefined,
  };
  const targetArea = asNumber(requirements?.area);
  const targetBedrooms = asNumber(requirements?.bedrooms);
  const targetSuites = asNumber(requirements?.suites);
  const areaScore = targetArea && summary.area
    ? clamp(1 - Math.abs(summary.area - targetArea) / Math.max(targetArea, summary.area))
    : 1;
  const requestedRooms: string[] = Array.isArray(requirements?.requestedRooms) ? requirements.requestedRooms : [];
  const hasRoom = (tokens: string[]) => tokens.some(token => roomNames.some(name => normalized(name).includes(token)));
  const wantsBedrooms = requestedRooms.some(room => normalized(room) === 'quartos') || (targetBedrooms !== undefined && targetBedrooms > 0);
  const wantsSuites = targetSuites !== undefined;
  const wantsLiving = requestedRooms.some(room => normalized(room) === 'sala') || requirements?.integratedSocial === true;
  const wantsKitchen = requestedRooms.some(room => normalized(room) === 'cozinha') || requirements?.integratedSocial === true;
  // Quantidades são comparadas de forma exata quando foram pedidas. Área dos
  // cômodos, banheiros, garagem, corredor e extras ficam fora do ranking.
  const bedroomScore = wantsBedrooms && targetBedrooms !== undefined
    ? (summary.bedrooms === targetBedrooms ? 1 : 0)
    : 1;
  const suiteScore = wantsSuites && targetSuites !== undefined
    ? (summary.suites === targetSuites ? 1 : 0)
    : 1;
  const salaScore = wantsLiving ? (hasRoom(['sala', 'living', 'estar', 'jantar']) ? 1 : 0) : 1;
  const cozinhaScore = wantsKitchen ? (hasRoom(['cozinha', 'copa']) ? 1 : 0) : 1;
  const socialScore = (salaScore + cozinhaScore) / 2;
  const weighted = (areaScore * 0.40) + (bedroomScore * 0.30) + (suiteScore * 0.15) + (socialScore * 0.15);
  const compatibility = Math.round(weighted * 1000) / 10;
  return {
    projectId: row[0] || 'sem-id',
    sourceImage: row[1] || '',
    duplicateOf: row[2] || '',
    compatibility,
    scoreBreakdown: {
      area: Math.round(areaScore * 1000) / 10,
      bedrooms: Math.round(bedroomScore * 1000) / 10,
      suites: Math.round(suiteScore * 1000) / 10,
      sala: Math.round(salaScore * 1000) / 10,
      cozinha: Math.round(cozinhaScore * 1000) / 10,
    },
    summary,
    geometryBrief,
  };
}

export async function searchReferenceProjects(requirements: unknown): Promise<ReferenceSearch> {
  const sheetId = process.env.GOOGLE_SHEET_ID || DEFAULT_SHEET_ID;
  const range = process.env.GOOGLE_SHEETS_RANGE || DEFAULT_RANGE;
  try {
    const source = await readSheetRows(sheetId, range);
    if (!source.configured) {
      return { configured: false, sheetId, range, minimumCompatibility: MINIMUM_COMPATIBILITY, qualified: [], closest: [], totalRows: 0, message: source.message };
    }
    const body = source.rows.slice(1).filter(row => row.length >= 2);
    const candidates = body.map(row => rowCandidate(row, requirements)).sort((a, b) => b.compatibility - a.compatibility);
    return {
      configured: true,
      sheetId,
      range,
      minimumCompatibility: MINIMUM_COMPATIBILITY,
      qualified: candidates.filter(candidate => candidate.compatibility >= MINIMUM_COMPATIBILITY).slice(0, 3),
      closest: candidates.slice(0, 3),
      totalRows: body.length,
      message: candidates.length ? undefined : 'A planilha não possui linhas de referência válidas.',
    };
  } catch (error) {
    return {
      configured: false,
      sheetId,
      range,
      minimumCompatibility: MINIMUM_COMPATIBILITY,
      qualified: [],
      closest: [],
      totalRows: 0,
      message: error instanceof Error ? error.message : 'Não foi possível consultar a planilha de referências.',
    };
  }
}
