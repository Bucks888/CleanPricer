import { GoogleGenerativeAI } from "@google/generative-ai";
import { save_price_items_batch } from "../../db_utils";

export async function POST(req: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "Ключ отсутствует" }, { status: 500 });
  }

  try {
    const { text, doc_id, partner_id } = await req.json();
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    // AI parses raw text
    const result = await model.generateContent(
      `Обработай этот текст медицинского прайса и верни JSON с массивом items, где каждый элемент содержит service_name_raw и price_original: ${text}`
    );
    const aiAnswer = result.response.text();
    
    let cleanText = aiAnswer.trim();
    if (cleanText.includes("```json")) {
      cleanText = cleanText.split("```json")[1].split("```")[0].trim();
    } else if (cleanText.includes("```")) {
      cleanText = cleanText.split("```")[1].split("```")[0].trim();
    }
    
    const parsedData = JSON.parse(cleanText);
    const items = Array.isArray(parsedData) ? parsedData : (parsedData.items || []);

    // Save items using transaction-based batch utility
    await save_price_items_batch(doc_id, partner_id, new Date(), items);

    return Response.json({ 
      success: true, 
      items: items 
    });
    
  } catch (error) {
    console.error("Error in normalize endpoint:", error);
    return Response.json({ error: "Ошибка обработки" }, { status: 500 });
  }
}