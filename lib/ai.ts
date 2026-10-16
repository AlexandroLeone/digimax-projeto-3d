import { Project, Item, Room, Wall, addRoom, area, blank, id, wall } from '@/lib/model';

/**
 * Contrato geométrico compartilhado entre o estudo local, a Gemini e os
 * renderizadores 2D/3D. Todas as coordenadas são metros no mesmo plano do
 * editor: origem no canto superior esquerdo e frente do lote em y = D.
 */
export type AiGeometryBrief = {
  /** Metadados internos adicionados quando a geometria veio do catálogo. */
  sourceCatalog?: 'google-sheet';
  sourceProjectId?: string;
  sourceImage?: string;
  lotDimensions?: { width: number; depth: number; area?: number };
  setbacks?: { left?: number; right?: number; front?: number; rear?: number; alignment?: number };
  siteZones?: Array<{ id: string; name: string; x: number; y: number; width: number; depth: number; area: number }>;
  coordinateSystem?: string;
  buildingFootprint: {
    x: number;
    y: number;
    width: number;
    depth: number;
    area: number;
  };
  rooms: Array<{
    id: string;
    name: string;
    tipo: 'social' | 'privado' | 'serviço' | 'externo' | 'circulação';
    x: number;
    y: number;
    largura: number;
    profundidade: number;
    area: number;
    paredesCompartilhadasCom: string[];
  }>;
  doors: Array<{
    id: string;
    nome: string;
    posicao: { x: number; y: number };
    largura: number;
    parede: 'frontal' | 'posterior' | 'lateral_esquerda' | 'lateral_direita' | 'compartilhada';
    sentidoAbertura: 'para_dentro_direita' | 'para_dentro_esquerda' | 'correr' | 'dupla';
    ambiente?: string;
    conectaCom?: string | null;
  }>;
  windows: Array<{
    id: string;
    ambiente: string;
    posicao: { x: number; y: number };
    largura: number;
    altura: number;
    peitoril: number;
    orientacao: 'frontal' | 'posterior' | 'lateral_esquerda' | 'lateral_direita';
  }>;
  validation?: string[];
};

export type AiRequirements = {
  terrainW?: number;
  terrainD?: number;
  area?: number;
  bedrooms: number;
  suites: number;
  bathrooms: number;
  socialBathroom: boolean;
  garage: number;
  integratedSocial: boolean;
  laundry: boolean;
  gourmet: boolean;
  edicula: boolean;
  poolFuture: boolean;
  office: boolean;
  closet: boolean;
  requestedRooms: string[];
  bathroomExplicitlyExcluded?: boolean;
  inferredRooms?: string[];
  excludedRooms?: string[];
  bodyCalculation?: {
    usefulArea?: number | null;
    circulationArea?: number | null;
    wallArea?: number | null;
    builtArea?: number | null;
    footprintWidth?: number | null;
    footprintDepth?: number | null;
    footprintArea?: number | null;
    frontSetback?: number | null;
    rearSetback?: number | null;
    sideSetbacks?: number | null;
    remainingOutdoorArea?: number | null;
  };
  areaDistribution?: Array<{name:string;role:'social'|'private'|'service'|'external';area:number;width:number;length:number;reason:string}>;
  functionalChecks?: {
    bathroomRequired?: boolean;
    bathroomIncluded?: boolean;
    mainEntranceAtFront?: boolean;
    allRoomsAccessible?: boolean;
    corridorNecessary?: boolean;
    ventilationPlanned?: boolean;
    proportionsValid?: boolean;
    conflicts?: string[];
  };
  geometryBrief?: AiGeometryBrief;
  layoutRules?: {
    needsCorridor?: boolean;
    /** Limite explícito para a circulação adicional (0,005 = 0,5% do total). */
    corridorAreaRatio?: number;
    corridorAreaTarget?: number;
    /** Recuo funcional do banheiro quando não existe corredor separado. */
    bathroomSetback?: number | null;
    connections?: Array<{ from: string; to: string; type: 'door' | 'open' | 'external' }>;
    notes?: string[];
    front?: 'y=0' | 'y=D';
    back?: 'y=0' | 'y=D';
    frontDoorRoom?: string;
  };
};

export type AiAlternative = {
  id: 'social' | 'privacy' | 'land';
  title: string;
  description: string;
  project: Project;
  tradeoffs: string[];
};

export type AiProposal = {
  summary: string;
  detail: string;
  apply: (p: Project) => Project;
  affected: string[];
};

export type AiValidation = {
  level: 'ok' | 'warn' | 'error';
  title: string;
  detail: string;
};

