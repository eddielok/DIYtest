const {
  app,
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  screen,
} = require("electron");
const https = require("https");
const http = require("http");
const path = require("path");
const { createWorker } = require("tesseract.js");

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || "";
const SCAN_INTERVAL_MS = 13000;

const QUESTION_CATEGORIES = [
  {
    name: "Core Coding Test",
    keywords: [
      "function",
      "algorithm",
      "code",
      "implement",
      "write a",
      "debug",
      "output",
      "complexity",
      "runtime",
      "array",
      "string",
      "loop",
      "class",
      "return",
      "variable",
      "syntax",
      "compile",
      "bug",
      "leetcode",
      "fizzbuzz",
    ],
    prompt:
      "You are an expert software engineer. The following is a coding test question extracted from a screenshot. Provide ONLY the answer/solution with brief explanation. Do NOT restate or repeat the question. Include code if needed.\n\nQuestion:\n",
  },
  {
    name: "AI & Machine Learning Test",
    keywords: [
      "machine learning",
      "neural network",
      "model",
      "training",
      "dataset",
      "overfitting",
      "gradient",
      "loss function",
      "classification",
      "regression",
      "clustering",
      "feature",
      "epoch",
      "backpropagation",
      "transformer",
      "llm",
      "gpt",
      "embedding",
      "precision",
      "recall",
    ],
    prompt:
      "You are an AI/ML expert. The following is an AI & Machine Learning test question extracted from a screenshot. Provide ONLY the answer with brief reasoning. Do NOT restate or repeat the question.\n\nQuestion:\n",
  },
  {
    name: "Cognitive & Logical Test",
    keywords: [
      "if all",
      "some are",
      "which of the following",
      "how many",
      "next in the sequence",
      "pattern",
      "logical",
      "reasoning",
      "probability",
      "puzzle",
      "riddle",
      "true or false",
      "all of the above",
      "none of the above",
      "deduction",
      "infer",
    ],
    prompt:
      "You are an expert in logical reasoning and cognitive tests. The following is a cognitive/logical test question extracted from a screenshot. Solve it step by step and give the final answer clearly. Do NOT restate or repeat the question.\n\nQuestion:\n",
  },
  {
    name: "Custom Video or Architecture Questions",
    keywords: [
      "system design",
      "architecture",
      "scalab",
      "microservice",
      "database design",
      "api design",
      "load balancer",
      "cache",
      "cdn",
      "distributed",
      "design a",
      "high availability",
      "fault toleran",
      "video question",
      "record a video",
      "explain your approach",
    ],
    prompt:
      "You are a senior software architect. The following is a system design or architecture question extracted from a screenshot. Provide ONLY a structured, practical answer covering key design decisions. Do NOT restate or repeat the question.\n\nQuestion:\n",
  },
  {
    name: "Culture Add / Situational Judgment",
    keywords: [
      "tell me about",
      "describe a time",
      "how would you",
      "what would you do",
      "team",
      "conflict",
      "challenge",
      "strength",
      "weakness",
      "why do you",
      "culture",
      "values",
      "collaborate",
      "situation",
      "behavioral",
      "competency",
      "motivation",
      "goal",
    ],
    prompt:
      "You are a career coach and expert interviewer. The following is a behavioral or situational judgment question extracted from a screenshot. Provide ONLY a strong, structured answer using the STAR method where appropriate. Do NOT restate or repeat the question.\n\nQuestion:\n",
  },
];

function detectCategory(text) {
  const lower = text.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const cat of QUESTION_CATEGORIES) {
    const score = cat.keywords.filter((kw) => lower.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      best = cat;
    }
  }
  return bestScore >= 1 ? best : null;
}

let mainWindow;

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 500,
    height: 300,
    x: width - 440,
    y: 500,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
    },
  });

  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.loadFile("index.html");
}

async function captureScreen() {
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 1280, height: 720 },
  });

  if (!sources.length) return null;
  return sources[0].thumbnail.toDataURL();
}

async function ocrImage(dataUrl) {
  const worker = await createWorker("eng");
  const {
    data: { text },
  } = await worker.recognize(dataUrl);
  await worker.terminate();
  return text.trim();
}

