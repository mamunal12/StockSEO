import OpenAI from "openai";
import { MetadataResult } from "../types";

export async function generateMetadataGroq(
  base64Image: string, 
  apiKeys: string[],
  titleCount: number = 15,
  keywordCount: number = 45
): Promise<MetadataResult> {
  let lastError: any = null;

  for (const key of apiKeys) {
    try {
      const client = new OpenAI({
        apiKey: key.trim(),
        baseURL: "https://api.groq.com/openai/v1",
        dangerouslyAllowBrowser: true 
      });

      const prompt = `You are an Adobe Stock metadata expert.
Analyze the provided image and generate:
1. Title: SEO optimized, approximately ${titleCount} words, clear, descriptive, no keyword stuffing.
2. Keywords: Exactly ${keywordCount} keywords, comma-separated, most important first. Include main subject, style, concept, colors, and industry relevance.

Return JSON format:
{
  "title": "...",
  "keywords": ["...", "..."]
}`;

      const response = await client.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: {
                  url: base64Image,
                },
              },
            ],
          },
        ],
        response_format: { type: "json_object" },
      });

      const content = response.choices[0].message.content;
      if (!content) throw new Error("No response from Groq");
      
      return JSON.parse(content) as MetadataResult;
    } catch (error) {
      console.error(`Groq key failed: ${key.substring(0, 8)}...`, error);
      lastError = error;
      continue; // Try next key
    }
  }

  throw lastError || new Error("All Groq API keys failed.");
}
