import { GroqProvider } from "./src/ai/GroqProvider";
import dotenv from "dotenv";
dotenv.config();

async function run() {
  const provider = new GroqProvider(process.env.GROQ_API_KEY || "");
  const base64 = "data:image/jpeg;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const context = [{id: "1", name: "User", username: "user"}];
  try {
    const res = await provider.parseReceiptImage(base64, context);
    console.log("VISION RESULT:", JSON.stringify(res, null, 2));
  } catch (err) {
    console.error("VISION ERROR:", err);
  }
}
run();
