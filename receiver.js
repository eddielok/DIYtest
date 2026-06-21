#!/usr/bin/env node
// Run on the receiving Mac: node receiver.js
// Requires: Claude Code CLI installed (claude command available)
// Install Claude Code: https://claude.ai/download  (included with Pro plan)

const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const PORT = 9999;
const OUT_DIR = path.join(__dirname, "received");

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

function findClaudeBin() {
  const candidates = [
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
    `${process.env.HOME}/.npm-global/bin/claude`,
    `${process.env.HOME}/.local/bin/claude`,
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return "claude"; // fall back to PATH
}

function analyzeWithClaude(imagePath) {
  return new Promise((resolve, reject) => {
    const claudeBin = findClaudeBin();
    const prompt =
      `Read the image file at "${imagePath}". Look at what is on the screen. ` +
      `If there is a coding challenge, algorithm problem, or programming question: ` +
      `provide a complete, working code solution with the full implementation. ` +
      `Include the code in a code block and add a brief explanation of the approach. ` +
      `If there are multiple parts or examples, solve all of them. ` +
      `If it is a non-coding question or general content, answer it directly and concisely. ` +
      `Do NOT restate the question. Get straight to the answer/code.`;

    console.log(`Running: ${claudeBin} -p "..." --allowedTools Read`);

    execFile(
      claudeBin,
      ["-p", prompt, "--allowedTools", "Read", "--output-format", "text"],
      { timeout: 90000 },
      (err, stdout, stderr) => {
        if (err) {
          // Retry without flags in case of older CLI version
          execFile(claudeBin, ["-p", prompt], { timeout: 90000 }, (err2, stdout2) => {
            if (err2) return reject(new Error(stderr || err.message));
            resolve(stdout2.trim());
          });
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}

function postResultBack(senderIP, analysis) {
  const body = JSON.stringify({ analysis });
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: senderIP,
        port: 9998,
        path: "/result",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        timeout: 5000,
      },
      (res) => { res.resume(); res.on("end", () => resolve(true)); }
    );
    req.on("error", (e) => {
      console.warn(`Could not send result back to ${senderIP}: ${e.message}`);
      resolve(false);
    });
    req.on("timeout", () => {
      console.warn(`Timeout sending result to ${senderIP}`);
      req.destroy();
      resolve(false);
    });
    req.write(body);
    req.end();
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/receive") {
    res.writeHead(404).end();
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));

    try {
      const { image, timestamp, senderIPs } = JSON.parse(body);
      const base64 = image.replace(/^data:image\/\w+;base64,/, "");

      const filename = path.join(OUT_DIR, `screen-${timestamp}.png`);
      fs.writeFileSync(filename, Buffer.from(base64, "base64"));
      console.log(`\n[${new Date().toLocaleTimeString()}] Screenshot saved → ${filename}`);

      // Open in Preview
      execFile("open", ["-a", "Preview", filename]);

      // Analyze with Claude CLI
      console.log("Sending to Claude for analysis...");
      const analysis = await analyzeWithClaude(filename);

      // Close Preview once analysis is done
      execFile("osascript", ["-e", 'tell application "Preview" to close (every window whose name contains "screen-")']);

      console.log("\n--- Claude's Analysis ---");
      console.log(analysis);
      console.log("-------------------------\n");

      fs.writeFileSync(filename.replace(".png", ".txt"), analysis);

      // Send result back to sender overlay — try each IP up to 3 times
      if (senderIPs?.length) {
        let delivered = false;
        for (const ip of senderIPs) {
          for (let attempt = 1; attempt <= 3 && !delivered; attempt++) {
            console.log(`Sending result back to ${ip}:9998 (attempt ${attempt})...`);
            const sent = await postResultBack(ip, analysis);
            if (sent) { console.log(`Result delivered to ${ip}`); delivered = true; }
            else if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
          }
          if (delivered) break;
        }
        if (!delivered) console.error("Failed to deliver result to any sender IP.");
      }
    } catch (err) {
      console.error("Error:", err.message);
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Receiver ready on port ${PORT}`);
  console.log(`Screenshots will be saved to: ${OUT_DIR}`);
  console.log("Waiting for screenshots...\n");
});
