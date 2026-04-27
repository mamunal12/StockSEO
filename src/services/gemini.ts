import { GoogleGenAI, Type } from "@google/genai";
import { MetadataResult } from "../types";

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function generateMetadata(base64Image: string, titleCount: number = 20, keywordCount: number = 45): Promise<MetadataResult> {
  const model = "gemini-3-flash-preview";
  
  const prompt = `You are an Adobe Stock metadata expert.
Analyze the uploaded image and generate:
1. Title: SEO optimized, approximately ${titleCount} words, clear, descriptive, no keyword stuffing.
2. Keywords: Exactly ${keywordCount} keywords, comma-separated, most important first. Include main subject, style, concept, colors, and industry relevance.

Return JSON format:
{
  "title": "...",
  "keywords": ["...", "..."]
}`;

  // Extract MIME type and base64 data
  const mimeTypeMatch = base64Image.match(/^data:(image\/[a-zA-Z+]+);base64,/);
  const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : "image/jpeg";
  const base64Data = base64Image.split(',')[1];

  const imagePart = {
    inlineData: {
      data: base64Data,
      mimeType: mimeType,
    },
  };

  const response = await genAI.models.generateContent({
    model,
    contents: [{ parts: [{ text: prompt }, imagePart] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ["title", "keywords"],
      },
    },
  });

  const text = response.text;
  if (!text) throw new Error("No response from Gemini");
  
  return JSON.parse(text) as MetadataResult;
}
