import { NextRequest } from 'next/server';

type Project = {
  w?: number;
  d?: number;
  rooms?: Array<{ name?: string; x?: number; y?: number; w?: number; d?: number }>;
  walls?: Array<{ x1?: number; y1?: number; x2?: number; y2?: number; h?: number; t?: number }>;
  items?: Array<{ name?: string; kind?: string; w?: number; h?: number; d?: number }>;
};

type MaterialLine = { category: string; item: string; quantity: number; unit: string; note: string };

const finite = (v: unknown, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const round = (v: number, digits = 2) => Number(v.toFixed(digits));

function localEstimate(project: Project) {
  const rooms = Array.isArray(project.rooms) ? project.rooms : [];
  const walls = Array.isArray(project.walls) ? project.walls : [];
  const items = Array.isArray(project.items) ? project.items : [];
  const floorArea = rooms.reduce((sum, r) => sum + Math.max(0, finite(r.w) * finite(r.d)), 0);
  const perimeter = walls.reduce((sum, w) => sum + Math.hypot(finite(w.x2) - finite(w.x1), finite(w.y2) - finite(w.y1)), 0);
  const height = walls.length ? walls.reduce((sum, w) => sum + finite(w.h, 2.8), 0) / walls.length : 2.8;
  const wallArea = perimeter * height;
  const doors = items.filter(i => i.kind === 'door').length;
  const windows = items.filter(i => i.kind === 'window').length;
  const roomsWithNames = rooms.map(r => r.name).filter(Boolean).join(', ');
  const lines: MaterialLine[] = [
    { category: 'Estrutura', item: 'Concreto para contrapiso (8 cm)', quantity: round(floorArea * .08), unit: 'm³', note: 'Estimativa sobre a área dos pisos; conferir fundação e projeto estrutural.' },
    { category: 'Paredes', item: 'Área de alvenaria', quantity: round(wallArea * .9), unit: 'm²', note: 'Desconto aproximado de 10% para portas e janelas.' },
    { category: 'Paredes', item: 'Bloco/tijolo cerâmico', quantity: round(wallArea * .9 * 16 * 1.1), unit: 'un', note: 'Referência de 16 unidades/m² + 10% de perdas; confirmar o modelo.' },
    { category: 'Paredes', item: 'Argamassa de assentamento', quantity: round(wallArea * .9 * .018), unit: 'm³', note: 'Traço e espessura devem ser definidos pelo responsável técnico.' },
    { category: 'Revestimentos', item: 'Chapisco, emboço e reboco', quantity: round(wallArea * 1.8 * 1.1), unit: 'm²', note: 'Duas faces e 10% de perdas.' },
    { category: 'Pisos', item: 'Piso/revestimento', quantity: round(floorArea * 1.1), unit: 'm²', note: 'Área dos ambientes + 10% de recorte e perdas.' },
    { category: 'Pisos', item: 'Rodapé', quantity: round(rooms.reduce((sum, r) => sum + 2 * (finite(r.w) + finite(r.d)), 0) * 1.1), unit: 'm', note: 'Estimativa por perímetro dos ambientes.' },
    { category: 'Acabamentos', item: 'Tinta para paredes e tetos', quantity: round((wallArea * 1.8 + floorArea) / 10 * 2), unit: 'L', note: 'Duas demãos, rendimento de referência de 10 m²/L.' },
    { category: 'Esquadrias', item: 'Portas', quantity: doors, unit: 'un', note: 'Portas existentes no projeto atual.' },
    { category: 'Esquadrias', item: 'Janelas', quantity: windows, unit: 'un', note: 'Janelas existentes no projeto atual.' },
  ].filter(line => line.quantity > 0);
  return {
    project: { width: finite(project.w), depth: finite(project.d), floorArea: round(floorArea), wallArea: round(wallArea), perimeter: round(perimeter), height: round(height), rooms: rooms.length, doors, windows },
    rooms: rooms.map(r => ({ name: r.name || 'Ambiente', area: round(finite(r.w) * finite(r.d)) })),
    materials: lines,
    assumptions: ['Quantidades preliminares calculadas a partir da geometria atual.', 'Não substitui projeto estrutural, memorial, orçamento ou conferência do profissional responsável.', roomsWithNames ? `Ambientes considerados: ${roomsWithNames}.` : 'Nenhum ambiente foi desenhado ainda.'],
  };
}

function extractJson(text: string) {
  const candidate = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1] || text.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) return null;
  try { return JSON.parse(candidate); } catch { return null; }
}

export async function POST(request: NextRequest) {
  let payload: { project?: Project };
  try { payload = await request.json(); } catch { return Response.json({ error: 'JSON inválido' }, { status: 400 }); }
  const estimate = localEstimate(payload.project || {});
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return Response.json({ ...estimate, provider: 'cálculo local sem cota', model: 'engine-materiais' });

  const model = process.env.OPENROUTER_MATERIALS_MODEL || 'openrouter/free';
  const prompt = `Você é um orçamentista de obras. Use SOMENTE os dados geométricos e a estimativa fornecida. Não invente ambientes, dimensões ou quantidades. Retorne JSON válido no formato {"materials":[{"category":string,"item":string,"quantity":number,"unit":string,"note":string}],"assumptions":string[]}. Você pode corrigir arredondamentos e separar materiais por etapa, mas deve preservar portas, janelas, áreas, perímetro e ambientes informados. Indique que são quantidades preliminares. Dados: ${JSON.stringify(estimate)}`;
  try {
    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://digimax-projeto-3d.digimax-ro.chatgpt.site', 'X-Title': 'Digimax Projeto 3D' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: .1, response_format: { type: 'json_object' } }),
    });
    const data = await upstream.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } };
    const parsed = extractJson(data.choices?.[0]?.message?.content || '');
    if (!upstream.ok || !parsed || !Array.isArray(parsed.materials)) return Response.json({ ...estimate, provider: 'cálculo local sem cota', model: 'engine-materiais', warning: data.error?.message || 'OpenRouter indisponível; cálculo local mantido.' });
    return Response.json({ ...estimate, materials: parsed.materials, assumptions: parsed.assumptions || estimate.assumptions, provider: 'OpenRouter modelo gratuito', model });
  } catch { return Response.json({ ...estimate, provider: 'cálculo local sem cota', model: 'engine-materiais', warning: 'IA externa indisponível; cálculo local mantido.' }); }
}
