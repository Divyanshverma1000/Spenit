import Groq from "groq-sdk";
import dotenv from "dotenv";

dotenv.config();

async function run() {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  try {
    const res = await groq.chat.completions.create({
      messages: [{ role: "user", content: "hello" }],
      model: "mixtral-8x7b-32768",
    });
    console.log("Success:", res.choices[0]?.message?.content);
  } catch (err) {
    console.error("Error:", err);
  }
}
run();
