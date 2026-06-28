import { GoogleGenerativeAI } from '@google/generative-ai';
import { save_price_items_batch } from '../../db_utils';
import { createAuthErrorResponse, requireAuthenticatedSession } from '../../auth_utils';
import { isUuidLike } from '../../safe_utils';

function stripCodeFence(text: string) {
  let cleanText = text.trim();
  if (cleanText.includes('```json')) {
    cleanText = cleanText.split('```json')[1].split('```')[0].trim();
  } else if (cleanText.includes('```')) {
    cleanText = cleanText.split('```')[1].split('```')[0].trim();
  }
  return cleanText;
}

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'Ключ отсутствует' }, { status: 500 });
  }

  try {
    if (!requireAuthenticatedSession(req.headers.get('cookie'))) {
      return createAuthErrorResponse();
    }

    const body = await req.json();
    const text = typeof body?.text === 'string' ? body.text : '';
    const doc_id = body?.doc_id;
    const partner_id = body?.partner_id;

    if (!text.trim()) {
      return Response.json({ error: 'Поле text обязательно' }, { status: 400 });
    }

    if (!isUuidLike(doc_id) || !isUuidLike(partner_id)) {
      return Response.json({ error: 'doc_id и partner_id должны быть UUID' }, { status: 400 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const result = await model.generateContent(
      `Обработай этот текст медицинского прайса и верни JSON с массивом items, где каждый элемент содержит service_name_raw и price_original: ${text}`
    );

    const aiAnswer = result.response.text();
    const parsedData = JSON.parse(stripCodeFence(aiAnswer));
    const items = Array.isArray(parsedData) ? parsedData : parsedData.items || [];

    await save_price_items_batch(doc_id, partner_id, new Date(), items);

    return Response.json({
      success: true,
      items,
    });
  } catch (error: unknown) {
    console.error('Error in normalize endpoint:', error);
    const message = error instanceof Error ? error.message : 'Ошибка обработки';
    return Response.json({ error: message }, { status: 500 });
  }
}