const n = (value: string | undefined, fallback = 0) => {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const raw = String(value).trim().replace(/\s/g, '');
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const wordNumber = (value: string | undefined) => { const key=(value||'').toLocaleLowerCase('pt-BR'); return ({um:1,uma:1,dois:2,duas:2,três:3,tres:3,quatro:4,cinco:5,seis:6}[key]||0); };
const countMatch = (text:string, expression:RegExp, fallback=0) => { const match=text.match(expression)?.[1]; return match ? (Number(match)||wordNumber(match)||fallback) : fallback; };
const has = (text: string, words: string[]) => words.some((w) => text.includes(w));

export function parseRequirements(input: string): AiRequirements {
  const text = input.toLocaleLowerCase('pt-BR');
  const negated=(word:string)=>new RegExp(`(?:sem|não quero|nao quero|não preciso de|nao preciso de)[^.,;]{0,24}${word}`,'i').test(text);
  const terrain = text.match(/(?:terreno|lote)[^\d]{0,16}(\d+(?:[,.]\d+)?)\s*(?:x|por)\s*(\d+(?:[,.]\d+)?)/i);
  const areaMatch = text.match(/(\d+(?:[,.]\d+)?)\s*m(?:2|²|etros quadrados)/i);
  const noBedrooms=/(?:sem|não quero|nao quero|não preciso de|nao preciso de)\s+(?:nenhum\s+|um\s+|\d+\s+)?quarto/i.test(text);
  const noGarage=/(?:sem|não quero|nao quero|não preciso de|nao preciso de)\s+(?:nenhuma\s+|uma\s+|\d+\s+)?garagem/i.test(text);
  const suiteMention=has(text, ['suíte', 'suite']);
  const suiteCount=countMatch(text, /(\d+|um|uma|dois|duas|três|tres|quatro)\s*(?:suíte|suite)/i, suiteMention ? 1 : 0);
  const bedroomCount=countMatch(text, /(\d+|um|uma|dois|duas|três|tres|quatro)\s*(?:quarto|dormit)/i, has(text, ['quarto', 'dormit']) ? 1 : 0);
  const suiteIsAdditional=bedroomCount>0&&suiteCount>0&&/\b(?:e|mais|além de)\s*(?:\d+|um|uma|dois|duas|três|tres|quatro)?\s*(?:suíte|suite)/i.test(text);
  const bedrooms=noBedrooms?0:(suiteIsAdditional?bedroomCount+suiteCount:Math.max(bedroomCount,suiteCount));
  const explicitBathroomNumber=countMatch(text, /(\d+|um|uma|dois|duas|três|tres|quatro)\s*(?:banheiro|wc)/i, 0);
  const bathroomMention=has(text, ['banheiro', 'bwc', 'lavabo']);
  const bathroomExplicitlyExcluded=negated('banheiro')||negated('bwc')||negated('lavabo');
  const socialBathroom=!bathroomExplicitlyExcluded&&(has(text, ['banheiro social', 'bwc social', 'lavabo']) || (explicitBathroomNumber>suiteCount && explicitBathroomNumber>0));
  const numberedSocial=/\d+\s*(?:banheiro|bwc)s?\s+sociais?/i.test(text);
  // Quando o usuário informa “3 banheiros”, tratamos 3 como o total. Se ele
  // escreve “banheiro social” sem número, somamos o banheiro da suíte.
  const singleSocialWithSuite=explicitBathroomNumber===1&&socialBathroom&&suiteCount>0&&!numberedSocial;
  const bathrooms=bathroomExplicitlyExcluded?0:(explicitBathroomNumber>0
    ? explicitBathroomNumber+(singleSocialWithSuite?suiteCount:0)
    : (bathroomMention?1:0)+suiteCount);
  const garageAfter = countMatch(text, /(?:garagem|carros?|vagas?)[^.,]{0,16}(\d+|um|uma|dois|duas|três|tres|quatro)/i, 0);
  const garageBefore = countMatch(text, /(\d+|um|uma|dois|duas|três|tres|quatro)\s*(?:carros?|vagas?)(?:[^.,]{0,12}garagem)?/i, 0);
  const garage = garageAfter || garageBefore || (has(text, ['garagem', 'vaga']) ? 1 : 0);
  const requestedRooms: string[] = [];
  const roomMap: [string, string[]][] = [
    ['Quartos', ['quarto', 'dormit']], ['Banheiros', ['banheiro', 'bwc', 'lavabo']],
    ['Sala', ['sala']], ['Cozinha', ['cozinha']], ['Lavanderia', ['lavanderia', 'área de serviço', 'area de serviço']],
    ['Área gourmet', ['área gourmet', 'area gourmet', 'churrasqueira']], ['Escritório', ['escritório', 'escritorio']], ['Corredor', ['corredor', 'circulação', 'circulacao']],
    ['Closet', ['closet']], ['Piscina', ['piscina']], ['Garagem', ['garagem']], ['Edícula', ['edícula', 'edicula', 'anexo']],
  ];
  for (const [label, words] of roomMap) if (has(text, words) && !(label==='Quartos'&&noBedrooms) && !(label==='Banheiros'&&bathroomExplicitlyExcluded) && !(label==='Garagem'&&noGarage) && !(label==='Piscina'&&negated('piscina')) && !(label==='Área gourmet'&&negated('gourmet')) && !(label==='Escritório'&&negated('escrit')) && !(label==='Lavanderia'&&negated('lavanderia')) && !(label==='Corredor'&&(negated('corredor')||negated('circulação')||negated('circulacao'))) && !(label==='Edícula'&&(negated('edícula')||negated('edicula')||negated('anexo')))) requestedRooms.push(label);
  return {
    terrainW: terrain ? n(terrain[1]) : undefined,
    terrainD: terrain ? n(terrain[2]) : undefined,
    area: areaMatch ? n(areaMatch[1]) : undefined,
    bedrooms: Math.max(0, Math.min(12, bedrooms)),
    suites: Math.max(0, Math.min(6, suiteCount)),
    bathrooms: Math.max(0, Math.min(8, bathrooms)),
    socialBathroom,
    garage: noGarage?0:Math.max(0, Math.min(4, garage)),
    integratedSocial: has(text, ['integrada', 'integrado', 'integração', 'integracao']),
    laundry: has(text, ['lavanderia', 'área de serviço', 'area de serviço'])&&!negated('lavanderia'),
    gourmet: has(text, ['área gourmet', 'area gourmet', 'churrasqueira'])&&!negated('gourmet'),
    edicula: has(text, ['edícula', 'edicula', 'anexo'])&&!negated('edícula')&&!negated('edicula'),
    poolFuture: has(text, ['piscina', 'futuramente', 'futuro'])&&!negated('piscina'),
    office: has(text, ['escritório', 'escritorio'])&&!negated('escrit'),
    closet: has(text, ['closet'])&&!negated('closet'),
    requestedRooms,
    bathroomExplicitlyExcluded,
  };
}

/**
 * A residential brief needs a usable sanitary room even when the client did
 * not type the word "banheiro". This is an explicit functional inference,
 * shown in the requirements panel, and can be disabled by saying "sem
 * banheiro". It prevents the renderer from producing a house that cannot be
 * used while still refusing to invent unrelated rooms.
 */
export function ensureFunctionalRequirements(input: string, requirements: AiRequirements): AiRequirements {
  const text = input.toLocaleLowerCase('pt-BR');
  const residentialUse = requirements.bedrooms > 0 || requirements.suites > 0 || requirements.integratedSocial || requirements.requestedRooms.some(roomName => ['Sala', 'Cozinha'].includes(roomName));
  if (!residentialUse || requirements.bathrooms > 0 || requirements.bathroomExplicitlyExcluded || /\b(?:sem|não|nao)\s+(?:ter\s+|precisar\s+de\s+)?(?:banheiro|bwc|lavabo)/i.test(text)) return requirements;
  return {
    ...requirements,
    bathrooms: 1,
    socialBathroom: true,
    requestedRooms: requirements.requestedRooms.includes('Banheiros') ? requirements.requestedRooms : [...requirements.requestedRooms, 'Banheiros'],
    layoutRules: {
      ...requirements.layoutRules,
      notes: [...(requirements.layoutRules?.notes || []), 'Banheiro social incluído como requisito funcional mínimo para uma residência; confirme ou ajuste a posição no editor.'],
    },
  };
}

export function requirementsRows(r: AiRequirements) {
  const rows: [string, string][] = [
    ['Terreno', r.terrainW && r.terrainD ? `${r.terrainW} × ${r.terrainD} m` : 'A definir'],
    ['Área desejada', r.area ? `${r.area} m²` : 'A definir'],
    ['Quartos', r.bedrooms ? String(r.bedrooms) : 'A definir'],
    ['Suítes', r.suites ? String(r.suites) : 'Nenhuma informada'],
    ['Banheiros', r.bathrooms ? String(r.bathrooms) : 'A definir'],
    ['Garagem', r.garage ? `${r.garage} veículo${r.garage > 1 ? 's' : ''}` : 'A definir'],
    ['Sala e cozinha', r.integratedSocial ? 'Integradas' : 'Separadas ou a definir'],
    ['Extras', [...(r.laundry ? ['Lavanderia'] : []), ...(r.gourmet ? ['Área gourmet'] : []), ...(r.edicula ? ['Edícula'] : []), ...(r.office ? ['Escritório'] : []), ...(r.closet ? ['Closet'] : []), ...(r.poolFuture ? ['Piscina futura'] : [])].join(' · ') || 'A definir'],
    ['Ambientes identificados', r.requestedRooms.join(' · ') || 'Base residencial'],
  ];
  if (r.bodyCalculation?.builtArea) rows.splice(2, 0, ['Área calculada pela IA', `${r.bodyCalculation.builtArea.toFixed(2)} m²`]);
  if (r.bodyCalculation?.footprintWidth && r.bodyCalculation?.footprintDepth) rows.push(['Corpo da casa', `${r.bodyCalculation.footprintWidth.toFixed(2)} × ${r.bodyCalculation.footprintDepth.toFixed(2)} m`]);
  if (r.areaDistribution?.length) rows.push(['Distribuição de áreas', r.areaDistribution.map(room => `${room.name}: ${room.area.toFixed(2)} m²`).join(' · ')]);
  if (r.layoutRules?.corridorAreaRatio !== undefined) rows.push(['Circulação', `${(r.layoutRules.corridorAreaRatio * 100).toFixed(2)}% do total · limite 0,50%`]);
  if (r.layoutRules?.bathroomSetback) rows.push(['Recuo do banheiro', `${r.layoutRules.bathroomSetback.toFixed(2)} m sem corredor separado`]);
  if (r.functionalChecks?.conflicts?.length) rows.push(['Pontos para revisar', r.functionalChecks.conflicts.join(' · ')]);
  return rows;
}

function mergeRequirementsFromBrief(brief:AiRequirements, model:Partial<AiRequirements>):AiRequirements{
  // A descrição do cliente é a fonte de verdade. O modelo pode ajudar apenas
  // quando o parser local não encontrou terreno/área; nunca pode adicionar
  // cômodos, quantidades ou extras que não foram solicitados.
  const fallbackNumber=(key:keyof Pick<AiRequirements,'terrainW'|'terrainD'|'area'>)=>{
    const local=brief[key];const remote=model[key];
    return (typeof local==='number'?local:typeof remote==='number'?remote:undefined) as never;
  };
  return {
    ...brief,
    terrainW:fallbackNumber('terrainW'),terrainD:fallbackNumber('terrainD'),area:fallbackNumber('area'),
    bedrooms:brief.bedrooms,suites:brief.suites,bathrooms:brief.bathrooms,garage:brief.garage,
    socialBathroom:brief.socialBathroom,integratedSocial:brief.integratedSocial,
    laundry:brief.laundry,gourmet:brief.gourmet,edicula:brief.edicula,poolFuture:brief.poolFuture,
    office:brief.office,closet:brief.closet,
    requestedRooms:[...(brief.requestedRooms||[])],
    inferredRooms:model.inferredRooms||[],
    excludedRooms:model.excludedRooms||[],
    bodyCalculation:model.bodyCalculation,
    areaDistribution:model.areaDistribution,
    functionalChecks:model.functionalChecks,
    geometryBrief:model.geometryBrief,
    layoutRules:model.layoutRules,
  };
}

function room(idValue: string, name: string, x: number, y: number, w: number, d: number, color: string, material = 'Porcelanato'): Room {
  return { id: idValue, name, x, y, w, d, color, material };
}

function edgeKey(x1:number,y1:number,x2:number,y2:number){
  const a=`${x1.toFixed(3)},${y1.toFixed(3)}`,b=`${x2.toFixed(3)},${y2.toFixed(3)}`;
  return a<b?`${a}|${b}`:`${b}|${a}`;
}
function rectEdges(r:Room){return [[r.x,r.y,r.x+r.w,r.y],[r.x+r.w,r.y,r.x+r.w,r.y+r.d],[r.x+r.w,r.y+r.d,r.x,r.y+r.d],[r.x,r.y+r.d,r.x,r.y]] as [number,number,number,number][]}
function sharedSegment(a:Room,b:Room){
  const eps=.02;
  if(Math.abs(a.x+a.w-b.x)<eps||Math.abs(b.x+b.w-a.x)<eps){const x=Math.abs(a.x+a.w-b.x)<eps?a.x+a.w:b.x+b.w;const y1=Math.max(a.y,b.y),y2=Math.min(a.y+a.d,b.y+b.d);if(y2-y1>.45)return{x1:x,y1,x2:x,y2};}
  if(Math.abs(a.y+a.d-b.y)<eps||Math.abs(b.y+b.d-a.y)<eps){const y=Math.abs(a.y+a.d-b.y)<eps?a.y+a.d:b.y+b.d;const x1=Math.max(a.x,b.x),x2=Math.min(a.x+a.w,b.x+b.w);if(x2-x1>.45)return{x1,y1:y,x2,y2:y};}
  return null;
}
function buildConnectedPlan(base:Project, name:string, W:number, D:number, privacy=false, features:AiRequirements=parseRequirements('')){
  const bedroomCount=Math.max(0,features.bedrooms||0,features.suites||0);
  const bedroomName=(index:number)=>index<(features.suites||0)?`Suíte ${index+1}`:`Quarto ${index-(features.suites||0)+1}`;
  const topH=Math.min(4.2,Math.max(3.4,D*.27));
  const external=features.garage>0||features.gourmet||features.edicula;
  const frontD=external?Math.min(2.4,Math.max(1.8,D*.14)):0;
  const socialW=Math.min(Math.max(4.8,W*.53),W-3.6);
  const socialBathrooms=features.bathrooms>features.suites?Math.max(0,features.bathrooms-features.suites):0;
  const socialCount=features.socialBathroom?Math.max(1,socialBathrooms):socialBathrooms;
  const suiteCount=Math.min(features.suites,Math.max(0,features.bathrooms-socialCount));
  const otherBathrooms=Math.max(0,features.bathrooms-socialCount-suiteCount);
  const serviceNames:string[]=[];
  for(let i=0;i<socialCount;i++)serviceNames.push(i===0?'BWC social':`BWC social ${i+1}`);
  if(features.laundry)serviceNames.push('Lavanderia');
  for(let i=0;i<suiteCount;i++)serviceNames.push(suiteCount===1?'BWC suíte':`BWC suíte ${i+1}`);
  for(let i=0;i<otherBathrooms;i++)serviceNames.push(`BWC ${i+2}`);
  // Só criamos circulação quando ela é necessária para ligar mais de um
  // ambiente íntimo/serviço. Para um briefing simples, a sala faz a ligação.
  const includeCorridor=features.layoutRules?.needsCorridor===true||serviceNames.length>0||bedroomCount>1||features.office||features.closet;
  const corridorW=includeCorridor?Math.min(1.45,Math.max(1.15,W*.14)):0;
  const rightW=Math.max(3.1,W-socialW-corridorW);
  const serviceH=Math.min(2.5,Math.max(2.1,D*.15));
  const serviceCount=serviceNames.length;
  const serviceX=socialW+corridorW;
  const lowerY=topH+serviceCount*serviceH+.35;
  const innerEnd=D-frontD;
  const lowerH=Math.min(4.6,Math.max(3.5,innerEnd-lowerY-.45));
  const rooms:Room[]=[];
  const add=(roomName:string,x:number,y:number,w:number,d:number,color:string)=>{const r=room(id(),roomName,x,y,Math.max(.8,w),Math.max(.8,d),color,'Porcelanato');rooms.push(r);return r;};
  const wantsKitchen=features.requestedRooms.includes('Cozinha')||features.integratedSocial;
  const wantsLiving=features.requestedRooms.includes('Sala')||features.integratedSocial;
  const kitchen=wantsKitchen?add(features.integratedSocial?'Cozinha integrada':'Cozinha',0,0,socialW,topH,'#b8c9b8'):undefined;
  let bedroom1:Room|undefined;
  let topOffice:Room|undefined;
  let closet:Room|undefined;
  if(bedroomCount>0){
    const bedroomX=wantsKitchen?socialW:0;
    const bedroomW=wantsKitchen?W-socialW:W;
    bedroom1=add(bedroomName(0),bedroomX,0,bedroomW,topH,'#c8d2e0');
    if(features.closet){const closetD=Math.min(1.3,Math.max(.9,topH*.3));bedroom1.d=Math.max(1.8,topH-closetD);closet=add('Closet',socialW,bedroom1.d,W-socialW,topH-bedroom1.d,'#c4b7a3');}
  }else if(features.office){
    topOffice=add('Escritório',wantsKitchen?socialW:0,wantsKitchen?0:topH,wantsKitchen?W-socialW:W,topH,'#d7c6a5');
  }
  const living=wantsLiving?add('Sala de Estar/Jantar',0,topH,socialW,Math.max(3.4,innerEnd-topH),'#c7a579'):undefined;
  const circulation=includeCorridor?add('Circulação',socialW,topH,corridorW,Math.max(2.8,innerEnd-topH),'#d9d1b8'):undefined;
  const serviceRooms=serviceNames.map((label,index)=>add(label,serviceX,topH+index*serviceH,rightW,serviceH,label.toLocaleLowerCase('pt-BR').includes('lav')?'#d8d0b8':'#c7d8d4'));
  let bedroom2:Room|undefined;
  if(bedroomCount>=2)bedroom2=add(bedroomName(1),serviceX,lowerY,rightW,lowerH,'#d1c0c8');
  const leftNames:string[]=[];
  for(let index=2;index<bedroomCount;index++)leftNames.push(bedroomName(index));
  if(features.office&&!topOffice)leftNames.push('Escritório');
  const leftRooms:Room[]=[];
  if(leftNames.length){
    const availableForSlots=Math.max(2.4,innerEnd-topH);
    const desiredLiving=living?Math.max(3.4,Math.min(living.d*.58,availableForSlots-leftNames.length*2.4)):0;
    if(living)living.d=Math.max(3.4,desiredLiving);
    const slotY=living?living.y+living.d:topH;
    const slotD=Math.max(.8,(innerEnd-slotY)/leftNames.length);
    leftNames.forEach((label,index)=>leftRooms.push(add(label,0,slotY+index*slotD,socialW,slotD,label.toLocaleLowerCase('pt-BR').includes('escrit')?'#d7c6a5':'#c2ced9')));
  }
  let garageRoom:Room|undefined;
  let gourmetRoom:Room|undefined;
  let ediculaRoom:Room|undefined;
  if(features.garage>0&&features.gourmet){const garageW=Math.min(4.8,Math.max(3.2,socialW*.55));garageRoom=add(`Garagem ${features.garage} carro${features.garage>1?'s':''}`,0,D-frontD,garageW,frontD,'#aeb9bf');gourmetRoom=add('Área gourmet',garageW,D-frontD,socialW-garageW,frontD,'#d1bd91');}
  else if(features.garage>0)garageRoom=add(`Garagem ${features.garage} carro${features.garage>1?'s':''}`,0,D-frontD,socialW,frontD,'#aeb9bf');
  else if(features.gourmet)gourmetRoom=add('Área gourmet',0,D-frontD,socialW,frontD,'#d1bd91');
  if(features.edicula){const annexW=Math.min(4.8,Math.max(3.2,W*.42));const annexX=Math.max(0,W-annexW);ediculaRoom=add('Edícula',annexX,D-frontD,annexW,frontD,'#d4c1a7');}
  const p=blank(name,W,D);p.rooms=rooms;
  const wallsByKey=new Map<string,Wall>();
  for(const r of rooms)for(const [x1,y1,x2,y2] of rectEdges(r)){const key=edgeKey(x1,y1,x2,y2);if(!wallsByKey.has(key))wallsByKey.set(key,wall(x1,y1,x2,y2,r.id));}
  p.walls=[...wallsByKey.values()];
  const addDoor=(a:Room|undefined,b:Room|undefined,label='Porta interna',width=.82)=>{
    if(!a||!b)return;const seg=sharedSegment(a,b);if(!seg)return;
    const midpoint={x:(seg.x1+seg.x2)/2,y:(seg.y1+seg.y2)/2};
    const covers=(candidate:Wall)=>{const dx=candidate.x2-candidate.x1,dy=candidate.y2-candidate.y1,l2=dx*dx+dy*dy;if(l2<.001)return false;const on=(x:number,y:number)=>{const cross=Math.abs((x-candidate.x1)*dy-(y-candidate.y1)*dx);const dot=(x-candidate.x1)*dx+(y-candidate.y1)*dy;return cross<.03&&dot>-.03&&dot<l2+.03;};return on(seg.x1,seg.y1)&&on(seg.x2,seg.y2);};
    const edge=wallsByKey.get(edgeKey(seg.x1,seg.y1,seg.x2,seg.y2))||[...wallsByKey.values()].find(covers);if(!edge)return;
    const dx=edge.x2-edge.x1,dy=edge.y2-edge.y1,l2=dx*dx+dy*dy,edgeLength=Math.sqrt(l2);const at=Math.max(.04,Math.min(.96,((midpoint.x-edge.x1)*dx+(midpoint.y-edge.y1)*dy)/l2));const segmentLength=Math.hypot(seg.x2-seg.x1,seg.y2-seg.y1);const w=Math.min(width,Math.max(.65,Math.min(segmentLength,edgeLength)-.2));
    p.items.push({id:id(),name:label,kind:'door',x:midpoint.x,y:midpoint.y,w,d:edge.t,h:2.1,angle:0,color:'#a97951',wall:edge.id,at,sill:0});
  };
  const addWindow=(r:Room|undefined,edgeIndex:number,width=1.2)=>{if(!r)return;const e=rectEdges(r)[edgeIndex];const edge=wallsByKey.get(edgeKey(...e));if(!edge)return;const L=Math.hypot(e[2]-e[0],e[3]-e[1]);const w=Math.min(width,Math.max(.7,L-.25));p.items.push({id:id(),name:'Janela',kind:'window',x:(e[0]+e[2])/2,y:(e[1]+e[3])/2,w,d:edge.t,h:1.2,angle:0,color:'#536e7b',wall:edge.id,at:.5,sill:1});};
  const addExternalDoor=(r:Room|undefined,edgeIndex=3)=>{if(!r)return;const e=rectEdges(r)[edgeIndex];const edge=wallsByKey.get(edgeKey(...e));if(!edge)return;const L=Math.hypot(e[2]-e[0],e[3]-e[1]);const w=Math.min(.9,Math.max(.7,L-.25));p.items.push({id:id(),name:'Porta de entrada',kind:'door',x:(e[0]+e[2])/2,y:(e[1]+e[3])/2,w,d:edge.t,h:2.1,angle:0,color:'#a97951',wall:edge.id,at:.5,sill:0});};
  addDoor(kitchen,living,features.integratedSocial?'Abertura sala / cozinha':'Acesso cozinha / sala',features.integratedSocial?1.8:.9);
  addDoor(living,circulation,'Acesso à circulação',.82);
  const privateAccess=circulation||living||kitchen||bedroom1||topOffice;
  if(bedroom1)addDoor(bedroom1,privateAccess,'Acesso ao quarto 1',.82);
  if(closet)addDoor(bedroom1,closet,'Acesso ao closet',.72);
  if(topOffice)addDoor(topOffice,privateAccess,'Acesso ao escritório',.82);
  serviceRooms.forEach(sr=>addDoor(privateAccess,sr,`Acesso ao ${sr.name.toLocaleLowerCase('pt-BR')}`,.72));
  addDoor(privateAccess,bedroom2,'Acesso ao quarto 2',.82);
  if(leftRooms.length){addDoor(privateAccess,leftRooms[0],`Acesso ao ${leftRooms[0].name.toLocaleLowerCase('pt-BR')}`,.82);for(let i=1;i<leftRooms.length;i++)addDoor(leftRooms[i-1],leftRooms[i],`Acesso ao ${leftRooms[i].name.toLocaleLowerCase('pt-BR')}`,.82);}
  const frontAccess=living||circulation||bedroom1||kitchen;
  addDoor(frontAccess,garageRoom,'Acesso à garagem',1.2);addDoor(frontAccess,gourmetRoom,'Porta para a área gourmet',1.2);
  addDoor(circulation||frontAccess,ediculaRoom,'Acesso à edícula',.9);
  // Todo projeto gerado precisa ter ao menos uma entrada vinculada a uma
  // parede externa; ela não cria um cômodo e evita uma planta sem acesso.
  addExternalDoor(kitchen||bedroom1||topOffice||living);
  addWindow(kitchen,0,1.5);addWindow(living,3,1.8);addWindow(bedroom1,0,1.5);addWindow(closet,1,.8);addWindow(topOffice,0,1.2);addWindow(bedroom2,1,1.4);leftRooms.forEach(r=>addWindow(r,3,1.2));serviceRooms.forEach(r=>addWindow(r,1,.8));
  if(features.poolFuture){const poolW=Math.min(3.6,Math.max(2.4,W*.28));const poolD=Math.min(5,Math.max(3.2,D*.22));p.items.push({id:id(),name:'Piscina futura',kind:'pool',x:Math.max(.25,W-poolW-.25),y:Math.max(.25,D-poolD-.25),w:poolW,d:poolD,h:.2,angle:0,color:'#73bdd0'});}
  if(privacy)p.rooms=p.rooms.map(r=>r.name==='Sala de Estar/Jantar'?{...r,name:'Sala de Estar/Jantar · social'}:r);
  if(features.area && features.area>0){const current=area(p.rooms);if(current>0){const factor=Math.max(.55,Math.min(1,Math.sqrt(features.area/current)));if(Math.abs(factor-1)>.005){p.rooms=p.rooms.map(r=>({...r,x:r.x*factor,y:r.y*factor,w:r.w*factor,d:r.d*factor}));p.walls=p.walls.map(w=>({...w,x1:w.x1*factor,y1:w.y1*factor,x2:w.x2*factor,y2:w.y2*factor}));p.items=p.items.map(i=>({...i,x:i.x*factor,y:i.y*factor,w:i.w*factor,d:i.d*factor}));}}}
  return p;
}

type LayoutVariant = 'social' | 'privacy' | 'land';
type LayoutSpec = { key: string; name: string; minW: number; minH: number; weight: number; color: string; external?: boolean; fullRow?: boolean; targetArea?: number };

/*
 * The model returns requirements and relations, but it does not own the final
 * coordinates. This deterministic geometry pass is deliberately strict: it
 * creates only the requested rooms, packs them into non-overlapping rows,
 * shares every touching wall, and adds openings only on shared/exterior walls.
 * The three variants use different zoning orders instead of mirroring one
 * template, so the proposal cards are genuinely different layouts.
 */
function buildIntelligentPlan(base: Project, name: string, W: number, D: number, variant: LayoutVariant, features: AiRequirements): Project {
  const bedroomCount = Math.max(0, features.bedrooms || 0, features.suites || 0);
  const requested = features.requestedRooms || [];
  const hasRoom = (label: string) => requested.includes(label);
  const normalizeRoomName = (value: string) => value.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const areaHint = (name: string) => {
    const normalized = normalizeRoomName(name);
    const match = (features.areaDistribution || []).find(item => {
      const candidate = normalizeRoomName(item.name);
      return candidate === normalized || candidate.includes(normalized) || normalized.includes(candidate) || (normalized.includes('sala') && candidate.includes('sala')) || (normalized.includes('bwc') && candidate.includes('banheiro'));
    });
    return match && Number.isFinite(match.area) && match.area > 0 ? match.area : undefined;
  };
  const socialSpecs: LayoutSpec[] = [];
  const privateSpecs: LayoutSpec[] = [];
  const externalSpecs: LayoutSpec[] = [];
  const bedroomSpecs: LayoutSpec[] = [];
  const serviceSpecs: LayoutSpec[] = [];
  const add = (list: LayoutSpec[], key: string, roomName: string, minW: number, minH: number, weight: number, color: string, external = false, fullRow = false) => {
    const spec = { key, name: roomName, minW, minH, weight: areaHint(roomName) || weight, color, external, fullRow };
    list.push(spec);
    return spec;
  };

  const wantsLiving = features.integratedSocial || hasRoom('Sala');
  const wantsKitchen = features.integratedSocial || hasRoom('Cozinha');
  // A sala de estar/jantar precisa ser o setor social dominante. A proporção
  // final é reforçada no empacotamento abaixo (2:1 em relação à cozinha),
  // enquanto estes pesos mantêm o comportamento correto quando houver outros
  // ambientes sociais no futuro.
  if (wantsLiving) add(socialSpecs, 'living', 'Sala de Estar/Jantar', 3.2, 3.0, 2.0, '#c7a579');
  if (wantsKitchen) add(socialSpecs, 'kitchen', features.integratedSocial ? 'Cozinha integrada' : 'Cozinha', 2.6, 3.0, 1.0, '#b8c9b8');

  const suiteRooms = Math.min(bedroomCount, Math.max(0, features.suites || 0));
  for (let i = 0; i < bedroomCount; i++) {
    const suite = i < suiteRooms;
    const nameForRoom = suite ? `Suíte ${i + 1}` : `Quarto ${i - suiteRooms + 1}`;
    // O dormitório que ficará mais próximo da frente recebe a referência
    // 1,20× dos demais. A geometria pode ainda limitar o tamanho pelo lote,
    // mas nunca perde essa prioridade de área.
    const frontBedroom = i === 0;
    const spec = add(bedroomSpecs, `bedroom-${i + 1}`, nameForRoom, frontBedroom ? (suite ? 3.2 : 3.05) : (suite ? 3.0 : 2.75), frontBedroom ? (suite ? 3.2 : 3.0) : (suite ? 3.1 : 2.85), frontBedroom ? 1.2 : (suite ? 1.0 : 1.0), '#c8d2e0');
    privateSpecs.push(spec);
  }

  let totalBathrooms = Math.max(0, features.bathrooms || 0);
  const residentialUse = bedroomCount > 0 || wantsLiving || wantsKitchen;
  if (residentialUse && totalBathrooms === 0 && !features.bathroomExplicitlyExcluded) totalBathrooms = 1;
  if (features.socialBathroom) totalBathrooms = Math.max(1, totalBathrooms);
  if (!features.bathroomExplicitlyExcluded) totalBathrooms = Math.max(totalBathrooms, suiteRooms);
  const suiteBaths = features.bathroomExplicitlyExcluded ? 0 : Math.min(suiteRooms, totalBathrooms);
  for (let i = 0; i < suiteBaths; i++) {
    const spec = add(serviceSpecs, `suite-bath-${i + 1}`, suiteBaths === 1 ? 'BWC suíte' : `BWC suíte ${i + 1}`, 1.55, 2.2, .62, '#c7d8d4');
    privateSpecs.push(spec);
  }
  totalBathrooms -= suiteBaths;
  if (features.laundry) {
    const spec = add(serviceSpecs, 'laundry', 'Lavanderia', 1.8, 2.2, .72, '#d8d0b8');
    privateSpecs.push(spec);
  }
  if (features.socialBathroom && totalBathrooms === 0) totalBathrooms = 1;
  for (let i = 0; i < totalBathrooms; i++) {
    const spec = add(serviceSpecs, `social-bath-${i + 1}`, i === 0 ? 'BWC social' : `BWC ${i + 2}`, 1.6, 2.2, .65, '#c7d8d4');
    privateSpecs.push(spec);
  }
  if (features.office) {
    const spec = add(serviceSpecs, 'office', 'Escritório', 2.5, 2.8, .9, '#d7c6a5');
    privateSpecs.push(spec);
  }
  if (features.closet && bedroomCount > 0) {
    const spec = add(serviceSpecs, 'closet', 'Closet', 1.35, 1.8, .55, '#c4b7a3');
    privateSpecs.push(spec);
  }
  if (features.garage > 0) add(externalSpecs, 'garage', `Garagem ${features.garage} carro${features.garage > 1 ? 's' : ''}`, Math.max(3.2, Math.min(5.8, features.garage * 2.45)), 2.7, 1.1, '#aeb9bf', true);
  if (features.gourmet) add(externalSpecs, 'gourmet', 'Área gourmet', 2.8, 2.5, .95, '#d1bd91', true);
  if (features.edicula) add(externalSpecs, 'edicula', 'Edícula', 3.2, 2.6, .95, '#d4c1a7', true);

  // A descrição é a fonte de verdade. A circulação é um recurso excepcional:
  // quando necessária, sua área adicional não pode ultrapassar 0,5% da área
  // de referência do projeto. Se esse limite não comportar uma passagem
  // mínima de 0,85 × 0,85 m, não criamos uma faixa cenográfica; ligamos os
  // ambientes por portas compartilhadas e registramos a decisão no estudo.
  const physicalCount = socialSpecs.length + privateSpecs.length;
  const projectAreaReference = Math.max(.01, Number(features.area) || Number(features.bodyCalculation?.builtArea) || W * D);
  const corridorAreaTarget = projectAreaReference * .005;
  const corridorMinimumArea = .85 * .85;
  const corridorRequested = hasRoom('Corredor') || features.layoutRules?.needsCorridor === true || physicalCount >= 5;
  const includeCorridor = corridorRequested && corridorAreaTarget >= corridorMinimumArea && W >= .85;
  // O corredor não ocupa mais a largura inteira do lote. Ele é um pequeno
  // hall de ligação com área previamente calculada e fica ligado às duas
  // fileiras por paredes coincidentes.
  const corridor: LayoutSpec | undefined = includeCorridor ? {
    key: 'corridor', name: 'Circulação', minW: .85, minH: .85, weight: .1,
    color: '#d9d1b8', targetArea: corridorAreaTarget,
  } : undefined;

  const minWidth = (list: LayoutSpec[]) => list.reduce((sum, spec) => sum + spec.minW, 0);
  const pack = (list: LayoutSpec[], maxColumns: number) => {
    const rows: LayoutSpec[][] = [];
    let current: LayoutSpec[] = [];
    list.forEach(spec => {
      const tooMany = current.length >= maxColumns;
      const tooWide = current.length > 0 && minWidth(current) + spec.minW > W;
      if (current.length && (tooMany || tooWide)) { rows.push(current); current = []; }
      current.push(spec);
    });
    if (current.length) rows.push(current);
    return rows;
  };

  const rows: LayoutSpec[][] = [];
  const pushRows = (list: LayoutSpec[], maxColumns: number) => rows.push(...pack(list, maxColumns));
  if (variant === 'social') {
    pushRows(socialSpecs, 2);
    if (corridor) rows.push([corridor]);
    // Dormitórios e serviços não compartilham a mesma faixa: isso evita que
    // um banheiro herde a profundidade de um quarto e vire um retângulo
    // desproporcional. As portas continuam sendo calculadas pelas paredes
    // coincidentes entre as fileiras.
    pushRows(bedroomSpecs, 3);
    pushRows(serviceSpecs, 2);
    pushRows(externalSpecs, 2);
  } else if (variant === 'privacy') {
    // A entrada continua sempre na frente e chega à área social. A diferença
    // desta proposta é a separação mais forte entre social e íntimo/serviço,
    // com a ordem dos ambientes privados invertida e agrupada ao fundo.
    pushRows(socialSpecs, 2);
    if (corridor) rows.push([corridor]);
    pushRows(serviceSpecs.slice().reverse(), 2);
    pushRows(bedroomSpecs.slice().reverse(), 2);
    pushRows(externalSpecs, 2);
  } else {
    // A implantação compacta mantém o acesso social na frente e alterna os
    // setores internos, mudando as vizinhanças sem inverter a orientação.
    const firstPrivate = bedroomSpecs.slice(0, Math.ceil(bedroomSpecs.length / 2));
    pushRows(socialSpecs.slice().reverse(), 2);
    pushRows(firstPrivate, 2);
    if (corridor) rows.push([corridor]);
    pushRows(bedroomSpecs.slice(firstPrivate.length), 2);
    pushRows(serviceSpecs, 2);
    pushRows(externalSpecs, 2);
  }
  if (!rows.length) return blank(name, W, D);

  const minimumHeight = (spec: LayoutSpec) => spec.targetArea ? spec.targetArea / Math.max(.01, spec.minW) : spec.minH;
  const minDepth = rows.reduce((sum, row) => sum + Math.max(...row.map(minimumHeight)), 0);
  // Sem área informada, não preenchemos o lote inteiro: usamos apenas a
  // profundidade necessária para os ambientes e preservamos o quintal.
  const requestedDepth = features.area && features.area > 0 ? features.area / W : minDepth;
  const availableDepth = Math.max(4, D - .6);
  const targetDepth = Math.min(availableDepth, Math.max(minDepth, requestedDepth));
  const depthScale = targetDepth / Math.max(.1, minDepth);
  const p = blank(name, W, D);
  const roomByKey = new Map<string, Room>();
  const createdRows: Room[][] = [];
  let y = 0;
  for (const row of rows) {
    const functionalMin = row.some(spec=>spec.key.includes('bath')) ? 2.05 : row.some(spec=>spec.key==='laundry') ? 1.95 : .65;
    const rowMinimumHeight = Math.max(...row.map(minimumHeight));
    // O corredor tem orçamento fechado. Não o esticamos junto com os demais
    // ambientes, pois isso faria a circulação ultrapassar os 0,5% prometidos.
    const height = row.some(spec=>spec.key === 'corridor')
      ? rowMinimumHeight
      : Math.max(functionalMin, rowMinimumHeight * depthScale);
    const totalMin = minWidth(row);
    const totalWeight = row.reduce((sum, spec) => sum + spec.weight, 0) || row.length;
    const extra = Math.max(0, W - totalMin);
    const socialPair = row.length === 2 && row.some(spec=>spec.key === 'living') && row.some(spec=>spec.key === 'kitchen');
    // Quando os dois ambientes estão na mesma fileira, a largura também é
    // área (eles têm a mesma profundidade). Atribuir 2/3 e 1/3 evita que as
    // larguras mínimas produzam uma sala apenas 1,2× maior que a cozinha.
    const socialLivingWidth = socialPair
      ? Math.max(row.find(spec=>spec.key === 'living')?.minW || 3.2, Math.min(W - (row.find(spec=>spec.key === 'kitchen')?.minW || 2.6), W * 2 / 3))
      : undefined;
    const bedroomRow = row.filter(spec=>spec.key.startsWith('bedroom-'));
    const frontBedroomSpec = bedroomRow.find(spec=>spec.key === 'bedroom-1');
    const bedroomWidths = new Map<string, number>();
    const fixedWidths = new Map<string, number>();
    if (frontBedroomSpec && bedroomRow.length >= 2) {
      // Reserve only the minimum functional width for bathrooms/services and
      // distribute all remaining width between bedrooms. This keeps the
      // front bedroom at 1,20× even when a BWC shares the same row.
      const reserved = row.filter(spec=>!spec.key.startsWith('bedroom-')).reduce((sum, spec)=>sum + spec.minW, 0);
      const available = Math.max(bedroomRow.reduce((sum, spec)=>sum + spec.minW, 0), W - reserved);
      const otherWidth = available / (1.2 + bedroomRow.length - 1);
      bedroomWidths.set('bedroom-1', otherWidth * 1.2);
      bedroomRow.filter(spec=>spec.key !== 'bedroom-1').forEach(spec=>bedroomWidths.set(spec.key, otherWidth));
      row.filter(spec=>!spec.key.startsWith('bedroom-')).forEach(spec=>fixedWidths.set(spec.key, spec.minW));
    }
    let x = 0;
    const rowRooms: Room[] = [];
    row.forEach((spec, index) => {
      const compact = spec.key.includes('bath') || spec.key === 'laundry' || spec.key === 'closet' || spec.key === 'corridor';
      const cap = spec.fullRow ? W : spec.key === 'corridor' ? 1.25
        : spec.key.includes('bath') ? 2.45
        : spec.key === 'laundry' ? 2.85
        : spec.key === 'closet' ? 2.05
        : spec.key.startsWith('bedroom-') ? (spec.key === 'bedroom-1' ? 4.8 : 4.35)
        : spec.key === 'office' ? 3.6
        : undefined;
      const single = row.length === 1;
      const singleWidth = spec.fullRow ? W : spec.key === 'corridor' ? 1.2
        : spec.key.includes('bath') ? Math.min(2.35, Math.max(spec.minW, 2.15))
        : spec.key === 'laundry' ? Math.min(2.65, Math.max(spec.minW, 2.25))
        : spec.key === 'closet' ? Math.min(1.9, Math.max(spec.minW, 1.45))
        : spec.key.startsWith('bedroom-') ? Math.min(3.9, Math.max(spec.minW, 3.15))
        : spec.key === 'office' ? Math.min(3.6, Math.max(spec.minW, 3.0))
        : W;
      const weightedWidth = spec.minW + extra * (spec.weight / totalWeight);
      const requestedWidth = socialPair
        ? (spec.key === 'living' ? socialLivingWidth : W - (socialLivingWidth || 0))
        : (bedroomWidths.get(spec.key) ?? fixedWidths.get(spec.key));
      const proposed = requestedWidth !== undefined
        ? requestedWidth
        : (single ? (spec.targetArea ? spec.minW : singleWidth) : (index === row.length - 1 && !compact ? Math.max(.65, W - x) : weightedWidth));
      const width = Math.max(.65, Math.min(cap || W, proposed));
      const next = room(id(), spec.name, x, y, width, height, spec.color, spec.key.includes('bath') ? 'Cerâmica' : 'Porcelanato');
      next.locked = true;
      p.rooms.push(next);
      rowRooms.push(next);
      roomByKey.set(spec.key, next);
      x += width;
    });
    createdRows.push(rowRooms);
    y += height;
  }

  // Ajuste de área orientado pelo pedido: aumenta/reduz a profundidade do
  // conjunto sem alterar a frente, as conexões ou as larguras mínimas. Isso
  // mantém a proporção do corpo da casa mais próxima da área informada sem
  // comprimir banheiros e quartos a faixas impraticáveis.
  const generatedArea = area(p.rooms);
  if (features.area && features.area > 0 && generatedArea > 0) {
    const currentMaxY = p.rooms.reduce((max, r) => Math.max(max, r.y + r.d), 0);
    const targetDepthForArea = Math.min(Math.max(0.1, D - .35), Math.max(0.1, currentMaxY * (features.area / generatedArea)));
    // Não comprimimos banheiros, circulação ou quartos para atingir uma área
    // alvo. Quando o programa mínimo não cabe na área informada, o estudo
    // mantém dimensões funcionais e deixa a divergência explícita para a IA.
    const depthFactor = Math.max(1, Math.min(1.65, targetDepthForArea / Math.max(.1, currentMaxY)));
    if (Math.abs(depthFactor - 1) > .01 || p.rooms.some(r => /bwc|banheiro/i.test(r.name) && r.d > 6 / Math.max(.1, r.w))) {
      let nextY = 0;
      const scaledRows: Room[][] = [];
      for (const rowRooms of createdRows) {
        const scaled = rowRooms.map(r => {
          const d = r.name === 'Circulação'
            ? r.d
            : /bwc|banheiro/i.test(r.name) ? Math.min(r.d * depthFactor, 6 / Math.max(.1, r.w)) : r.d * depthFactor;
          return { ...r, y: nextY, d };
        });
        nextY += Math.max(...scaled.map(r => r.d));
        scaledRows.push(scaled);
      }
      p.rooms = scaledRows.flat();
      // As referências usadas para portas precisam apontar para os cômodos já
      // escalados; caso contrário, uma planta com área alvo teria aberturas
      // calculadas nas coordenadas antigas.
      for (const [key, previous] of roomByKey) {
        const updated = p.rooms.find(room => room.id === previous.id);
        if (updated) roomByKey.set(key, updated);
      }
    }
  }

  const wallsByKey = new Map<string, Wall>();
  for (const r of p.rooms) for (const [x1, y1, x2, y2] of rectEdges(r)) {
    const key = edgeKey(x1, y1, x2, y2);
    if (!wallsByKey.has(key)) wallsByKey.set(key, wall(x1, y1, x2, y2, r.id));
  }
  p.walls = [...wallsByKey.values()];

  const wallForSegment = (seg: { x1: number; y1: number; x2: number; y2: number }) => {
    const direct = wallsByKey.get(edgeKey(seg.x1, seg.y1, seg.x2, seg.y2));
    if (direct) return direct;
    return [...wallsByKey.values()].find(candidate => {
      const dx = candidate.x2 - candidate.x1, dy = candidate.y2 - candidate.y1;
      const on = (x: number, yy: number) => Math.abs((x - candidate.x1) * dy - (yy - candidate.y1) * dx) < .03;
      return on(seg.x1, seg.y1) && on(seg.x2, seg.y2);
    });
  };
  const hasOpening = (edge: Wall, at: number, width: number) => {
    const length = Math.hypot(edge.x2 - edge.x1, edge.y2 - edge.y1);
    return p.items.some(item => item.wall === edge.id && Math.abs((item.at ?? .5) - at) * length < (item.w + width) / 2 + .08);
  };
  const roomIsBedroom = (r: Room | undefined) => !!r && !/bwc|banheiro/i.test(r.name) && /quarto|suíte|suite/i.test(r.name);
  const roomIsKitchen = (r: Room | undefined) => !!r && /cozinha/i.test(r.name);
  const addDoor = (a: Room | undefined, b: Room | undefined, label: string, width = .82) => {
    if (!a || !b) return false;
    // Um quarto nunca deve ser acessado passando por outro quarto. A cozinha
    // também não recebe uma porta direta para o setor íntimo salvo comando
    // explícito do cliente.
    if (roomIsBedroom(a) && roomIsBedroom(b)) return false;
    if ((roomIsBedroom(a) && roomIsKitchen(b)) || (roomIsBedroom(b) && roomIsKitchen(a))) return false;
    const seg = sharedSegment(a, b);
    if (!seg) return false;
    const edge = wallForSegment(seg);
    if (!edge) return false;
    const dx = edge.x2 - edge.x1, dy = edge.y2 - edge.y1, length2 = dx * dx + dy * dy, edgeLength = Math.sqrt(length2);
    const rawAt = ((seg.x1 + seg.x2) / 2 - edge.x1) * dx / length2 + ((seg.y1 + seg.y2) / 2 - edge.y1) * dy / length2;
    const segmentLength = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
    const w = Math.min(width, Math.max(.68, Math.min(segmentLength, edgeLength) - .22));
    const at = Math.max(w / 2 / edgeLength, Math.min(1 - w / 2 / edgeLength, rawAt));
    if (hasOpening(edge, at, w)) return false;
    p.items.push({ id: id(), name: label, kind: 'door', x: (seg.x1 + seg.x2) / 2, y: (seg.y1 + seg.y2) / 2, w, d: edge.t, h: 2.1, angle: 0, color: '#a97951', wall: edge.id, at, sill: 0 });
    return true;
  };
  const roomHasDoor = (r: Room) => p.items.some(item => item.kind === 'door' && item.x >= r.x - .12 && item.x <= r.x + r.w + .12 && item.y >= r.y - .12 && item.y <= r.y + r.d + .12);
  const isExternalRoom = (r: Room | undefined) => !!r && /garagem|gourmet|ed[ií]cula|piscina|varanda|quintal/i.test(r.name);
  const adjacent = (r: Room) => p.rooms.filter(other => other.id !== r.id && sharedSegment(r, other)).sort((a, b) => {
    const sa = sharedSegment(r, a), sb = sharedSegment(r, b);
    return (sb ? Math.hypot(sb.x2 - sb.x1, sb.y2 - sb.y1) : 0) - (sa ? Math.hypot(sa.x2 - sa.x1, sa.y2 - sa.y1) : 0);
  });
  const findKey = (label: string) => {
    const normalized = label.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return p.rooms.find(r => {
      const roomLabel = r.name.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return roomLabel.includes(normalized) || normalized.includes(roomLabel);
    });
  };
  // Relações devolvidas pela IA têm prioridade (por exemplo, sala/cozinha
  // integrada). Depois garantimos acesso a todos os outros ambientes.
  (features.layoutRules?.connections || []).forEach(connection => {
    const from = findKey(connection.from), to = findKey(connection.to);
    if (connection.type !== 'external') addDoor(from, to, connection.type === 'open' ? 'Abertura integrada' : 'Porta de ligação', connection.type === 'open' ? 1.8 : .82);
  });
  const living = roomByKey.get('living'), kitchen = roomByKey.get('kitchen'), corridorRoom = roomByKey.get('corridor');
  if (features.integratedSocial) addDoor(living, kitchen, 'Abertura sala / cozinha', 1.8);
  if (corridorRoom && living) addDoor(living, corridorRoom, 'Acesso à circulação', .9);
  // Ligações funcionais dos serviços: banheiro da suíte abre para a suíte,
  // banheiro social e lavanderia entram numa cadeia de serviço/circulação.
  // Isso evita que a seleção automática transforme um quarto em passagem ou
  // crie uma porta de banheiro diretamente para a garagem.
  const suiteBathrooms=p.rooms.filter(r=>/BWC suíte/i.test(r.name));
  const socialBathrooms=p.rooms.filter(r=>/^BWC social|^BWC \d+/i.test(r.name));
  const laundries=p.rooms.filter(r=>/lavanderia/i.test(r.name));
  const suites=p.rooms.filter(r=>/suíte|suite/i.test(r.name));
  suiteBathrooms.forEach((bath,index)=>addDoor(bath,suites[index]||corridorRoom||living,'Acesso privativo à suíte',.72));
  socialBathrooms.forEach((bath,index)=>addDoor(bath,suiteBathrooms[index]||corridorRoom||living,'Acesso ao banheiro social',.72));
  laundries.forEach(laundry=>addDoor(laundry,socialBathrooms[0]||kitchen||corridorRoom||living,'Acesso à lavanderia',.72));
  for (const current of p.rooms) {
    // Ambientes externos recebem apenas o acesso externo dedicado abaixo;
    // nunca criamos uma porta automática de banheiro/quarto para a garagem.
    if (isExternalRoom(current)) continue;
    if (roomHasDoor(current)) continue;
    const neighbors = adjacent(current).filter(other => !isExternalRoom(other));
    const neighbor = neighbors.find(other => /circulação/i.test(other.name))
      || neighbors.find(other => !roomIsBedroom(current) || (!roomIsBedroom(other) && !roomIsKitchen(other)))
      || neighbors.find(other => !roomIsBedroom(other))
      || neighbors[0];
    if (neighbor) addDoor(current, neighbor, `Acesso ao ${current.name.toLocaleLowerCase('pt-BR')}`, .82);
  }
  const exteriorEdges = (r: Room) => rectEdges(r).filter(edge => {
    const ex=edge[2]-edge[0],ey=edge[3]-edge[1],edgeLength2=ex*ex+ey*ey;
    const hasSharedOverlap=p.rooms.some(candidate=>candidate.id!==r.id&&(() => {
      const seg=sharedSegment(r,candidate); if(!seg)return false;
      const cross1=Math.abs((seg.x1-edge[0])*ey-(seg.y1-edge[1])*ex);
      const cross2=Math.abs((seg.x2-edge[0])*ey-(seg.y2-edge[1])*ex);
      if(cross1>.04||cross2>.04)return false;
      const a=((seg.x1-edge[0])*ex+(seg.y1-edge[1])*ey)/Math.max(.001,edgeLength2);
      const b=((seg.x2-edge[0])*ex+(seg.y2-edge[1])*ey)/Math.max(.001,edgeLength2);
      return Math.min(Math.max(a,b),1)-Math.max(Math.min(a,b),0)>.02;
    })());
    return !hasSharedOverlap&&Math.hypot(edge[2]-edge[0],edge[3]-edge[1])>.65;
  });
  const addExternalDoor = (r: Room | undefined, label: string, force = false, front = false) => {
    if (!r || (!force && roomHasDoor(r))) return;
    const sharedLength = (edge:[number,number,number,number]) => p.rooms.filter(other=>other.id!==r.id).reduce((sum,other)=>{
      const seg=sharedSegment(r,other);if(!seg)return sum;
      const ex=edge[2]-edge[0],ey=edge[3]-edge[1],L2=ex*ex+ey*ey;
      const cross1=Math.abs((seg.x1-edge[0])*ey-(seg.y1-edge[1])*ex),cross2=Math.abs((seg.x2-edge[0])*ey-(seg.y2-edge[1])*ex);
      if(cross1>.04||cross2>.04)return sum;
      const a=((seg.x1-edge[0])*ex+(seg.y1-edge[1])*ey)/Math.max(.001,L2),b=((seg.x2-edge[0])*ex+(seg.y2-edge[1])*ey)/Math.max(.001,L2);
      return sum+Math.max(0,Math.min(Math.max(a,b),1)-Math.max(Math.min(a,b),0))*Math.sqrt(L2);
    },0);
    const edgeCoords = (exteriorEdges(r).length?exteriorEdges(r):rectEdges(r).sort((a,b)=>sharedLength(a)-sharedLength(b))).sort((a, b) => {
      if (front) {
        const frontDistance = (edge: [number, number, number, number]) => Math.min(Math.abs(edge[1]), Math.abs(edge[3]));
        return frontDistance(a) - frontDistance(b);
      }
      return 0;
    })[0];
    const edge = edgeCoords && wallForSegment({ x1: edgeCoords[0], y1: edgeCoords[1], x2: edgeCoords[2], y2: edgeCoords[3] });
    if (!edge) return;
    const length = Math.hypot(edge.x2 - edge.x1, edge.y2 - edge.y1);
    const at = .5, w = Math.min(.9, Math.max(.68, length - .22));
    if (hasOpening(edge, at, w)) return;
    p.items.push({ id: id(), name: label, kind: 'door', x: (edge.x1 + edge.x2) / 2, y: (edge.y1 + edge.y2) / 2, w, d: edge.t, h: 2.1, angle: 0, color: '#a97951', wall: edge.id, at, sill: 0 });
  };
  const socialAnchor = living || kitchen || p.rooms[0];
  addExternalDoor(socialAnchor, 'Porta principal · frente do terreno', true, true);
  externalSpecs.forEach(spec => addExternalDoor(roomByKey.get(spec.key), `Acesso externo · ${spec.name}`, true));
  // Segunda garantia para áreas externas: uma borda parcialmente coberta por
  // outro cômodo não pode fazer a garagem/edícula perder seu acesso próprio.
  p.rooms.filter(isExternalRoom).forEach(externalRoom=>{
    if(p.items.some(item=>item.kind==='door'&&item.name.includes(`Acesso externo · ${externalRoom.name}`)))return;
    const overlap=(edge:[number,number,number,number])=>p.rooms.filter(other=>other.id!==externalRoom.id).reduce((sum,other)=>{
      const seg=sharedSegment(externalRoom,other);if(!seg)return sum;
      const ex=edge[2]-edge[0],ey=edge[3]-edge[1],L2=ex*ex+ey*ey;
      if(Math.abs((seg.x1-edge[0])*ey-(seg.y1-edge[1])*ex)>.04||Math.abs((seg.x2-edge[0])*ey-(seg.y2-edge[1])*ex)>.04)return sum;
      const a=((seg.x1-edge[0])*ex+(seg.y1-edge[1])*ey)/Math.max(.001,L2),b=((seg.x2-edge[0])*ex+(seg.y2-edge[1])*ey)/Math.max(.001,L2);
      return sum+Math.max(0,Math.min(Math.max(a,b),1)-Math.max(Math.min(a,b),0))*Math.sqrt(L2);
    },0);
    const e=rectEdges(externalRoom).sort((a,b)=>overlap(a)-overlap(b))[0];
    const target=wallsByKey.get(edgeKey(e[0],e[1],e[2],e[3]));
    if(!target)return;
    const length=Math.hypot(target.x2-target.x1,target.y2-target.y1),width=Math.min(.9,Math.max(.68,length-.22));
    p.items.push({id:id(),name:`Acesso externo · ${externalRoom.name}`,kind:'door',x:(target.x1+target.x2)/2,y:(target.y1+target.y2)/2,w:width,d:target.t,h:2.1,angle:0,color:'#a97951',wall:target.id,at:.5,sill:0});
  });

  const addWindow = (r: Room | undefined, width: number) => {
    if (!r) return;
    const isFrontEdge = (edge: [number, number, number, number]) => Math.abs(edge[1] - edge[3]) < .03 && Math.min(Math.abs(edge[1]), Math.abs(edge[3])) < .03;
    const candidates = exteriorEdges(r).sort((a, b) => {
      // A entrada principal já ocupa a frente da sala. Prefira uma face
      // lateral ou posterior para a janela dessa sala, evitando a leitura de
      // porta e janela invertidas/sobrepostas na mesma fachada.
      const frontPenalty = r === socialAnchor ? Number(isFrontEdge(a)) - Number(isFrontEdge(b)) : 0;
      return frontPenalty || Math.hypot(b[2] - b[0], b[3] - b[1]) - Math.hypot(a[2] - a[0], a[3] - a[1]);
    });
    // Escolha uma parede externa livre. Se a face mais longa tiver a porta
    // principal, tente outra face ou uma posição lateral, nunca desenhe a
    // janela sobre a abertura existente.
    for (const edgeCoords of candidates) {
      const edge = wallForSegment({ x1: edgeCoords[0], y1: edgeCoords[1], x2: edgeCoords[2], y2: edgeCoords[3] });
      if (!edge) continue;
      const length = Math.hypot(edge.x2 - edge.x1, edge.y2 - edge.y1);
      const w = Math.min(width, Math.max(.7, length - .3));
      for (const at of [.5, .25, .75]) {
        if (hasOpening(edge, at, w)) continue;
        const dx = edge.x2 - edge.x1, dy = edge.y2 - edge.y1;
        p.items.push({ id: id(), name: 'Janela', kind: 'window', x: edge.x1 + dx * at, y: edge.y1 + dy * at, w, d: edge.t, h: 1.2, angle: 0, color: '#536e7b', wall: edge.id, at, sill: 1 });
        return;
      }
    }
  };
  p.rooms.filter(r => !r.name.toLocaleLowerCase('pt-BR').includes('circulação')).forEach(r => addWindow(r, /bwc|banheiro|lavanderia/i.test(r.name) ? .8 : 1.35));
  if (features.poolFuture) {
    const poolW = Math.min(3.6, Math.max(2.4, W * .28)), poolD = Math.min(5, Math.max(3.2, D * .22));
    p.items.push({ id: id(), name: 'Piscina futura', kind: 'pool', x: Math.max(.25, W - poolW - .25), y: Math.max(.25, Math.min(D - poolD - .25, targetDepth + .35)), w: poolW, d: poolD, h: .2, angle: 0, color: '#73bdd0' });
  }
  // O editor usa coordenadas SVG com y crescente para baixo. Para manter a
  // leitura arquitetônica da referência do usuário, a frente padrão fica na
  // borda inferior do terreno: a sala/entrada começa no fundo visual e os
  // ambientes íntimos ficam para dentro. Se uma integração futura informar
  // explicitamente y=0, preservamos essa orientação sem espelhar novamente.
  return features.layoutRules?.front === 'y=0' ? p : mirrorPlanY(p);
}

// As três alternativas partem do mesmo briefing, mas usam implantações
// realmente diferentes. A transformação é aplicada à geometria inteira —
// paredes, cômodos, portas, janelas, móveis e piscina — preservando os IDs e
// as referências usadas pelo editor 2D e pelo modelo 3D.
function mirrorPlanX(source:Project):Project{
  const W=source.w;
  return {
    ...source,
    rooms:source.rooms.map(r=>({...r,x:W-r.x-r.w})),
    walls:source.walls.map(w=>({...w,x1:W-w.x1,x2:W-w.x2})),
    items:source.items.map(i=>i.wall?({...i,x:W-i.x}):({...i,x:W-i.x-i.w})),
  };
}
function mirrorPlanY(source:Project):Project{
  const D=source.d;
  return {
    ...source,
    rooms:source.rooms.map(r=>({...r,y:D-r.y-r.d})),
    walls:source.walls.map(w=>({...w,y1:D-w.y1,y2:D-w.y2})),
    items:source.items.map(i=>i.wall?({...i,y:D-i.y}):({...i,y:D-i.y-i.d})),
  };
}

const geometryRound = (value:number) => Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;

function geometryRole(name:string): 'social'|'private'|'service'|'external' {
  const value=name.toLocaleLowerCase('pt-BR');
  if (/garagem|gourmet|ed[ií]cula|piscina|varanda|quintal/.test(value)) return 'external';
  if (/bwc|banheiro|lavanderia|servi[cç]o|closet|escrit[oó]rio|circula[cç][aã]o|corredor|hall/.test(value)) return 'service';
  if (/quarto|su[ií]te/.test(value)) return 'private';
  return 'social';
}

function geometryTipo(name:string): AiGeometryBrief['rooms'][number]['tipo'] {
  if (/circula[cç][aã]o|corredor|hall/i.test(name)) return 'circulação';
  const role=geometryRole(name);
  if (role==='private') return 'privado';
  if (role==='service') return 'serviço';
  if (role==='external') return 'externo';
  return 'social';
}

/**
 * Faz o estudo espacial no próprio navegador antes de qualquer chamada de
 * modelo. A mesma geometria retangular usada para gerar as propostas é
 * serializada em coordenadas claras, para a Gemini revisar e devolver no
 * mesmo contrato, sem receber apenas uma descrição genérica.
 */
export function calculatePreGeminiGeometry(base:Project, input:string, requirements:AiRequirements) {
  const local=ensureFunctionalRequirements(input, requirements);
  const W=Math.max(2, Number(local.terrainW)||Number(base.w)||12);
  const D=Math.max(2, Number(local.terrainD)||Number(base.d)||15);
  const features:AiRequirements={
    ...local,
    terrainW:W,
    terrainD:D,
    layoutRules:{...local.layoutRules,front:'y=D',back:'y=0'},
  };
  const provisional=buildIntelligentPlan(base, `${base.name} · Estudo preliminar`, W, D, 'social', features);
  const rooms=provisional.rooms;
  const minX=rooms.length?Math.min(...rooms.map(r=>r.x)):0;
  const minY=rooms.length?Math.min(...rooms.map(r=>r.y)):0;
  const maxX=rooms.length?Math.max(...rooms.map(r=>r.x+r.w)):W;
  const maxY=rooms.length?Math.max(...rooms.map(r=>r.y+r.d)):D;
  const footprintX=Math.max(0,Math.min(W,minX));
  const footprintY=Math.max(0,Math.min(D,minY));
  const footprintW=Math.max(.01,Math.min(W-footprintX,maxX-footprintX));
  const footprintD=Math.max(.01,Math.min(D-footprintY,maxY-footprintY));
  const footprintArea=footprintW*footprintD;
  const roomArea=(r:Room)=>r.w*r.d;
  const roomById=new Map(rooms.map(r=>[r.id,r]));
  const sharedRooms=(source:Room)=>rooms.filter(other=>other.id!==source.id&&!!sharedSegment(source,other)).map(other=>other.id);
  const roomAt=(x:number,y:number)=>rooms.find(r=>x>=r.x-.05&&x<=r.x+r.w+.05&&y>=r.y-.05&&y<=r.y+r.d+.05);
  const wallForItem=(item:Item)=>item.wall?provisional.walls.find(w=>w.id===item.wall):undefined;
  const wallRooms=(target:Wall|undefined)=>target?rooms.filter(r=>rectEdges(r).some(e=>{
    const ex=e[2]-e[0],ey=e[3]-e[1];
    const collinear=Math.abs((target.x1-e[0])*ey-(target.y1-e[1])*ex)<.04&&Math.abs((target.x2-e[0])*ey-(target.y2-e[1])*ex)<.04;
    if(!collinear)return false;
    const edgeLength=Math.hypot(ex,ey),a=((target.x1-e[0])*ex+(target.y1-e[1])*ey)/Math.max(.001,edgeLength*edgeLength),b=((target.x2-e[0])*ex+(target.y2-e[1])*ey)/Math.max(.001,edgeLength*edgeLength);
    const lo=Math.min(a,b),hi=Math.max(a,b);
    return Math.min(hi,1)-Math.max(lo,0)>.02;
  })):[];
  const edgeOrientation=(target:Wall|undefined):'frontal'|'posterior'|'lateral_esquerda'|'lateral_direita'|'compartilhada'=>{
    if(!target)return 'compartilhada';
    const horizontal=Math.abs(target.y1-target.y2)<.03;
    const vertical=Math.abs(target.x1-target.x2)<.03;
    if(horizontal&&Math.abs(target.y1-D)<.08)return 'frontal';
    if(horizontal&&Math.abs(target.y1)<.08)return 'posterior';
    if(vertical&&Math.abs(target.x1-footprintX)<.08)return 'lateral_esquerda';
    if(vertical&&Math.abs(target.x1-(footprintX+footprintW))<.08)return 'lateral_direita';
    return 'compartilhada';
  };
  const doorSense=(name:string):AiGeometryBrief['doors'][number]['sentidoAbertura']=>{
    const value=name.toLocaleLowerCase('pt-BR');
    if(value.includes('correr')||value.includes('slide'))return 'correr';
    if(value.includes('dupla'))return 'dupla';
    return value.includes('esquerda')?'para_dentro_esquerda':'para_dentro_direita';
  };
  const geometryRooms:AiGeometryBrief['rooms']=rooms.map(r=>{
    const largura=geometryRound(r.w), profundidade=geometryRound(r.d);
    return {
      id:r.id,
      name:r.name,
      tipo:geometryTipo(r.name),
      x:geometryRound(r.x),
      y:geometryRound(r.y),
      largura,
      profundidade,
      area:geometryRound(largura*profundidade),
      paredesCompartilhadasCom:sharedRooms(r),
    };
  });
  const doors:AiGeometryBrief['doors']=provisional.items.filter(i=>i.kind==='door').map(item=>{
    const target=wallForItem(item);
    const linked=wallRooms(target);
    const anchor=roomAt(item.x,item.y)||linked[0];
    const other=linked.find(r=>r.id!==anchor?.id);
    const orientation=edgeOrientation(target);
    return {
      id:item.id,
      nome:item.name,
      posicao:{x:geometryRound(item.x),y:geometryRound(item.y)},
      largura:geometryRound(item.w),
      parede:orientation,
      sentidoAbertura:doorSense(item.name),
      ambiente:anchor?.id,
      conectaCom:other?.id||null,
    };
  });
  const windows:AiGeometryBrief['windows']=provisional.items.filter(i=>i.kind==='window').map(item=>{
    const target=wallForItem(item);
    const linked=wallRooms(target);
    const anchor=roomAt(item.x,item.y)||linked[0];
    const orientation=edgeOrientation(target);
    // Uma janela deve ser externa. Se o primeiro cálculo encontrar uma linha
    // compartilhada, a validação abaixo a sinaliza para a Gemini corrigir.
    const externalOrientation=orientation==='compartilhada'?'posterior':orientation;
    return {
      id:item.id,
      ambiente:anchor?.id||'',
      posicao:{x:geometryRound(item.x),y:geometryRound(item.y)},
      largura:geometryRound(item.w),
      altura:geometryRound(item.h),
      peitoril:geometryRound(item.sill??1),
      orientacao:externalOrientation as 'frontal'|'posterior'|'lateral_esquerda'|'lateral_direita',
    };
  });
  const grossArea=area(rooms);
  const circulationArea=rooms.filter(r=>/circula[cç][aã]o|corredor|hall/i.test(r.name)).reduce((sum,r)=>sum+roomArea(r),0);
  const usefulArea=Math.max(0,grossArea-circulationArea);
  const wallArea=grossArea*.1;
  const builtArea=grossArea+wallArea;
  const corridorAreaTarget=geometryRound((Number(local.area)||builtArea||footprintArea)*.005);
  const corridorAreaRatio=Math.round((circulationArea/Math.max(.01,Number(local.area)||builtArea||footprintArea))*100000)/100000;
  const corridorRequestedByBrief=local.requestedRooms.includes('Corredor')||local.layoutRules?.needsCorridor===true||rooms.length>=5;
  const corridorSuppressed=corridorRequestedByBrief&&circulationArea<=.001&&corridorAreaTarget<.85*.85;
  const externalRoomArea=rooms.filter(r=>geometryRole(r.name)==='external').reduce((sum,r)=>sum+roomArea(r),0);
  const areaDistribution=rooms.map(r=>({
    name:r.name,
    role:geometryRole(r.name),
    area:geometryRound(roomArea(r)),
    width:geometryRound(r.w),
    length:geometryRound(r.d),
    reason:/circula[cç][aã]o|corredor/i.test(r.name)?'ligação mínima entre ambientes':geometryRole(r.name)==='external'?'uso externo solicitado':'dimensão proporcional ao programa informado',
  }));
  const validation=validateProject(provisional);
  const errors=validation.filter(v=>v.level==='error');
  const warnings=validation.filter(v=>v.level==='warn');
  const requestedArea=Number(local.area)||0;
  const areaMismatch=requestedArea>0&&Math.abs(builtArea-requestedArea)/requestedArea>.05;
  const livingRoom=rooms.find(r=>/sala/i.test(r.name));
  const kitchenRoom=rooms.find(r=>/cozinha/i.test(r.name));
  const livingKitchenRatio=livingRoom&&kitchenRoom?roomArea(livingRoom)/Math.max(.01,roomArea(kitchenRoom)):undefined;
  const bedrooms=rooms.filter(r=>/quarto|su[ií]te/i.test(r.name));
  const frontBedroom=bedrooms.slice().sort((a,b)=>(b.y+b.d)-(a.y+a.d))[0];
  const remainingBedrooms=bedrooms.filter(r=>r.id!==frontBedroom?.id);
  const averageBedroomArea=remainingBedrooms.length?remainingBedrooms.reduce((sum,r)=>sum+roomArea(r),0)/remainingBedrooms.length:0;
  const frontBedroomRatio=frontBedroom&&averageBedroomArea?roomArea(frontBedroom)/averageBedroomArea:undefined;
  const ratioConflicts:string[]=[];
  if(corridorAreaRatio>.005+0.0001) ratioConflicts.push(`A circulação calculada (${geometryRound(circulationArea)} m²) ultrapassa o limite de 0,5% da área do projeto; reduza-a ou elimine o corredor separado.`);
  if(livingKitchenRatio!==undefined&&livingKitchenRatio<1.8) ratioConflicts.push(`Sala/jantar ficou em ${geometryRound(livingKitchenRatio)}× a cozinha; ajuste para aproximadamente 2×.`);
  if(frontBedroomRatio!==undefined&&frontBedroomRatio<1.1) ratioConflicts.push(`O quarto mais próximo da frente ficou apenas ${geometryRound(frontBedroomRatio)}× a média dos demais; ajuste para cerca de 1,2×.`);
  const bathroomSetback=circulationArea<=.001&&rooms.some(r=>/bwc|banheiro/i.test(r.name)) ? .85 : null;
  const conflicts=[...errors.map(v=>v.detail),...ratioConflicts,...(areaMismatch?[`A área construída calculada (${geometryRound(builtArea)} m²) difere mais de 5% da área solicitada (${geometryRound(requestedArea)} m²); a Gemini deve ajustar ou pedir confirmação.`]:[])];
  const frontDoor=doors.find(d=>d.nome.toLocaleLowerCase('pt-BR').includes('principal'));
  const roomHasWindow=(r:Room)=>windows.some(w=>w.ambiente===r.id);
  const geometryBrief:AiGeometryBrief={
    coordinateSystem:'origem no canto superior esquerdo; frente do terreno em y=D; unidades em metros; x cresce para a direita e y cresce para a frente',
    buildingFootprint:{x:geometryRound(footprintX),y:geometryRound(footprintY),width:geometryRound(footprintW),depth:geometryRound(footprintD),area:geometryRound(footprintArea)},
    rooms:geometryRooms,
    doors,
    windows,
    validation:[
      `${geometryRooms.length} ambientes retangulares calculados sem sobreposição intencional.`,
      `${doors.length} portas vinculadas às paredes e ${windows.length} janelas vinculadas às paredes externas.`,
      conflicts.length?conflicts.join(' '):'Paredes, acessos, proporções e área passaram pela validação geométrica preliminar.',
      ...warnings.map(v=>v.detail),
    ],
  };
  const connections=doors.map(door=>{
    const from=roomById.get(door.ambiente||'');
    const to=roomById.get(door.conectaCom||'');
    return {from:from?.name||door.ambiente||'ambiente',to:to?.name||'exterior',type:to?'door':'external' as 'door'|'external'};
  });
  const frontSetback=Math.max(0,D-maxY);
  const rearSetback=Math.max(0,minY);
  const sideSetbacks=Math.max(0,Math.min(footprintX,W-(footprintX+footprintW)));
  return {
    bodyCalculation:{
      usefulArea:geometryRound(usefulArea),
      circulationArea:geometryRound(circulationArea),
      wallArea:geometryRound(wallArea),
      builtArea:geometryRound(builtArea),
      footprintWidth:geometryRound(footprintW),
      footprintDepth:geometryRound(footprintD),
      footprintArea:geometryRound(footprintArea),
      frontSetback:geometryRound(frontSetback),
      rearSetback:geometryRound(rearSetback),
      sideSetbacks:geometryRound(sideSetbacks),
      remainingOutdoorArea:geometryRound(Math.max(0,W*D-footprintArea)),
    },
    areaDistribution,
    functionalChecks:{
      bathroomRequired:local.bedrooms>0||local.suites>0||local.integratedSocial,
      bathroomIncluded:rooms.some(r=>/bwc|banheiro/i.test(r.name)),
      mainEntranceAtFront:!!frontDoor&&frontDoor.parede==='frontal',
      allRoomsAccessible:!validation.some(v=>v.title==='Acesso a confirmar'&&v.level!=='ok'),
      corridorNecessary:rooms.some(r=>/circula[cç][aã]o|corredor/i.test(r.name)),
      ventilationPlanned:rooms.filter(r=>!(/circula[cç][aã]o|corredor/i.test(r.name))).every(roomHasWindow),
      proportionsValid:errors.length===0&&!areaMismatch&&!ratioConflicts.length&&rooms.filter(r=>!(/circula[cç][aã]o|corredor|hall/i.test(r.name))).every(r=>r.w>=1.2&&r.d>=1.8),
      conflicts,
    },
    layoutRules:{
      front:'y=D' as const,
      back:'y=0' as const,
      needsCorridor:rooms.some(r=>/circula[cç][aã]o|corredor/i.test(r.name)),
      corridorAreaRatio,
      corridorAreaTarget,
      bathroomSetback,
      connections,
      frontDoorRoom:frontDoor?.ambiente||'',
      notes:[
        'Estudo preliminar calculado localmente antes da Gemini.',
        'Coordenadas e conexões devem ser preservadas pela resposta do modelo quando já estiverem válidas.',
        corridorSuppressed?'O corredor separado foi omitido: 0,5% da área não comportaria uma passagem mínima de 0,85 m; os ambientes foram ligados diretamente por portas compartilhadas.':'A circulação separada é opcional e limitada a 0,5% da área de referência.',
        'Sala de estar/jantar deve manter aproximadamente o dobro da área da cozinha.',
        'O quarto mais próximo da frente deve ser aproximadamente 20% maior que os demais.',
        bathroomSetback?`Sem corredor separado, banheiros devem permanecer recuados ${bathroomSetback.toFixed(2)} m do acesso/frente, preservando a porta e a ventilação.`:'Com corredor separado, o recuo adicional do banheiro não é obrigatório.',
        externalRoomArea>0?'Áreas externas foram separadas do núcleo social e íntimo.':'Nenhuma área externa foi adicionada sem solicitação.',
      ],
    },
    geometryBrief,
    provisional,
  };
}

/** Converte o geometryBrief devolvido pela Gemini em elementos editáveis. */
function geometryBriefToProject(brief:AiGeometryBrief, name:string, W:number, D:number, options:{relaxedCatalog?:boolean}={}):Project|null {
  if(!brief?.buildingFootprint||!Array.isArray(brief.rooms)||!brief.rooms.length)return null;
  const finite=(value:number)=>Number.isFinite(value);
  if(!brief.rooms.every(r=>[r.x,r.y,r.largura,r.profundidade,r.area].every(finite)&&r.largura>.2&&r.profundidade>.2))return null;
  const relaxedCatalog=options.relaxedCatalog===true;
  const footprintWidth=Number(brief.buildingFootprint.width);
  const footprintDepth=Number(brief.buildingFootprint.depth);
  if(!finite(footprintWidth)||!finite(footprintDepth)||footprintWidth<=.2||footprintDepth<=.2)return null;
  // Referências da planilha já estão em coordenadas do lote completo. Quando
  // houver lotDimensions, preservamos os recuos e o jardim em vez de esticar
  // o corpo da casa para ocupar todo o canvas.
  const sourceLotWidth=relaxedCatalog&&brief.lotDimensions?.width&&brief.lotDimensions.width>.2?brief.lotDimensions.width:footprintWidth;
  const sourceLotDepth=relaxedCatalog&&brief.lotDimensions?.depth&&brief.lotDimensions.depth>.2?brief.lotDimensions.depth:footprintDepth;
  const sx=W/sourceLotWidth;
  const sy=D/sourceLotDepth;
  const originX=relaxedCatalog?0:(finite(Number(brief.buildingFootprint.x))?Number(brief.buildingFootprint.x):0);
  const originY=relaxedCatalog?0:(finite(Number(brief.buildingFootprint.y))?Number(brief.buildingFootprint.y):0);
  const briefProjectArea=Math.max(.01,Number(brief.buildingFootprint.area)||W*D);
  const corridorArea=brief.rooms.filter(r=>/circula[cç][aã]o|corredor|hall/i.test(r.name)).reduce((sum,r)=>sum+r.largura*r.profundidade,0);
  if(!relaxedCatalog&&corridorArea/briefProjectArea>.005+0.0001)return null;
  const living=brief.rooms.find(r=>/sala/i.test(r.name));
  const kitchen=brief.rooms.find(r=>/cozinha/i.test(r.name));
  if(living&&kitchen){
    const socialRatio=(living.largura*living.profundidade)/(Math.max(.01,kitchen.largura*kitchen.profundidade));
    if(!relaxedCatalog&&(socialRatio<1.8||socialRatio>2.3))return null;
  }
  const bedrooms=brief.rooms.filter(r=>/quarto|su[ií]te/i.test(r.name));
  if(bedrooms.length>1){
    const front=bedrooms.slice().sort((a,b)=>(b.y+b.profundidade)-(a.y+a.profundidade))[0];
    const rest=bedrooms.filter(r=>r!==front);
    const average=rest.reduce((sum,r)=>sum+r.largura*r.profundidade,0)/Math.max(1,rest.length);
    if(!relaxedCatalog&&(front.largura*front.profundidade)/Math.max(.01,average)<1.1)return null;
  }
  const p=blank(name,W,D);
  p.rooms=brief.rooms.map(r=>{
    const type=r.tipo;
    const material=type==='serviço'?'Cerâmica':'Porcelanato';
    const color=type==='social'?'#c7a579':type==='privado'?'#c8d2e0':type==='serviço'?'#c7d8d4':'#d1bd91';
    return {...room(r.id,r.name,(r.x-originX)*sx,(r.y-originY)*sy,r.largura*sx,r.profundidade*sy,color,material),locked:true};
  });
  const edgeMap=new Map<string,Wall>();
  const isSiteZone=(r:Room)=>relaxedCatalog&&/recuo|jardim dos fundos/i.test(r.name);
  for(const r of p.rooms)if(!isSiteZone(r))for(const edge of rectEdges(r)){
    const key=edgeKey(edge[0],edge[1],edge[2],edge[3]);
    if(!edgeMap.has(key))edgeMap.set(key,wall(edge[0],edge[1],edge[2],edge[3],r.id));
  }
  p.walls=[...edgeMap.values()];
  const roomById=new Map(p.rooms.map(r=>[r.id,r]));
  const nearestWall=(x:number,y:number,preferred?:string,externalOnly=false)=>{
    let candidates=p.walls;
    if(preferred){const selected=roomById.get(preferred);if(selected)candidates=p.walls.filter(w=>rectEdges(selected).some(e=>edgeKey(e[0],e[1],e[2],e[3])===edgeKey(w.x1,w.y1,w.x2,w.y2)));}
    if(externalOnly){const external=candidates.filter(w=>p.rooms.filter(r=>!isSiteZone(r)&&rectEdges(r).some(e=>edgeKey(e[0],e[1],e[2],e[3])===edgeKey(w.x1,w.y1,w.x2,w.y2))).length<=1);if(external.length)candidates=external;}
    return candidates.slice().sort((a,b)=>{const distance=(w:Wall)=>{const dx=w.x2-w.x1,dy=w.y2-w.y1,l2=dx*dx+dy*dy||1,at=Math.max(0,Math.min(1,((x-w.x1)*dx+(y-w.y1)*dy)/l2));return Math.hypot(x-(w.x1+dx*at),y-(w.y1+dy*at))};return distance(a)-distance(b)})[0];
  };
  const addOpening=(opening:{id:string;posicao:{x:number;y:number};largura:number;ambiente?:string;nome?:string;altura?:number;peitoril?:number;orientacao?:string},kind:'door'|'window')=>{
    if(!opening||!finite(opening.posicao?.x)||!finite(opening.posicao?.y)||!finite(opening.largura))return;
    const sourceX=(opening.posicao.x-originX)*sx;
    const sourceY=(opening.posicao.y-originY)*sy;
    const target=nearestWall(sourceX,sourceY,opening.ambiente,kind==='window');if(!target)return;
    const dx=target.x2-target.x1,dy=target.y2-target.y1,length=Math.hypot(dx,dy);if(length<.3)return;
    const rawAt=((sourceX-target.x1)*dx+(sourceY-target.y1)*dy)/(length*length);
    const wallScale=Math.abs(dx)>=Math.abs(dy)?sx:sy;
    const width=Math.min(Math.max(.5,opening.largura*wallScale),Math.max(.5,length-.08));
    const at=Math.max(width/2/length,Math.min(1-width/2/length,rawAt));
    p.items.push({id:opening.id||id(),name:opening.nome||(kind==='door'?'Porta':'Janela'),kind,x:target.x1+dx*at,y:target.y1+dy*at,w:width,d:target.t,h:kind==='door'?2.1:(opening.altura||1.2),angle:0,color:kind==='door'?'#a97951':'#536e7b',wall:target.id,at,sill:kind==='window'?(opening.peitoril??1):0});
  };
  (brief.doors||[]).forEach(d=>addOpening(d,'door'));
  (brief.windows||[]).forEach(w=>addOpening(w,'window'));
  const errors=validateProject(p).filter(v=>v.level==='error');
  return errors.length?null:p;
}

export function generateAlternatives(input: string, base: Project, requirements?: AiRequirements): AiAlternative[] {
  const brief=parseRequirements(input);
  const r=ensureFunctionalRequirements(input, requirements?mergeRequirementsFromBrief(brief,requirements):brief);
  // A área calculada pela IA é usada como fallback quando o cliente não
  // informou uma área explicitamente. A geometria local continua validando o
  // resultado, mas deixa de ignorar o estudo de distribuição remoto.
  const plannedArea = r.area && r.area > 0 ? r.area : r.bodyCalculation?.builtArea && r.bodyCalculation.builtArea > 0 ? r.bodyCalculation.builtArea : undefined;
  const planFeatures = plannedArea ? { ...r, area: plannedArea } : r;
  const catalogGeometry=planFeatures.geometryBrief?.sourceCatalog==='google-sheet';
  const inferredW=plannedArea&&plannedArea>0?Math.max(8,Math.min(12,Math.sqrt(plannedArea*1.4))):(base.w||10);
  const W=Math.max(8,planFeatures.terrainW||inferredW);
  const inferredD=plannedArea&&plannedArea>0?Math.max(12,Math.min(24,Math.max(16,plannedArea/W+6))):(base.d||16);
  // O catálogo preserva a profundidade cotada do lote, mesmo quando ela é
  // menor que o mínimo usado nos estudos genéricos.
  const D=Math.max(catalogGeometry ? 0.5 : 12,planFeatures.terrainD||inferredD);
  // A quantidade descrita é a quantidade que será desenhada; não criamos
  // quartos extras apenas porque a proposta usa um modelo padrão. Cada
  // alternativa usa uma topologia própria (ordem dos setores e vizinhanças),
  // em vez de apenas espelhar a mesma planta.
  const catalogW=catalogGeometry&&!planFeatures.terrainW?planFeatures.geometryBrief?.lotDimensions?.width:undefined;
  const catalogD=catalogGeometry&&!planFeatures.terrainD?planFeatures.geometryBrief?.lotDimensions?.depth:undefined;
  const geometryProposal=planFeatures.geometryBrief
    ? geometryBriefToProject(
      planFeatures.geometryBrief,
      `${base.name} · Opção A`,
      catalogW||W,
      catalogD||D,
      {relaxedCatalog:catalogGeometry},
    )
    : null;
  const social=geometryProposal||buildIntelligentPlan(base,`${base.name} · Opção A`,W,D,'social',planFeatures);
  const privacy=buildIntelligentPlan(base,`${base.name} · Opção B`,W,D,'privacy',planFeatures);
  const land=buildIntelligentPlan(base,`${base.name} · Opção C`,W,D,'land',planFeatures);
  const metrics=(project:Project)=>`${area(project.rooms).toFixed(2)} m², ${project.rooms.length} ambientes, ${project.items.filter(i=>i.kind==='door').length} portas e ${project.items.filter(i=>i.kind==='window').length} janelas. Ambientes gerados: ${project.rooms.map(rm=>rm.name).join(', ')}.`;
  return [
    {id:'social',title:'Opção A · Integração social',description:`Setor social na entrada, com sala e cozinha lado a lado e quartos organizados depois da circulação. ${metrics(social)}.`,project:social,tradeoffs:['Entrada social mais direta','Sala e cozinha têm a maior área relativa','Circulação só aparece quando necessária']},
    {id:'privacy',title:'Opção B · Privacidade',description:`Quartos e serviços formam o primeiro setor; a sala e a cozinha ficam no extremo oposto, com acessos independentes. ${metrics(privacy)}.`,project:privacy,tradeoffs:['Quartos mais afastados da entrada social','Serviços agrupados para reduzir deslocamentos','Topologia diferente da Opção A']},
    {id:'land',title:'Opção C · Setores alternados',description:`Implantação alternada entre dormitórios, área social e serviços, aproveitando o lote sem copiar a ordem das outras opções. ${metrics(land)}.`,project:land,tradeoffs:['Vizinhanças internas diferentes','Maior flexibilidade para lote comprido','Comparar posição do quintal e acessos']},
  ];
}

export function commandProposal(command: string, p: Project): AiProposal | null {
  const text = command.toLocaleLowerCase('pt-BR');
  const rooms = p.rooms;
  const findRoom = (words: string[]) => rooms.find((r) => words.some((w) => r.name.toLocaleLowerCase('pt-BR').includes(w)));
  if (has(text, ['aumente', 'amplie', 'maior']) && has(text, ['suíte', 'suite', 'quarto'])) {
    const target = findRoom(['suíte', 'suite']) || findRoom(['quarto']);
    if (!target) return null;
    return { summary: `Vou aumentar ${target.name} de ${(target.w * target.d).toFixed(2)} m², ampliando 12% na direção disponível.`, detail: 'A proposta preserva as paredes externas do terreno e atualiza as paredes do ambiente no editor 2D e no modelo 3D.', affected: [target.name, 'Paredes do ambiente'], apply: (current) => { const next = { ...target, w: Math.min(target.w * 1.12, current.w - target.x - .5), d: Math.min(target.d * 1.12, current.d - target.y - .5) }; const old = current.walls.filter((w) => w.room === target.id); const walls = current.walls.filter((w) => w.room !== target.id); walls.push(...[wall(next.x, next.y, next.x + next.w, next.y, next.id), wall(next.x + next.w, next.y, next.x + next.w, next.y + next.d, next.id), wall(next.x + next.w, next.y + next.d, next.x, next.y + next.d, next.id), wall(next.x, next.y + next.d, next.x, next.y, next.id)].map((nw, i) => ({ ...nw, id: old[i]?.id || nw.id, t: old[i]?.t || .15, h: old[i]?.h || 2.8 }))); return { ...current, rooms: current.rooms.map((r) => r.id === target.id ? next : r), walls }; } };
  }
  if (has(text, ['crie', 'adicione', 'acrescente']) && has(text, ['área gourmet', 'area gourmet', 'churrasqueira'])) {
    if (findRoom(['gourmet'])) return null;
    return { summary: 'Vou criar uma Área gourmet nos fundos do terreno.', detail: 'O ambiente será editável, com piso e quatro paredes vinculados ao projeto.', affected: ['Área gourmet'], apply: (current) => addRoom(current, room(id(), 'Área gourmet', 1, Math.max(1, current.d - 4), Math.min(5, current.w - 2), 3, '#d6b084')) };
  }
  if (has(text, ['adicione', 'acrescente', 'crie']) && has(text, ['banheiro'])) {
    return { summary: 'Vou adicionar um banheiro social próximo à área íntima.', detail: 'A posição inicial é uma proposta e pode ser ajustada no editor.', affected: ['Banheiro social'], apply: (current) => addRoom(current, room(id(), 'Banheiro social', Math.max(1, current.w - 3.5), 5, 2.5, 2.2, '#c6d7d2')) };
  }
  if (has(text, ['integre', 'unifique']) && has(text, ['cozinha', 'sala'])) {
    const target = findRoom(['cozinha']);
    if (!target) return null;
    return { summary: `Vou renomear ${target.name} para Sala + Cozinha integrada e ampliar sua leitura como ambiente social.`, detail: 'A integração é semântica nesta primeira etapa; você continua podendo mover ou ajustar as paredes no editor.', affected: [target.name, 'Sala'], apply: (current) => ({ ...current, rooms: current.rooms.map((r) => r.id === target.id ? { ...r, name: 'Sala + Cozinha integrada', color: '#c7a579' } : r) }) };
  }
  if (has(text, ['retire', 'remova', 'apague']) && has(text, ['parede'])) {
    const target = p.walls[p.walls.length - 1];
    if (!target) return null;
    return { summary: 'Vou remover a última parede interna criada.', detail: 'A parede ficará disponível para desfazer pelo histórico do editor.', affected: ['Parede selecionada'], apply: (current) => ({ ...current, walls: current.walls.filter((w) => w.id !== target.id) }) };
  }
  return null;
}

export function validateProject(p: Project): AiValidation[] {
  const result: AiValidation[] = [];
  const disconnected = p.walls.filter((w) => Math.hypot(w.x2 - w.x1, w.y2 - w.y1) < .25).length;
  result.push(disconnected ? { level: 'error', title: 'Parede sem comprimento válido', detail: `${disconnected} parede(s) precisam ser revisadas.` } : { level: 'ok', title: 'Geometria das paredes', detail: `${p.walls.length} parede(s) com comprimento válido.` });
  const conflicts = p.items.filter((i) => i.wall && p.items.some((j) => j.id !== i.id && j.wall === i.wall && Math.abs((j.at || .5) - (i.at || .5)) < .08)).length;
  result.push(conflicts ? { level: 'error', title: 'Aberturas sobrepostas', detail: 'Há portas ou janelas muito próximas na mesma parede.' } : { level: 'ok', title: 'Conflitos de portas e janelas', detail: 'Nenhuma sobreposição evidente encontrada.' });
  const segmentMatches = (r: Room, w: Wall) => rectEdges(r).some(e => edgeKey(e[0], e[1], e[2], e[3]) === edgeKey(w.x1, w.y1, w.x2, w.y2));
  const wallRoomCount = (w: Wall) => p.rooms.filter(r => segmentMatches(r, w)).length;
  const invalidOpenings = p.items.filter(i => {
    if (!i.wall) return false;
    const w = p.walls.find(candidate => candidate.id === i.wall);
    if (!w) return true;
    const length = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
    return !Number.isFinite(i.at) || (i.at ?? .5) * length - i.w / 2 < -.05 || (i.at ?? .5) * length + i.w / 2 > length + .05;
  }).length;
  result.push(invalidOpenings ? { level: 'error', title: 'Abertura fora da parede', detail: `${invalidOpenings} porta(s) ou janela(s) não estão contidas na parede vinculada.` } : { level: 'ok', title: 'Portas e janelas vinculadas', detail: 'Todas as aberturas estão contidas em uma parede existente.' });
  const internalWindows = p.items.filter(i => {
    if (i.kind !== 'window' || !i.wall) return false;
    const target = p.walls.find(w => w.id === i.wall);
    return !!target && wallRoomCount(target) > 1;
  }).length;
  result.push(internalWindows ? { level: 'error', title: 'Janela em parede interna', detail: `${internalWindows} janela(s) precisam ser movidas para uma parede externa.` } : { level: 'ok', title: 'Janelas externas', detail: 'As janelas estão em paredes externas dos ambientes.' });
  const frontDoors = p.items.filter(i => i.kind === 'door' && /porta principal/i.test(i.name));
  const frontDoorWrong = frontDoors.some(i => { const w = p.walls.find(candidate => candidate.id === i.wall); return !!w && Math.min(Math.abs(w.y1 - p.d), Math.abs(w.y2 - p.d)) > .08; });
  result.push(frontDoorWrong ? { level: 'error', title: 'Entrada fora da frente', detail: 'A porta principal deve estar na parede frontal do terreno (y = D).' } : { level: 'ok', title: 'Entrada orientada para a frente', detail: frontDoors.length ? 'A porta principal está voltada para a frente do terreno.' : 'Nenhuma porta principal foi definida.' });
  const small = p.rooms.filter((r) => !/circula[cç][aã]o|corredor|hall/i.test(r.name) && (r.w < 2 || r.d < 2)).length;
  result.push(small ? { level: 'warn', title: 'Ambiente compacto', detail: `${small} ambiente(s) têm menos de 2 m em uma dimensão.` } : { level: 'ok', title: 'Dimensões dos ambientes', detail: 'Os ambientes têm dimensões iniciais compatíveis com o uso.' });
  const roomsWithoutDoor = p.rooms.filter((r) => !p.items.some((i) => i.kind === 'door' && i.x >= r.x - .2 && i.x <= r.x + r.w + .2 && i.y >= r.y - .2 && i.y <= r.y + r.d + .2)).length;
  result.push(roomsWithoutDoor ? { level: 'warn', title: 'Acesso a confirmar', detail: `${roomsWithoutDoor} ambiente(s) ainda não têm uma porta identificada.` } : { level: 'ok', title: 'Acesso aos ambientes', detail: 'Todos os ambientes têm uma abertura próxima.' });
  result.push({ level: 'warn', title: 'Revisão profissional', detail: 'A análise é uma checagem preliminar. Recuos, acessibilidade e aprovação dependem da legislação local e do profissional responsável.' });
  return result;
}

export type VisionResult = {
  estimatedArea?: number | null;
  confidence?: number | null;
  canvas?: { width?: number; height?: number };
  rooms?: Array<{ id?: string; name?: string; polygon?: Array<[number, number] | { x: number; y: number }>; area?: number | null }>;
  walls?: Array<{ id?: string; x1: number; y1: number; x2: number; y2: number; thickness?: number; roomIds?: string[] }>;
  openings?: Array<{ id?: string; kind: 'door' | 'window'; wallId?: string; position?: number; x?: number; y?: number; width?: number; height?: number; sill?: number }>;
  doors?: number | null;
  windows?: number | null;
  warnings?: string[];
};

function pointValue(value: [number, number] | { x: number; y: number }) { return Array.isArray(value) ? { x: value[0], y: value[1] } : value; }
function visionCoord(value: number, extent: number | undefined, size: number) { return value <= 1.05 ? value * size : extent ? (value / extent) * size : value; }
function colorForRoom(name: string) {
  const value=name.toLocaleLowerCase('pt-BR');
  if(value.includes('cozinha'))return '#b8c9b8'; if(value.includes('quarto')||value.includes('suíte')||value.includes('suite'))return '#c8d2e0';
  if(value.includes('banheiro')||value.includes('bwc'))return '#c7d8d4'; if(value.includes('sala'))return '#c7a579'; if(value.includes('circula'))return '#d9d1b8'; return '#c8d7c8';
}

export function visionToProject(result: VisionResult, base: Project) {
  const W=base.w||10,D=base.d||16;
  const canvasW=result.canvas?.width, canvasH=result.canvas?.height;
  const p=blank(`${base.name} · Planta vetorizada`,W,D);
  const rooms=result.rooms||[];
  const roomIds=new Map<string,string>();
  p.rooms=rooms.map((raw,index)=>{
    const name=raw.name?.trim()||`Ambiente ${index+1}`;
    const poly=(raw.polygon||[]).map(pointValue);
    const xs=poly.map(q=>visionCoord(q.x,canvasW,W)), ys=poly.map(q=>visionCoord(q.y,canvasH,D));
    const x=Math.max(0,Math.min(W-.5,xs.length?Math.min(...xs):0)), y=Math.max(0,Math.min(D-.5,ys.length?Math.min(...ys):0));
    const w=Math.max(1.2,Math.min(W-x,xs.length?Math.max(...xs)-Math.min(...xs):2));
    const d=Math.max(1.2,Math.min(D-y,ys.length?Math.max(...ys)-Math.min(...ys):2));
    const roomId=raw.id||id(); roomIds.set(roomId,roomId);
    return room(roomId,name,x,y,w,d,colorForRoom(name),name.toLocaleLowerCase('pt-BR').includes('ban')?'Cerâmica':'Porcelanato');
  });
  const seen=new Map<string,Wall>();
  const addWall=(x1:number,y1:number,x2:number,y2:number,roomId?:string,thickness=.15,sourceId?:string)=>{if(Math.hypot(x2-x1,y2-y1)<.08)return;const key=edgeKey(x1,y1,x2,y2);if(!seen.has(key)){const created=wall(x1,y1,x2,y2,roomId);seen.set(key,{...created,id:sourceId||created.id,t:Math.max(.08,Math.min(.5,thickness))});}};
  if(result.walls?.length){for(const raw of result.walls)addWall(visionCoord(raw.x1,canvasW,W),visionCoord(raw.y1,canvasH,D),visionCoord(raw.x2,canvasW,W),visionCoord(raw.y2,canvasH,D),raw.roomIds?.[0],raw.thickness,raw.id);}
  else for(const r of p.rooms)for(const [x1,y1,x2,y2] of rectEdges(r))addWall(x1,y1,x2,y2,r.id);
  p.walls=[...seen.values()];
  const nearestWall=(x:number,y:number)=>{let best: { w:Wall; distance:number; at:number }|null=null;for(const w of p.walls){const dx=w.x2-w.x1,dy=w.y2-w.y1,L=dx*dx+dy*dy;if(L<.001)continue;const at=Math.max(0,Math.min(1,((x-w.x1)*dx+(y-w.y1)*dy)/L));const distance=Math.hypot(x-(w.x1+dx*at),y-(w.y1+dy*at));if(!best||distance<best.distance)best={w,distance,at};}return best;};
  for(const raw of result.openings||[]){
    let target=raw.wallId?p.walls.find(w=>w.id===raw.wallId):undefined;
    const px=raw.x===undefined?undefined:visionCoord(raw.x,canvasW,W), py=raw.y===undefined?undefined:visionCoord(raw.y,canvasH,D);
    const nearest=px===undefined||py===undefined?null:nearestWall(px,py); if(!target)target=nearest?.w;
    if(!target)continue;
    const dx=target.x2-target.x1,dy=target.y2-target.y1,L=Math.hypot(dx,dy);const at=Math.max(.04,Math.min(.96,raw.position??nearest?.at??.5));
    const width=raw.width&&raw.width<=1.05?raw.width*Math.min(W,D):Math.max(.55,raw.width||.8);const kind=raw.kind==='window'?'window':'door';
    p.items.push({id:raw.id||id(),name:kind==='door'?'Porta identificada':'Janela identificada',kind,x:target.x1+dx*at,y:target.y1+dy*at,w:Math.min(width,L-.1),d:target.t,h:raw.height|| (kind==='door'?2.1:1.2),angle:0,color:kind==='door'?'#a97951':'#536e7b',wall:target.id,at,sill:kind==='window'?(raw.sill??1):0});
  }
  return {project:p,estimatedArea:result.estimatedArea??area(p.rooms),rooms:p.rooms.length,doors:p.items.filter(i=>i.kind==='door').length,windows:p.items.filter(i=>i.kind==='window').length,confidence:result.confidence??0,warnings:result.warnings||[]};
}

export function analyzePlanFile(file: File, base: Project) {
  const isPdf=file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf');
  const isImage=file.type.startsWith('image/');
  return {fileName:file.name,isPdf,isImage,confidence:0,estimatedArea:0,rooms:0,doors:0,windows:0,editable:null,requiresVision:true,warnings:[isPdf?'PDF recebido. A conversão fiel depende da leitura visual da página e da escala.':'Imagem recebida. Nenhuma geometria será inventada sem análise visual real.', 'O Gemini 3.6 Flash fará a análise multimodal de paredes, ambientes, portas e janelas.']};
}