function callDeepSeek(screenText, prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "user", content: prompt + screenText }],
      max_tokens: 1000,
    });

    const options = {
      hostname: "api.deepseek.com",
      path: "/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          const text = parsed.choices?.[0]?.message?.content || "No response";
          resolve(text);
        } catch (e) {
          reject(new Error(`DeepSeek API error: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

const UNFILTERED_PROMPT =
  "You are a helpful assistant. The following is text extracted (via OCR) from a screenshot. Answer any visible questions or summarize key content. Provide ONLY the answer — do NOT restate or repeat the question. Be concise.\n\nScreen text:\n";

async function runScan({ filtered }) {
  if (!mainWindow || scanStopped) return;
  mainWindow.webContents.send("status", "scanning");

  try {
    const imageData = await captureScreen();
    if (scanStopped || !imageData) {
      if (!scanStopped) mainWindow.webContents.send("status", "error");
      return;
    }

    mainWindow.webContents.send("status", "ocr");
    const screenText = await ocrImage(imageData);
    if (scanStopped) return;
    if (!screenText) {
      mainWindow.webContents.send("answer", "No text detected on screen.");
      return;
    }

    let prompt;
    if (filtered) {
      const category = detectCategory(screenText);
      if (!category) {
        mainWindow.webContents.send(
          "answer",
          "No relevant test question detected on screen.",
        );
        mainWindow.webContents.send("status", "ready");
        return;
      }
      mainWindow.webContents.send("category", category.name);
      prompt = category.prompt;
    } else {
      mainWindow.webContents.send("category", "Unfiltered");
      prompt = UNFILTERED_PROMPT;
    }

    if (scanStopped) return;
    mainWindow.webContents.send("status", "thinking");
    const answer = await callDeepSeek(screenText, prompt);
    if (!scanStopped) mainWindow.webContents.send("answer", answer);
  } catch (err) {
    if (!scanStopped)
      mainWindow.webContents.send("answer", `Error: ${err.message}`);
  }
}

const scanAndAnalyze = () => runScan({ filtered: true });

let scanInterval = null;
let isPaused = false;
let scanStopped = false;

function startInterval() {
  if (scanInterval) clearInterval(scanInterval);
  scanInterval = setInterval(() => {
    if (!isPaused) runScan({ filtered: false });
  }, SCAN_INTERVAL_MS);
}

app.whenReady().then(() => {
  createWindow();

  app.commandLine.appendSwitch(
    "enable-features",
    "DesktopCaptureCrashHandling",
  );

  setTimeout(() => {
    runScan({ filtered: false });
    startInterval();
  }, 1500);
});

ipcMain.on("close", () => app.quit());
ipcMain.on("scan-now", () => runScan({ filtered: true }));
ipcMain.on("scan-all", () => runScan({ filtered: false }));
ipcMain.on("toggle-pause", () => {
  isPaused = !isPaused;
  if (mainWindow) mainWindow.webContents.send("paused", isPaused);
});

let targetMacIP = null;

function getLocalIPs() {
  const os = require("os");
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i.family === "IPv4" && !i.internal)
    .map((i) => i.address);
}

async function sendScreenToMac(ip) {
  const imageData = await captureScreen();
  if (!imageData) throw new Error("Failed to capture screen");

  const senderIPs = getLocalIPs();
  const body = JSON.stringify({
    image: imageData,
    timestamp: Date.now(),
    senderIPs,
  });

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: ip,
        port: 9999,
        path: "/receive",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        res.on("data", () => {});
        res.on("end", () => resolve());
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// HTTP server to receive Claude's analysis result from the other Mac
let resultServer = null;
function startResultServer() {
  if (resultServer) return;
  resultServer = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/result") {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(200).end("ok");
      try {
        const { analysis } = JSON.parse(body);
        if (mainWindow && analysis) {
          mainWindow.webContents.send("remote-analysis", analysis);
        }
      } catch {}
    });
  });
  resultServer.listen(9998, "0.0.0.0");
}

ipcMain.handle("send-screen", async (_, ip) => {
  if (ip) targetMacIP = ip.trim();
  if (!targetMacIP) return { error: "No target IP set." };

  // Stop regular OCR scan immediately (including any in-progress scan)
  scanStopped = true;
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
  }
  isPaused = true;
  if (mainWindow) mainWindow.webContents.send("paused", true);

  startResultServer();

  try {
    await sendScreenToMac(targetMacIP);
    return { ok: true, ip: targetMacIP };
  } catch (err) {
    return { error: err.message };
  }
});

app.on("window-all-closed", () => app.quit());
