-- Migration: Stage 6B - Add Groq API Key to User

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS groq_api_key text null;
