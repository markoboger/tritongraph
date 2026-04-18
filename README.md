# tritongraph

Vue Flow editor for **sbt-style modules** (nested projects) and **compile dependencies**, using an [Ilograph](https://ilograph.com/docs/spec)-compatible YAML document (`resources` + `perspectives` with `relations`).

## Run the web UI (localhost)

```bash
cd editor
npm install
npm run dev
```

Open the URL Vite prints (by default `http://127.0.0.1:5173`) in Cursor’s **Simple Browser** or your browser.

- **Load example** — loads `public/example.ilograph.yaml`.
- **Open YAML** — import any compatible file.
- **Download YAML** — export; includes optional `x-triton-editor` with node positions for round-trip in this editor (remove that key if a strict importer rejects unknown top-level fields).
- **Single-click** a container (group with submodules) to **zoom the viewport** onto that subtree and fade unrelated context (Ilograph-style drill). **Escape** or a click on the **empty canvas** zooms back out.
- **Double-click** a module or group to edit its name / subtitle.

Auto-layout uses **from** dependent **to** dependency in YAML. The canvas places **columns by dependency depth** (consumers on the **left**, classpath foundations on the **right**). Each column gets an **equal share of viewport width**; nodes in a column split **viewport height** (margins + stack gaps). Every box gets explicit **width/height** from that allocation so modules **scale with the pane**. Nested groups use the same rules inside the parent frame.

## Ilograph compatibility

The YAML follows the Ilograph spec: top-level `resources` (tree via `children`) and `perspectives` with `relations` using `from` / `to` (dependent → depended-on), matching Ilograph relation semantics so you can open the same file in Ilograph as a backup viewer.
