# Trade Assist

A private English-language sales copilot for representatives of manufacturers. Uses only the company and product materials you supply.

## Start on this Mac

Double-click **Start Trade Assist.command** and keep its Terminal window open. The app opens at **http://127.0.0.1:5173/**. Press Control-C in Terminal to stop it.

1. Add a manufacturer and its product categories.
2. Add company facts and source documents. PDF extraction is AI-assisted: review the extracted text and commercial conditions before saving. Supported: PDF, TXT, Markdown, CSV, TSV, JSON. Each file must be under 8 MB; source text is limited to 100,000 characters per source and 160,000 per manufacturer.
3. Try a typed buyer question to verify the knowledge is useful.
4. Call from your US mobile number using speakerphone beside your computer. Choose **Start listening** and allow microphone access. Use a quiet room and check the transcript. The app does not place calls or speak into them.
5. Save the call, generate a recap, and review the editable follow-up draft. The app never sends email.

## Data and connection

- Profiles, extracted source text, transcripts, notes, and call history persist in this browser's local storage. They do not sync across browsers or origins. Export a backup in **Connection & audio**.
- Switching between `localhost` and `127.0.0.1` opens separate browser workspaces. Use `127.0.0.1` consistently.
- The API key was saved securely in ignored `.env.local`. It stays on the server and is never sent to the browser. Do not commit or share that file.
- Guidance, recap, and PDF extraction requests send the relevant materials to OpenAI. Listening sends microphone audio to OpenAI. Raw audio is not saved by this app. The microphone test stays local.
- Room audio mixes speakers; labels initially say **Room audio**. You can correct them. Manufacturer facts remain separate from buyer requests and commitments.
- Guidance includes source quotations, checks quotations against your materials, and uses a second claim-support check for factual answers. Verify important specifications and commercial commitments yourself; the checks do not guarantee perfect factual accuracy.
- End-to-end latency depends on speech detection, transcription, network, document size, and model response. The UI displays measured guidance time; it is not a guaranteed 1–2 seconds.
- Sessions stop after 55 minutes. Reconnect to continue.
- The hosted private copy needs its own runtime API secret. Local `.env.local` is intentionally excluded from source and deployment artifacts. Use this Mac's launcher for the connected version.

## Development and validation

Use Node.js 22.13 or later. `npm run dev`, `npm run build`, and `node node_modules/typescript/bin/tsc --noEmit` are available. The launcher selects the bundled Node runtime when present.

`node scripts/smoke-test.mjs` tests a running local app using clearly fictional manufacturer materials. It makes billable API requests for source grounding, unsupported facts, prompt injection resistance, summaries, and a transcription SDP exchange. It does not transmit microphone audio. Actual phone audio quality and speakerphone placement need a real-world trial.
