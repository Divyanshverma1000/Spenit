---
name: gen-image
description: Generate images via the local Codex CLI (OpenAI image model, ChatGPT login) and save them into ./images/ of the current project. Use when the user says "generate an image", "draw", "make a picture/illustration/cover".
allowed-tools: Bash(codex:*) Bash(mkdir:*) Bash(ls:*) Bash(pwd:*)
---

# Image generation

1. Run `pwd` to confirm the project folder.
2. `mkdir -p ./images`
3. Turn the request into a detailed English image prompt and a short kebab-case filename.
4. From the project root, run (timeout up to 5 minutes, it takes ~1 min):
   codex exec -s workspace-write --skip-git-repo-check "Use the image generation tool to generate: <prompt>. Save it as ./images/<filename>.png"
5. `ls ./images` to confirm the file exists, then report its full path.
   If it's missing, check Codex's output for where it saved the image and copy it into ./images/.