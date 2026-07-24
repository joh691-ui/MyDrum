import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { promises as fs } from "fs";
import os from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DATA_DIR = join(__dirname, "data");
const PATTERNS_FILE = join(DATA_DIR, "patterns.json");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(join(__dirname, "public")));

// --- storage helpers -------------------------------------------------------

async function readStore() {
  try {
    const raw = await fs.readFile(PATTERNS_FILE, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return { banks: [] };
    throw err;
  }
}

async function writeStore(store) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(PATTERNS_FILE, JSON.stringify(store, null, 2), "utf8");
}

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// --- API -------------------------------------------------------------------

// List all saved banks (metadata only, keeps responses light)
app.get("/api/patterns", async (_req, res) => {
  const store = await readStore();
  res.json(
    store.banks.map((b) => ({
      id: b.id,
      name: b.name,
      updatedAt: b.updatedAt,
    }))
  );
});

// Get one bank in full
app.get("/api/patterns/:id", async (req, res) => {
  const store = await readStore();
  const bank = store.banks.find((b) => b.id === req.params.id);
  if (!bank) return res.status(404).json({ error: "not found" });
  res.json(bank);
});

// Create a new bank
app.post("/api/patterns", async (req, res) => {
  const { name, data } = req.body || {};
  if (!data) return res.status(400).json({ error: "missing data" });
  const store = await readStore();
  const bank = {
    id: makeId(),
    name: (name || "untitled").toString().slice(0, 40),
    data,
    updatedAt: new Date().toISOString(),
  };
  store.banks.push(bank);
  await writeStore(store);
  res.status(201).json(bank);
});

// Update an existing bank
app.put("/api/patterns/:id", async (req, res) => {
  const { name, data } = req.body || {};
  const store = await readStore();
  const bank = store.banks.find((b) => b.id === req.params.id);
  if (!bank) return res.status(404).json({ error: "not found" });
  if (name !== undefined) bank.name = name.toString().slice(0, 40);
  if (data !== undefined) bank.data = data;
  bank.updatedAt = new Date().toISOString();
  await writeStore(store);
  res.json(bank);
});

// Delete a bank
app.delete("/api/patterns/:id", async (req, res) => {
  const store = await readStore();
  const before = store.banks.length;
  store.banks = store.banks.filter((b) => b.id !== req.params.id);
  if (store.banks.length === before)
    return res.status(404).json({ error: "not found" });
  await writeStore(store);
  res.status(204).end();
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// --- start -----------------------------------------------------------------

app.listen(PORT, "0.0.0.0", () => {
  const nets = os.networkInterfaces();
  const lan = Object.values(nets)
    .flat()
    .find((n) => n && n.family === "IPv4" && !n.internal);
  console.log(`\n  MyDrum (PO-14 style) is running\n`);
  console.log(`  Local:   http://localhost:${PORT}`);
  if (lan) console.log(`  iPhone:  http://${lan.address}:${PORT}   (same Wi-Fi)`);
  console.log(`\n  On iPhone: open the URL in Safari, then Share -> Add to Home Screen.\n`);
});
