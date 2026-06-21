# AI Screen Overlay

A macOS Electron app that captures your screen, reads it with OCR, and answers questions using DeepSeek AI — displayed as a floating overlay. You can also send screenshots to another Mac where Claude analyzes them and sends the result back.

## Features

- Floating transparent overlay, always on top
- Periodic screen capture + OCR (Tesseract)
- Detects question categories (coding, ML, logic, system design, behavioral)
- Answers via DeepSeek AI
- Send screenshot to another Mac → Claude analyzes it → result appears in your overlay

## Requirements

- macOS
- Node.js
- A DeepSeek API key → [platform.deepseek.com](https://platform.deepseek.com)
- (For remote analysis) Claude Code CLI installed on the receiving Mac — included with a [Claude Pro](https://claude.ai) subscription

## Setup

```bash
git clone https://github.com/eddielok/DIYtest.git
cd DIYtest
npm install
cp .env.example .env
# Edit .env and add your DeepSeek API key
npm start
```

## Remote Analysis (Send to Another Mac)

### On the receiving Mac

Make sure Claude Code CLI is installed and you're logged in:

```bash
claude --version   # should print a version number
```

Copy `receiver.js` to the receiving Mac and run:

```bash
node receiver.js
```

It listens on **port 9999** for incoming screenshots and **port 9998** is used by the sender to receive results back.

### On this Mac (the overlay)

1. Enter the receiving Mac's local IP in the input field (e.g. `192.168.1.42`)
2. Click **Send ↗**
3. Claude analyzes the screenshot and the result appears in the overlay with a **Claude Vision** badge

> Both Macs must be on the same network. Make sure ports 9999 and 9998 are allowed through the firewall on each Mac.

## Project Structure

```
main.js        — Electron main process (screen capture, OCR, DeepSeek, HTTP server)
preload.js     — Exposes safe IPC bridge to the renderer
index.html     — Overlay UI
receiver.js    — Run on the other Mac to receive screenshots and invoke Claude
.env.example   — Environment variable template
```

## Environment Variables

| Variable | Description |
|---|---|
| `DEEPSEEK_API_KEY` | Your DeepSeek API key |
