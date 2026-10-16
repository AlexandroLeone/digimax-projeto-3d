import { NextRequest } from 'next/server';
import { searchReferenceProjects } from '@/lib/reference';
import type { ReferenceSearch } from '@/lib/reference';

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const API_BASE = process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';

type Payload = {
  mode?: 'describe' | 'analyze' | 'command';
  text?: string;
  command?: string;
  project?: unknown;
  plannerInput?: unknown;
  fileData?: string;
  fileName?: string;
  mimeType?: string;
  referenceSearch?: ReferenceSearch;
};

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = (fenced || text).match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) return null;
  try { return JSON.parse(candidate); } catch { return null; }
}

function systemPrompt(mode: Payload['mode']) {
  if (mode === 'analyze') return `Você é o Vision Analyzer e Geometry Engine do Digimax Projeto 3D. Analise a imagem/PDF como uma planta baixa técnica, preservando a orientação visual original. Não crie uma planta genérica e não use o tamanho do arquivo para inferir cômodos.

Retorne SOMENTE JSON válido neste formato:
{"estimatedArea":number|null,"confidence":number,"canvas":{"width":number,"height":number},"orientation":{"front":"top"|"bottom"|"left"|"right"|"unknown","notes":string},"rooms":[{"id":string,"name":string,"polygon":[[number,number]],"area":number|null}],"walls":[{"id":string,"x1":number,"y1":number,"x2":number,"y2":number,"thickness":number|null,"roomIds":[string],"edge":"front"|"back"|"side"|"shared"}],"openings":[{"id":string,"kind":"door"|"window","wallId":string,"position":number,"width":number|null,"height":number|null,"sill":number|null,"roomId":string,"connectsTo":string|null}],"warnings":string[]}

Regras de visão:
- use coordenadas da imagem em pixels no canvas;
- cada parede deve aparecer uma única vez;
- paredes compartilhadas devem ser a mesma linha, sem duplicação;
- toda porta/janela deve referenciar wallId e position entre 0 e 1;
- uma porta interna deve estar numa parede compartilhada por dois ambientes;
- uma janela só pode estar em parede externa do ambiente;
- não coloque janela sobre piso, teto ou texto;
- não projete abertura fora dos limites da parede;
- preserve frente, fundos, esquerda e direita, sem espelhar a casa;
- identifique nomes, cotas legíveis, portas, janelas, corredores, escadas e mobiliário quando visíveis;
- não invente medidas ilegíveis: use null e explique em warnings;
- se houver dúvida entre duas paredes, informe-a em warnings e reduza confidence;
- se a imagem não permitir traçar com segurança, retorne confidence baixa e peça confirmação.

Antes de finalizar, valide se a quantidade de portas e janelas, a posição relativa dos ambientes e o sentido de abertura coincidem com a imagem. `;
  if (mode === 'command') return 'Você é o Command Interpreter do Digimax Projeto 3D. Considere o projeto JSON enviado e o pedido do usuário. Retorne SOMENTE JSON válido: {"proposal":{"summary":string,"detail":string,"affected":string[],"needsConfirmation":true}}. Se o pedido for ambíguo, escreva a pergunta em summary e affected vazio. Nunca afirme aprovação legal.';
  return `Você é o AI Planner do Digimax Projeto 3D. Faça primeiro um estudo arquitetônico funcional e geométrico e só depois entregue os requisitos para o Geometry Engine. A descrição do cliente é a fonte de verdade: não transforme o pedido em um modelo residencial genérico e não invente ambientes sem justificativa funcional.

REFERÊNCIAS DO CATÁLOGO GOOGLE SHEETS:
- O contexto pode conter uma busca em uma planilha de projetos reais. Quando houver referências em referenceSearch.qualified, elas já atingiram a compatibilidade mínima de 90% e devem ser usadas como base principal.
- A compatibilidade foi calculada somente por área total, quantidade de quartos, quantidade de suítes e presença de sala e cozinha. As medidas individuais dos cômodos, banheiros, garagem, corredor, lavanderia e demais ambientes não devem eliminar uma referência; adapte esses itens à descrição do cliente.
- Quando a referência trouxer idProjeto, sourceImage, lotDimensions, setbacks ou siteZones, trate o geometryBrief como uma leitura vetorial corrigida da imagem. Preserve a orientação, os recuos, o jardim, o corredor e as conexões de portas/janelas antes de fazer qualquer adequação à descrição.
- Não invente uma referência, não misture silenciosamente plantas incompatíveis e não use closest quando qualified estiver vazio. Se não houver referência acima de 90%, informe isso em explanation e use apenas o preCalculation local para uma proposta nova.
- Ao adaptar uma referência, devolva geometryBrief completo, com coordenadas em metros, sem null dentro de geometryBrief, portas nas paredes e janelas nas paredes externas.

Responda SOMENTE com JSON válido, sem Markdown, comentários ou texto fora do objeto, exatamente nesta estrutura:
{"status":"ready"|"needs_clarification"|"incompatible","requirements":{"terrainW":number|null,"terrainD":number|null,"area":number|null,"bedrooms":number,"suites":number,"bathrooms":number,"socialBathroom":boolean,"garage":number,"integratedSocial":boolean,"laundry":boolean,"gourmet":boolean,"edicula":boolean,"poolFuture":boolean,"office":boolean,"closet":boolean,"requestedRooms":string[],"inferredRooms":string[],"excludedRooms":string[]},"bodyCalculation":{"usefulArea":number|null,"circulationArea":number|null,"wallArea":number|null,"builtArea":number|null,"footprintWidth":number|null,"footprintDepth":number|null,"footprintArea":number|null,"frontSetback":number|null,"rearSetback":number|null,"sideSetbacks":number|null,"remainingOutdoorArea":number|null},"areaDistribution":[{"name":string,"role":"social"|"private"|"service"|"external","area":number,"width":number,"length":number,"reason":string}],"functionalChecks":{"bathroomRequired":boolean,"bathroomIncluded":boolean,"mainEntranceAtFront":boolean,"allRoomsAccessible":boolean,"corridorNecessary":boolean,"ventilationPlanned":boolean,"proportionsValid":boolean,"conflicts":string[]},"layoutRules":{"front":"y=D","back":"y=0","needsCorridor":boolean,"connections":[{"from":string,"to":string,"type":"door"|"open"|"external"}],"frontDoorRoom":string,"corridorAreaRatio":number,"corridorAreaTarget":number,"bathroomSetback":number|null,"notes":string[]},"geometryBrief":{"coordinateSystem":"origem no canto superior esquerdo; frente y=D; unidades em metros","buildingFootprint":{"x":number,"y":number,"width":number,"depth":number,"area":number},"rooms":[{"id":string,"name":string,"tipo":"social"|"privado"|"serviço"|"externo"|"circulação","x":number,"y":number,"largura":number,"profundidade":number,"area":number,"paredesCompartilhadasCom":string[]}],"doors":[{"id":string,"nome":string,"posicao":{"x":number,"y":number},"largura":number,"parede":"frontal"|"posterior"|"lateral_esquerda"|"lateral_direita"|"compartilhada","sentidoAbertura":"para_dentro_direita"|"para_dentro_esquerda"|"correr"|"dupla","ambiente":string,"conectaCom":string|null}],"windows":[{"id":string,"ambiente":string,"posicao":{"x":number,"y":number},"largura":number,"altura":number,"peitoril":number,"orientacao":"frontal"|"posterior"|"lateral_esquerda"|"lateral_direita"}],"validation":string[]},"clarifications":string[],"explanation":string}

REGRAS OBRIGATÓRIAS:

1. Leia a descrição, o terreno, os recuos, a área, o número de pavimentos e as preferências estruturadas enviadas no contexto. Preserve literalmente quantidades e exclusões. “2 quartos e uma suíte” significa 3 dormitórios. Se o cliente disser “sem banheiro”, não crie banheiro.

2. Faça o programa de necessidades antes da geometria. Liste ambientes solicitados, inferidos e excluídos. Não invente lavanderia, corredor, closet, escritório, garagem, edícula, piscina ou outro cômodo sem que o texto peça ou sem uma justificativa funcional explícita.

3. Em uma residência com quartos, sala ou cozinha, se o cliente não disser “sem banheiro”, inclua pelo menos um banheiro social. Se houver suíte, inclua banheiro privativo para cada suíte, salvo exclusão explícita. Nunca gere uma residência habitável sem acesso sanitário.

4. Calcule a distribuição de áreas. Some as áreas úteis dos ambientes. Calcule circulação apenas quando necessária. Estime paredes entre 8% e 12% da área útil. Calcule a área construída como ambientes + circulação + paredes. Quando o cliente informar uma área alvo, mantenha tolerância máxima de 5%; se não couber no terreno, retorne incompatible ou faça uma pergunta objetiva, sem comprimir banheiro, quarto ou circulação a dimensões impossíveis. A área da sala de estar/jantar deve ficar aproximadamente em 2,0× a área da cozinha (aceite variação de 10% somente quando o lote impedir).

5. Use proporções plausíveis: sala/cozinha integradas maiores que quartos quando solicitadas; suítes ligeiramente maiores que quartos; o quarto mais próximo da frente deve ficar aproximadamente 20% maior que a média dos demais dormitórios; banheiro geralmente entre 3 e 6 m²; circulação entre 1,00 e 1,20 m quando necessária; garagem aproximadamente 2,45 m x 5,00 m por carro; cozinha com largura suficiente para bancada e circulação. Essas referências são estimativas iniciais e devem ser validadas pela legislação local.

6. Calcule o corpo da casa dentro do lote: largura, profundidade, projeção, recuos e área externa restante. O contexto contém um objeto preCalculation calculado localmente antes desta chamada. Use-o como base numérica e corrija apenas o que estiver incompatível com os requisitos. Use coordenadas em metros, origem no canto superior esquerdo, frente padrão no lado inferior y=D e fundos no lado superior y=0. Nunca rotacione ou espelhe a planta sem registrar isso em notes. Se o cliente informar outra orientação, use-a explicitamente.

7. A entrada principal deve ficar na parede externa frontal y=D e levar para sala, hall ou circulação social. Nunca coloque a porta principal em cozinha, banheiro ou quarto. Toda porta interna deve estar em uma parede compartilhada por dois ambientes. Toda janela deve estar em parede externa do ambiente, nunca em parede interna, no piso, no teto ou flutuando fora da parede. Cada abertura deve informar sua parede, ambiente e conexão.

8. Todo ambiente deve ter acesso. Banheiro social não deve abrir diretamente para cozinha ou área de jantar quando houver uma circulação alternativa. Cozinha e lavanderia devem ficar próximas quando ambas forem solicitadas. Área gourmet e edícula devem ficar voltadas para fundos/área externa. Quartos devem ficar em zona mais reservada. Não crie porta direta da cozinha para quarto salvo pedido explícito.

9. Use o menor corredor possível. Quando existir, a área do ambiente de circulação deve ser no máximo 0,5% (0,005) da área total de referência enviada no preCalculation. Se 0,5% não comportar uma passagem física mínima de 0,85 × 0,85 m, não invente uma faixa estreita: elimine o corredor separado e conecte os ambientes diretamente por portas em paredes compartilhadas. Para menos de cinco ambientes físicos, não crie corredor separado salvo solicitação ou necessidade de acesso. Para cinco ou mais, crie somente se resolver um conflito real. Corredor não é ambiente residencial adicional.

10. Verifique sobreposições, paredes desconectadas, portas sem parede, portas conflitantes, janelas internas, quartos sem janela, banheiros sem porta, ambientes sem acesso, área incompatível, corpo fora do terreno e orientação invertida. Sem corredor separado, mantenha os banheiros recuados 0,85 m do acesso/frente, sem bloquear sua porta ou ventilação. Se qualquer conflito existir, liste-o em functionalChecks.conflicts e não marque proportionsValid como true.

11. Gere relações de vizinhança e uma geometria retangular inicial coerente. Ambientes vizinhos devem compartilhar a mesma linha de parede. O campo geometryBrief é obrigatório e deve ser uma representação vetorial clara, não um resumo textual: buildingFootprint informa o corpo da casa; cada room informa x, y, largura, profundidade, área e IDs das paredes compartilhadas; cada door informa a posição exata em metros, a parede, a largura, o sentido e os ambientes conectados; cada window informa posição, largura, altura, peitoril e orientação. Compare cada coordenada com preCalculation.geometryBrief. Preserve as coordenadas locais se elas já forem válidas; se precisar alterar, devolva a geometria completa corrigida e explique a mudança em validation. Todos os IDs devem ser estáveis dentro da resposta, nenhuma sala pode ultrapassar buildingFootprint, salas não podem se sobrepor, portas devem estar exatamente em paredes (compartilhadas ou externas) e janelas somente em paredes externas. As propostas A, B e C serão montadas pelo Geometry Engine; não altere a lista de ambientes entre propostas. A deve priorizar integração social, B privacidade e C aproveitamento do lote, com ordem de vizinhança diferente.

12. Se faltarem dados críticos, retorne needs_clarification com no máximo três perguntas em clarifications. Se houver dados suficientes, retorne ready e registre suposições. Nunca esconda uma incompatibilidade.

13. Não retorne geometryBrief vazio, genérico ou em outro formato. Mesmo quando a descrição for curta, use a distribuição pré-calculada enviada no contexto e entregue os quatro blocos buildingFootprint, rooms, doors e windows. Números devem ser finitos, positivos quando representarem dimensões, arredondados a duas casas e sempre em metros. A área de cada room deve ser largura × profundidade; a área do corpo deve ser width × depth; paredes compartilhadas devem ser bidirecionais. A resposta será validada e usada diretamente pelo editor 2D/3D.

O Geometry Engine é responsável por desenhar a planta 2D, portas, janelas e modelo 3D a partir deste JSON. Portanto, forneça números, conexões e validações, não uma imagem ou texto genérico.`;
}

