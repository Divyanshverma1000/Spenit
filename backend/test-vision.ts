import { GroqProvider } from "./src/ai/GroqProvider";
import dotenv from "dotenv";
import fs from "fs";
dotenv.config();

async function run() {
  const provider = new GroqProvider(process.env.GROQ_API_KEY || "");
  const context = [{id: "1", name: "User", username: "user"}];
  try {
    // Download an image
    console.log("Downloading image...");
    const imgRes = await fetch("https://upload.wikimedia.org/wikipedia/commons/f/f2/LPU-v1-die.jpg");
    const buffer = await imgRes.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const imageData = `data:image/jpeg;base64,${base64}`;
    
    console.log("Sending to vision model...");
    const res = await provider.parseReceiptImage(imageData, context);
    console.log("VISION RESULT:", JSON.stringify(res, null, 2));
  } catch (err) {
    console.error("VISION ERROR:", err);
  }
}
run();
