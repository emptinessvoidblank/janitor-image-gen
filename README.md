# Janitor AI — Scene Image Generator

Tampermonkey userscript: turns Janitor chat into a **3-stage image pipeline** with configurable APIs, RU/EN UI, presets, and quick run modes.

**Current version:** 2.4.0 · **Main file:** `janitor-image-gen.user.js`

---

## What it does

| Stage | What happens | Providers |
|-------|----------------|-----------|
| **1. Prompt** | Last chat messages → English scene prompt | **OpenRouter**, **OpenAI** (`/chat/completions`), **No LLM** (chat template), or **custom prompt** (skips LLM) |
| **2. Image** | Prompt → picture | **Venice AI** (flux), **OpenAI** (`/images/generations`, DALL·E) |
| **3. References** | Match face/fur from uploaded photos | **Venice multi-edit only** (optional) |

Each stage can be toggled in **⚙ → Pipeline**. The panel shows a live preview: `Run: prompt (LLM) → image → references`.

---

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Create a new script → paste contents of `janitor-image-gen.user.js` → Save.
3. Open a Janitor chat → click **🎨** in the toolbar.

---

## Quick start (recommended path)

**OpenRouter + Venice** — best tested for furry/anthro RP scenes with optional photo refs.

1. **🎨** → fill **AI character name** + **appearance text** (species, fur, ears…).
2. **⚙ → General** → preset **OpenRouter + Venice (full)**.
3. **⚙ → APIs** → enter keys:
   - OpenRouter: [openrouter.ai/keys](https://openrouter.ai/keys) — model e.g. `google/gemma-3-12b-it`
   - Venice: [venice.ai/settings/api](https://venice.ai/settings/api) — scene `flux-2-pro`, edit `flux-2-max-edit`
4. Optionally upload **reference images** (used only in stage 3).
5. Click **Run**.

---

## Run modes (main panel)

| Button | Result |
|--------|--------|
| **Run** | Follows ⚙ pipeline (all enabled stages) |
| **Prompt only** | Stage 1 only → copy prompt elsewhere |
| **Image only** | Skip LLM → custom prompt or chat template → image |
| **Run again** | Repeats the last run mode |
| **Right-click image** | Menu: Download · Floating mode |
| **Floating mode** | Separate window over chat — LMB drag, wheel zoom, × or RMB → Return to panel |
| **Copy prompt** | Copies scene prompt only (not pipeline log) |

**Custom prompt** field: if filled, stage 1 LLM is skipped for all modes.

**Main button label** changes automatically: *Run* / *Get prompt* / *Generate image* depending on settings.

**Ctrl+Enter** in the open panel runs generation (same as **Run**).

---

## Settings (⚙)

### Tabs

| Tab | Contents |
|-----|----------|
| **General** | Presets, language (**Russian** / **English** — always in English in the dropdown) |
| **Pipeline** | Enable/disable stages, choose provider per stage, link to API keys |
| **APIs** | All API keys — always visible; badge shows which stage uses each provider (Venice: stage 2 and/or 3 separately) |
| **More** | Message count, image size, custom Venice models, `@connect` hint |

Venice is **optional**: OpenAI alone can run stage 2; Venice is only required for stages you assign to it (especially ref pass).

### Model dropdowns (APIs tab)

Each model field is a **dropdown**:

- **uncensored** — usually better for RP / furry (Gemma, Llama, Hermes, flux…)  
- **censored** — OpenAI, Claude, Gemini, DALL·E  
- **~$…** — approximate USD cost (check provider for current rates)  

**Custom model…** at the bottom → type any model ID. Click **?** next to the cost note for details.

### Presets

| Preset | Pipeline |
|--------|----------|
| OpenRouter + Venice | Full: LLM + flux + refs |
| Prompt only | Stage 1 only |
| No LLM + Venice | Chat template + Venice image + refs |
| **OpenAI (prompt + image)** | GPT prompt + DALL·E — switches to **APIs** tab |
| Venice scene only | OpenRouter + Venice, no ref pass |

### OpenAI setup

1. **⚙ → Pipeline** → stage 1 and/or 2 → provider **OpenAI**.
2. You are redirected to **⚙ → APIs** (or click **Go to API keys →**).
3. Fill **OpenAI — prompt** and/or **OpenAI — image**:
   - Base URL: `https://api.openai.com/v1`
   - Prompt model: e.g. `gpt-4o-mini`
   - Image model: e.g. `dall-e-3`, size `1024x1024` (or `1792x1024` / `1024x1792` for DALL·E 3)
4. Use **Same key for OpenAI prompt + image** if one OpenAI account.

> **Note:** OpenAI has NSFW filters; furry/anthro is usually weaker than Venice flux. Less tested than OpenRouter+Venice.

### OpenRouter setup

- Base URL: `https://openrouter.ai/api/v1`
- Any chat model on OpenRouter (Gemma, Claude, etc.)

### Venice setup

- Base URL: `https://api.venice.ai/api/v1`
- Scene: `flux-2-pro` · Ref edit: `flux-2-max-edit`
- **Safe mode** blurs NSFW (disable for RP if needed)

---

## Reference images

- Photo refs are sent to **Venice stage 3 only** — not to OpenRouter or DALL·E.
- **Without Venice:** refs are stored locally but **not** sent to APIs; use **appearance text** so the LLM describes characters.
- Stage 3 is **implemented for Venice** in this script; other services with ref/edit APIs exist but are not wired yet.

### Without Venice — can users still get an image?

**Yes.** Venice is **not required** for a picture:

| Setup | Result |
|-------|--------|
| Stage 2 = **OpenAI** (DALL·E), stage 3 off | Full image, no ref pass |
| Stage 2 = **OpenAI**, refs uploaded | Image yes; refs only via appearance text |
| Stage 1 only (prompt) | Text prompt only, no image API needed |

Venice key is needed **only for pipeline stages you assign to Venice** (flux scene and/or ref edit). In **⚙ → APIs**, the Venice badge shows exactly which stages use it: `● stage 2 — image`, `● stage 3 — references`, or both — not “Venice owns everything”.

The panel shows yellow warnings when refs are uploaded but Venice ref stage is unavailable.

---

## Custom API hosts

Tampermonkey blocks unknown domains. Add to the script header:

```javascript
// @connect your.api.host
```

Default `@connect` entries: `openrouter.ai`, `api.venice.ai`, `api.openai.com`, `janitorai.com`.

---

## Art styles

**Furry / Anthro** · **Anime** · **Realistic** — affects prompt wording and default Venice models (unless **Custom Venice models** is checked in More).

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| **?** shows many alerts | Fixed in 2.3.0 — update script |
| Can't find OpenAI key fields | Select **OpenAI** in Pipeline → open **APIs** tab (sections always visible now) |
| Refs ignored | Need Venice key + stage 3 enabled + checkbox in panel |
| Venice edit 500 | Script tries fallback models; keeps stage-2 image on failure |
| Empty prompt | Check OpenRouter/OpenAI key; or use **No LLM** / custom prompt |
| `@connect` error | Add host to script header |

Click **?** buttons in the UI for inline help (one dialog per click).

---

## Files

```
janitor/
├── janitor-image-gen.user.js   # Tampermonkey userscript
└── README.md
```

---

## Privacy

API keys are stored in Tampermonkey (`GM_setValue`) locally in your browser. Chat text is sent only to APIs you configure. Reference images stay local until Venice stage 3.

---

## License

MIT