function filePart(fileData: string, mimeType?: string) {
  const match = fileData.match(/^data:([^;,]+)?;base64,([\s\S]+)$/);
  if (match) return { inlineData: { mimeType: match[1] || mimeType || 'application/octet-stream', data: match[2] } };
  return { inlineData: { mimeType: mimeType || 'application/octet-stream', data: fileData } };
}

export async function POST(request: NextRequest) {
  const key = process.env.GEMINI_API_KEY;
  let payload: Payload;
  try { payload = await request.json(); } catch { return Response.json({ error: 'JSON inválido' }, { status: 400 }); }
  const mode = payload.mode || 'describe';
  let referenceSearch: ReferenceSearch | undefined = payload.referenceSearch;
  if (mode === 'describe' && !referenceSearch) {
    referenceSearch = await searchReferenceProjects((payload.plannerInput as any)?.localRequirements || payload.plannerInput || {});
  }
  const referenceCandidate = mode === 'describe' ? referenceSearch?.qualified?.[0] : undefined;
  const rawFallbackGeometry = referenceCandidate?.geometryBrief;
  const fallbackGeometry = rawFallbackGeometry && typeof rawFallbackGeometry === 'object' && !Array.isArray(rawFallbackGeometry)
    ? {
        ...(rawFallbackGeometry as Record<string, unknown>),
        sourceCatalog: 'google-sheet' as const,
        sourceProjectId: referenceCandidate?.projectId,
        sourceImage: referenceCandidate?.sourceImage,
      }
    : undefined;
  if (!key) return Response.json({ error: 'GEMINI_API_KEY não configurada no servidor', provider: 'gemini', status: 'ai-unavailable', referenceSearch, geometryBrief: fallbackGeometry, proposalOrigin: referenceSearch?.qualified?.length ? 'google_sheet_and_local' : 'gemini_only', explanation: referenceSearch?.qualified?.length ? '[ORIGEM: PLANILHA GOOGLE + GEOMETRYBRIEF DA PLANILHA] O Gemini não está disponível; a proposta usa a geometria compatível encontrada no catálogo.' : '[ORIGEM: SOMENTE IA] O Gemini e a busca de referência não ficaram disponíveis nesta geração.' }, { status: 503 });

  const userText = mode === 'command' ? (payload.command || '') : (payload.text || 'Use os dados enviados.');
  const context = [
    payload.project ? `\nContexto geométrico do projeto atual (JSON): ${JSON.stringify(payload.project).slice(0, 50000)}` : '',
    payload.plannerInput ? `\nDados estruturados do estudo (JSON): ${JSON.stringify(payload.plannerInput).slice(0, 50000)}` : '',
  ].join('');
  const referenceContext = referenceSearch ? `\nBusca de referências na planilha Google (JSON): ${JSON.stringify(referenceSearch).slice(0, 70000)}` : '';
  const parts: Array<Record<string, unknown>> = [{ text: `${userText}${context}${referenceContext}` }];
  if (payload.fileData && mode === 'analyze') parts.push(filePart(payload.fileData, payload.mimeType || (payload.fileName?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : undefined)));

  try {
    const upstream = await fetch(`${API_BASE}/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt(mode) }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
      }),
    });
    const data = await upstream.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { message?: string; status?: string } };
    if (!upstream.ok) return Response.json({ error: data.error?.message || 'Gemini indisponível no momento', provider: 'gemini', status: 'ai-unavailable', upstreamStatus: data.error?.status, referenceSearch, geometryBrief: fallbackGeometry, proposalOrigin: referenceSearch?.qualified?.length ? 'google_sheet_and_local' : 'gemini_only', explanation: referenceSearch?.qualified?.length ? '[ORIGEM: PLANILHA GOOGLE + GEOMETRYBRIEF DA PLANILHA] O Gemini não respondeu; a proposta usará a geometria compatível do catálogo como fallback.' : '[ORIGEM: SOMENTE IA] Nenhuma referência compatível foi usada porque o Gemini não respondeu.' }, { status: upstream.status });
    const outputText = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
    const parsed = extractJson(outputText);
    if (!parsed) return Response.json({ error: 'O Gemini não retornou JSON estruturado', provider: 'gemini', status: 'ai-unavailable', referenceSearch, geometryBrief: fallbackGeometry, proposalOrigin: referenceSearch?.qualified?.length ? 'google_sheet_and_local' : 'gemini_only', explanation: referenceSearch?.qualified?.length ? '[ORIGEM: PLANILHA GOOGLE + GEOMETRYBRIEF DA PLANILHA] A resposta do Gemini não pôde ser estruturada; a geometria compatível será usada como fallback.' : '[ORIGEM: SOMENTE IA] O Gemini não retornou uma proposta estruturada.' }, { status: 502 });
    if (referenceSearch) {
      const referenceNote = referenceSearch.qualified.length
        ? ` [ORIGEM: PLANILHA GOOGLE + GEMINI] Foram encontradas ${referenceSearch.qualified.length} referência(s) na planilha com compatibilidade mínima de ${referenceSearch.minimumCompatibility}%. Critérios usados: área total, quantidade de quartos, quantidade de suítes e presença de sala/cozinha. O Gemini recebeu essas geometrias para adaptar a proposta.`
        : referenceSearch.configured
          ? ` [ORIGEM: SOMENTE IA] Nenhuma referência da planilha atingiu ${referenceSearch.minimumCompatibility}% usando área total, quartos, suítes e sala/cozinha; a proposta foi calculada sem forçar um modelo incompatível.`
          : ' [ORIGEM: SOMENTE IA] A busca na planilha não ficou disponível nesta geração; a proposta foi calculada pelo estudo geométrico local.';
      if (typeof (parsed as any).explanation === 'string') (parsed as any).explanation += referenceNote;
      else (parsed as any).explanation = referenceNote.trim();
    }
    if (!(parsed as any).geometryBrief && fallbackGeometry) (parsed as any).geometryBrief = fallbackGeometry;
    return Response.json({ ...parsed, provider: 'gemini', model: MODEL, referenceSearch, proposalOrigin: referenceSearch?.qualified?.length ? 'google_sheet_and_gemini' : 'gemini_only' });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Falha de conexão com o Gemini', provider: 'gemini', status: 'ai-unavailable', referenceSearch, geometryBrief: fallbackGeometry, proposalOrigin: referenceSearch?.qualified?.length ? 'google_sheet_and_local' : 'gemini_only', explanation: referenceSearch?.qualified?.length ? '[ORIGEM: PLANILHA GOOGLE + GEOMETRYBRIEF DA PLANILHA] O Gemini falhou; a geometria compatível será usada como fallback.' : '[ORIGEM: SOMENTE IA] O Gemini falhou e não houve referência compatível.' }, { status: 502 });
  }
}
