// ==UserScript==
// @name         Janitor AI — Image Generator
// @namespace    http://tampermonkey.net/
// @version      2.4.0
// @description  Janitor chat → configurable pipeline (prompt + image providers, optional ref pass) — RU/EN
// @connect      api.openai.com
// @author       you
// @match        *://janitorai.com/*/chats/*
// @match        *://janitorai.com/chats/*
// @match        *://www.janitorai.com/*/chats/*
// @match        *://www.janitorai.com/chats/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @connect      openrouter.ai
// @connect      api.venice.ai
// @connect      janitorai.com
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  const DEFAULTS = {
    locale: 'ru',
    openrouterKey: '',
    veniceKey: '',
    veniceBaseUrl: 'https://api.venice.ai/api/v1',
    openrouterModel: 'google/gemma-3-12b-it',
    veniceModel: 'flux-2-pro',
    veniceEditModel: 'flux-2-max-edit',
    pipelinePromptEnabled: true,
    pipelinePromptProvider: 'openrouter',
    pipelineSceneEnabled: true,
    pipelineSceneProvider: 'venice',
    pipelineRefEnabled: true,
    pipelineRefProvider: 'venice',
    artStyle: 'furry_anthro',
    messageCount: 10,
    imageWidth: 1024,
    imageHeight: 1024,
    safeMode: false,
    qualityTwoStep: true,
    refFacePass: true,
    userCharName: '',
    userCharAppearance: '',
    aiCharName: '',
    aiCharAppearance: '',
    customScenePrompt: '',
  };

  const PROVIDER_DEFAULTS = {
    openrouter: { apiKey: '', baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemma-3-12b-it' },
    openai_prompt: { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    venice: { apiKey: '', baseUrl: 'https://api.venice.ai/api/v1', sceneModel: 'flux-2-pro', editModel: 'flux-2-max-edit', safeMode: false },
    openai_image: { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: 'dall-e-3', size: '1024x1024' },
  };

  const PROMPT_PROVIDERS = ['openrouter', 'openai_compat', 'manual'];
  const IMAGE_PROVIDERS = ['venice', 'openai_compat'];
  const REF_PROVIDERS = ['venice', 'none'];

  /** id, censored, cost (approx USD) */
  const MODEL_CATALOG = {
    openrouter_prompt: [
      { id: 'google/gemma-3-12b-it', censored: false, cost: '~$0.04/1M' },
      { id: 'google/gemma-3-27b-it', censored: false, cost: '~$0.15/1M' },
      { id: 'meta-llama/llama-3.3-70b-instruct', censored: false, cost: '~$0.50/1M' },
      { id: 'nousresearch/hermes-3-llama-3.1-405b', censored: false, cost: '~$1/1M' },
      { id: 'mistralai/mistral-small-3.1-24b-instruct', censored: false, cost: '~$0.10/1M' },
      { id: 'anthropic/claude-3.5-haiku', censored: true, cost: '~$1/1M' },
      { id: 'openai/gpt-4o-mini', censored: true, cost: '~$0.15/1M' },
      { id: 'google/gemini-2.0-flash-001', censored: true, cost: '~$0.10/1M' },
    ],
    openai_prompt: [
      { id: 'gpt-4o-mini', censored: true, cost: '~$0.15/1M in' },
      { id: 'gpt-4o', censored: true, cost: '~$2.50/1M in' },
      { id: 'gpt-4.1-mini', censored: true, cost: '~$0.40/1M in' },
      { id: 'gpt-4.1-nano', censored: true, cost: '~$0.10/1M in' },
    ],
    venice_scene: [
      { id: 'flux-2-pro', censored: false, cost: '~$0.04/img' },
      { id: 'flux-2-max', censored: false, cost: '~$0.10/img' },
      { id: 'lustify-v7', censored: false, cost: '~$0.04/img' },
      { id: 'wai-Illustrious', censored: false, cost: '~$0.03/img' },
      { id: 'flux-dev-uncensored', censored: false, cost: '~$0.02/img' },
      { id: 'hidream', censored: true, cost: '~$0.03/img' },
    ],
    venice_edit: [
      { id: 'flux-2-max-edit', censored: false, cost: '~$0.08/edit' },
      { id: 'qwen-edit-uncensored', censored: false, cost: '~$0.05/edit' },
      { id: 'qwen-image-2-pro-edit', censored: true, cost: '~$0.06/edit' },
      { id: 'grok-imagine-quality-edit', censored: true, cost: '~$0.08/edit' },
    ],
    openai_image: [
      { id: 'dall-e-3', censored: true, cost: '~$0.04–0.12/img' },
      { id: 'dall-e-2', censored: true, cost: '~$0.02/img' },
    ],
  };

  const MODEL_SELECTS = [
    { selectId: 'jig-set-openrouter-model-select', customId: 'jig-set-openrouter-model-custom', catalog: 'openrouter_prompt' },
    { selectId: 'jig-set-openai-prompt-model-select', customId: 'jig-set-openai-prompt-model-custom', catalog: 'openai_prompt' },
    { selectId: 'jig-set-venice-model-select', customId: 'jig-set-venice-model-custom', catalog: 'venice_scene' },
    { selectId: 'jig-set-venice-edit-model-select', customId: 'jig-set-venice-edit-model-custom', catalog: 'venice_edit' },
    { selectId: 'jig-set-openai-image-model-select', customId: 'jig-set-openai-image-model-custom', catalog: 'openai_image' },
  ];

  const I18N = {
    ru: {
      'app.title': 'Генератор сцены',
      'app.settings': 'API и пайплайн',
      'app.ready': 'Готов',
      'app.done': 'Готово',
      'app.lang': 'Язык',
      'lang.ru': 'Russian',
      'lang.en': 'English',
      'btn.generate': 'Сгенерировать',
      'btn.generateImage': 'Сгенерировать картинку',
      'btn.getPrompt': 'Получить промпт',
      'btn.promptOnly': 'Только промпт',
      'btn.imageOnly': 'Только картинка',
      'btn.regenerate': 'Ещё раз',
      'btn.clearCustomPrompt': 'Очистить',
      'btn.syncOpenAIKeys': 'Один ключ для OpenAI prompt + image',
      'btn.download': 'Скачать',
      'btn.copyPrompt': 'Копировать промпт',
      'btn.open': 'Открыть',
      'btn.save': 'Сохранить',
      'btn.cancel': 'Отмена',
      'btn.clearRef': 'Убрать фото',
      'section.user': 'Твой персонаж',
      'section.ai': 'Персонаж ИИ',
      'field.name': 'Имя',
      'field.appearance': 'Текст внешности (вид, уши, шерсть)',
      'field.customPrompt': 'Свой промпт (необязательно)',
      'field.customPromptHint': 'Если заполнено — этап 1 (LLM) пропускается. Можно только скопировать или сразу генерировать картинку.',
      'field.ref': 'Референс (фото)',
      'field.artStyle': 'Стиль арта',
      'style.furry': 'Furry / Anthro (рисунок)',
      'style.anime': 'Anime / Manga',
      'style.realistic': 'Реализм (фото)',
      'pipeline.title': 'Этапы пайплайна',
      'pipeline.prompt': '1. Промпт сцены (LLM)',
      'pipeline.scene': '2. Генерация картинки',
      'pipeline.ref': '3. Референсы (лица/шерсть)',
      'provider.openrouter': 'OpenRouter',
      'provider.openai_compat': 'OpenAI-compatible API',
      'provider.openai': 'OpenAI (GPT / DALL·E)',
      'provider.manual': 'Без LLM (шаблон из чата)',
      'provider.venice': 'Venice AI',
      'provider.none': 'Выключено',
      'settings.title': 'API и пайплайн',
      'settings.section.general': 'Общее',
      'settings.section.prompt': 'Промпт — API',
      'settings.section.image': 'Картинка — API',
      'settings.section.advanced': 'Дополнительно',
      'settings.apiKey': 'API key',
      'settings.baseUrl': 'Base URL',
      'settings.model': 'Модель',
      'settings.sceneModel': 'Модель — сцена',
      'settings.editModel': 'Модель — референсы',
      'settings.modelCustom': 'Свой ID модели',
      'model.censored': 'цензура',
      'model.uncensored': 'без цензуры',
      'model.custom': 'Своя модель…',
      'model.costNote': '≈ цена USD, ориентир — проверяйте у провайдера',
      'help.models': 'Метки «без цензуры» = обычно лучше для RP/NSFW. «Цензура» = OpenAI, Claude, Gemini, DALL·E. Цены примерные.',
      'link.openrouterKeys': 'Ключ OpenRouter →',
      'link.veniceKeys': 'Ключ Venice →',
      'settings.imageSize': 'Размер (OpenAI)',
      'settings.messageCount': 'Сообщений из чата',
      'settings.width': 'Ширина',
      'settings.height': 'Высота',
      'settings.safeMode': 'Safe mode (Venice)',
      'settings.customModels': 'Свои модели Venice (игнорировать пресет стиля)',
      'settings.saved': 'Настройки сохранены',
      'settings.hint.connect': 'Для своего Base URL добавьте @connect host в заголовок скрипта Tampermonkey.',
      'settings.apiKeysHint': 'API-ключи — на вкладке «API». Секции подсвечены, если этап их использует.',
      'settings.gotoApis': 'Перейти к API-ключам →',
      'settings.apiActive': 'используется',
      'settings.apiInactive': 'не выбрано в пайплайне',
      'settings.apiStage1': 'этап 1',
      'settings.apiStage2': 'этап 2 — картинка',
      'settings.apiStage3': 'этап 3 — референсы',
      'settings.apiVeniceOptional': 'Venice не обязателен: этап 2 можно через OpenAI, этап 3 — только Venice',
      'ref.pass': 'Этап 3: подогнать по референсам',
      'ref.hint': 'Этап 3 (ref) — только Venice. Без Venice картинку всё равно можно получить на этапе 2 (OpenAI/Venice) — ref тогда только через текст внешности.',
      'warn.refsNeedVenice': '⚠ Референсы-фото работают только с Venice (этап 3). Без Venice заполните текст внешности — картинки ref не отправляются в DALL·E/OpenRouter.',
      'warn.refsDisabledInPanel': 'Этап 3 выключен галочкой — референсы не применятся.',
      'warn.openaiScene': 'OpenAI/DALL·E: другой формат API, фильтры NSFW, фиксированные размеры. Furry/anthro может быть слабее, чем Venice flux.',
      'warn.openaiPrompt': 'OpenAI-compatible промпт: нужен /chat/completions. Некоторые локальные API могут не поддерживать наш формат запроса.',
      'warn.manualPrompt': 'Режим «Без LLM»: простой шаблон из чата, без умного описания сцены.',
      'status.reading': 'Читаю последние {n} сообщений…',
      'status.prompt': 'Этап 1: промпт ({provider})…',
      'status.scene': 'Этап 2: картинка ({provider}, {model})…',
      'status.ref': 'Этап 3/{total}: {name} → {model}…',
      'status.promptCopied': 'Промпт скопирован',
      'status.promptReady': 'Промпт готов — скопируйте или используйте свой генератор',
      'run.preview': 'Запуск: {steps}',
      'run.shortcut': 'Ctrl+Enter — сгенерировать',
      'run.step.promptLlm': 'промпт (LLM)',
      'run.step.promptManual': 'промпт (шаблон)',
      'run.step.promptCustom': 'свой промпт',
      'run.step.image': 'картинка',
      'run.step.refs': 'референсы',
      'run.step.off': 'выкл',
      'result.prompt': 'Промпт',
      'result.pipeline': 'Пайплайн',
      'err.noPromptKey': 'Укажите API key для этапа промпта в ⚙ (или выберите «Без LLM»).',
      'err.noImageKey': 'Укажите API key для этапа картинки в ⚙.',
      'err.noAiName': 'Укажите имя персонажа ИИ.',
      'err.noMessages': 'Нет текста для генерации',
      'err.sceneDisabled': 'Этап картинки выключен — промпт ниже, скопируйте в свой генератор.',
      'err.needSceneForImage': 'Включите этап 2 (картинка) в ⚙ или используйте пресет с генерацией.',
      'err.noCustomOrChat': 'Для «Только картинка» нужен свой промпт или сообщения в чате.',
      'warn.refVeniceOnly': 'Этап референсов поддерживает только Venice AI.',
      'settings.tab.general': 'Общее',
      'settings.tab.pipeline': 'Пайплайн',
      'settings.tab.apis': 'API',
      'settings.tab.advanced': 'Ещё',
      'settings.presets': 'Пресет',
      'preset.custom': 'Свои настройки',
      'preset.openrouterVenice': 'OpenRouter + Venice (полный)',
      'preset.promptOnly': 'Только промпт (OpenRouter)',
      'preset.manualVenice': 'Без LLM + Venice',
      'preset.openaiFull': 'OpenAI (промпт + картинка)',
      'preset.veniceSceneOnly': 'Venice сцена, без референсов',
      'help.customPrompt': 'Свой текст промпта на английском (или любом языке модели). Заменяет LLM на этапе 1. «Только промпт» — скопировать. «Только картинка» — сразу в Venice/DALL·E без LLM.',
      'help.promptOnlyBtn': 'Сгенерировать промпт из чата (этап 1) и остановиться. Этап 2 можно выключить в ⚙ или нажать эту кнопку.',
      'help.imageOnlyBtn': 'Пропустить LLM: свой промпт из поля выше или простой шаблон из чата → сразу картинка (этап 2).',
      'help.pipeline': 'Три этапа: (1) LLM пишет промпт из чата, (2) генератор рисует картинку, (3) Venice подгоняет лица по фото-референсам. Каждый этап можно выключить.',
      'help.preset': 'Пресет подставляет провайдеров и этапы. API-ключи не меняются — введите их один раз в вкладке API.',
      'help.promptStage': 'Этап 1: последние сообщения чата → текст для картинки. OpenRouter/OpenAI = умный промпт. «Без LLM» = простой шаблон без API.',
      'help.sceneStage': 'Этап 2: промпт → картинка. Venice (flux) или OpenAI DALL·E. Выключите, если хотите только скопировать промпт.',
      'help.refStage': 'Этап 3 — ТОЛЬКО Venice multi-edit. Подгоняет лица/шерсть по загруженным фото. Без Venice этот этап недоступен — используйте текст внешности на этапе 1.',
      'help.openrouter': 'Ключ: openrouter.ai/keys. Base URL: https://openrouter.ai/api/v1. Модель: google/gemma-3-12b-it и др.',
      'help.venice': 'Venice: этап 2 (flux-сцена) и/или этап 3 (ref edit). Нужен только для включённых этапов с Venice. Картинку без ref можно получить через OpenAI на этапе 2 — Venice не обязателен.',
      'float.title': 'Сцена',
      'float.controls': 'ЛКМ — двигать · колёсико — масштаб · × или ПКМ — вернуть',
      'float.menuFloat': 'Плавающий режим',
      'float.menuDock': 'Вернуть в панель',
      'float.activeHint': 'Картинка в плавающем режиме — ПКМ по ней или × чтобы вернуть',
      'float.hint': 'ПКМ по картинке — меню',
      'help.openai': 'OpenAI-compatible: /chat/completions и /images/generations. Протестировано слабее, чем OpenRouter+Venice — возможны ошибки и фильтры NSFW.',
      'help.refPass': 'Применить этап 3 при генерации. Нужны: Venice API key, загруженные ref, картинка этапа 2.',
      'help.refsNoVenice': 'Без Venice: фото ref хранятся, но в API не уходят. LLM получает только текст из полей «внешность». Для похожих персонажей — детально опишите вид текстом.',
      'help.otherApis': 'OpenRouter и Venice — основные протестированные пути. OpenAI-compatible через стандартные endpoint, но провайдеры отличаются — ошибки возможны. Смотрите текст ошибки в статусе.',
      'help.artStyle': 'Влияет на текст промпта: furry/anime/realistic. Модели Venice в пресете стиля (если не «свои модели»).',
      'help.connect': 'Tampermonkey блокирует запросы к неизвестным доменам. Добавьте // @connect your.host в начало скрипта.',
    },
    en: {
      'app.title': 'Scene generator',
      'app.settings': 'API & pipeline',
      'app.ready': 'Ready',
      'app.done': 'Done',
      'app.lang': 'Language',
      'lang.ru': 'Russian',
      'lang.en': 'English',
      'btn.generate': 'Run',
      'btn.generateImage': 'Generate image',
      'btn.getPrompt': 'Get prompt',
      'btn.promptOnly': 'Prompt only',
      'btn.imageOnly': 'Image only',
      'btn.regenerate': 'Run again',
      'btn.clearCustomPrompt': 'Clear',
      'btn.syncOpenAIKeys': 'Same key for OpenAI prompt + image',
      'btn.download': 'Download',
      'btn.copyPrompt': 'Copy prompt',
      'btn.open': 'Open',
      'btn.save': 'Save',
      'btn.cancel': 'Cancel',
      'btn.clearRef': 'Remove photo',
      'section.user': 'Your character',
      'section.ai': 'AI character',
      'field.name': 'Name',
      'field.appearance': 'Appearance (species, fur, ears…)',
      'field.customPrompt': 'Custom prompt (optional)',
      'field.customPromptHint': 'If filled — stage 1 (LLM) is skipped. Copy it only, or generate an image directly.',
      'field.ref': 'Reference image',
      'field.artStyle': 'Art style',
      'style.furry': 'Furry / Anthro (illustration)',
      'style.anime': 'Anime / Manga',
      'style.realistic': 'Realistic (photo)',
      'pipeline.title': 'Pipeline stages',
      'pipeline.prompt': '1. Scene prompt (LLM)',
      'pipeline.scene': '2. Image generation',
      'pipeline.ref': '3. References (face/fur pass)',
      'provider.openrouter': 'OpenRouter',
      'provider.openai_compat': 'OpenAI-compatible API',
      'provider.openai': 'OpenAI (GPT / DALL·E)',
      'provider.manual': 'No LLM (chat template)',
      'provider.venice': 'Venice AI',
      'provider.none': 'Disabled',
      'settings.title': 'API & pipeline',
      'settings.section.general': 'General',
      'settings.section.prompt': 'Prompt API',
      'settings.section.image': 'Image API',
      'settings.section.advanced': 'Advanced',
      'settings.apiKey': 'API key',
      'settings.baseUrl': 'Base URL',
      'settings.model': 'Model',
      'settings.sceneModel': 'Scene model',
      'settings.editModel': 'Reference edit model',
      'settings.modelCustom': 'Custom model ID',
      'model.censored': 'censored',
      'model.uncensored': 'uncensored',
      'model.custom': 'Custom model…',
      'model.costNote': '≈ USD, approximate — check provider',
      'help.models': '«Uncensored» = usually better for RP/NSFW. «Censored» = OpenAI, Claude, Gemini, DALL·E. Prices are approximate.',
      'link.openrouterKeys': 'OpenRouter keys →',
      'link.veniceKeys': 'Venice keys →',
      'settings.imageSize': 'Size (OpenAI)',
      'settings.messageCount': 'Chat messages',
      'settings.width': 'Width',
      'settings.height': 'Height',
      'settings.safeMode': 'Safe mode (Venice)',
      'settings.customModels': 'Custom Venice models (ignore style preset)',
      'settings.saved': 'Settings saved',
      'settings.hint.connect': 'For custom Base URL add @connect host to the Tampermonkey script header.',
      'settings.apiKeysHint': 'Enter API keys on the APIs tab. Sections are highlighted when the pipeline uses them.',
      'settings.gotoApis': 'Go to API keys →',
      'settings.apiActive': 'in use',
      'settings.apiInactive': 'not selected in pipeline',
      'settings.apiStage1': 'stage 1',
      'settings.apiStage2': 'stage 2 — image',
      'settings.apiStage3': 'stage 3 — references',
      'settings.apiVeniceOptional': 'Venice optional: stage 2 can use OpenAI; stage 3 refs need Venice',
      'ref.pass': 'Stage 3: match references',
      'ref.hint': 'Stage 3 (refs) is Venice-only. Without Venice you can still get an image at stage 2 (OpenAI/Venice) — refs then work via appearance text only.',
      'warn.refsNeedVenice': '⚠ Photo refs need Venice (stage 3). Without Venice, fill appearance text — ref images are not sent to DALL·E/OpenRouter.',
      'warn.refsDisabledInPanel': 'Stage 3 unchecked in panel — refs will not be applied.',
      'warn.openaiScene': 'OpenAI/DALL·E: different API, NSFW filters, fixed sizes. Furry/anthro may be weaker than Venice flux.',
      'warn.openaiPrompt': 'OpenAI-compatible prompt: requires /chat/completions. Some local APIs may reject our request format.',
      'warn.manualPrompt': 'No LLM mode: simple chat template, not a smart scene description.',
      'status.reading': 'Reading last {n} messages…',
      'status.prompt': 'Stage 1: prompt ({provider})…',
      'status.scene': 'Stage 2: image ({provider}, {model})…',
      'status.ref': 'Stage 3/{total}: {name} → {model}…',
      'status.promptCopied': 'Prompt copied',
      'status.promptReady': 'Prompt ready — copy it or use your own generator',
      'run.preview': 'Run: {steps}',
      'run.shortcut': 'Ctrl+Enter — generate',
      'run.step.promptLlm': 'prompt (LLM)',
      'run.step.promptManual': 'prompt (template)',
      'run.step.promptCustom': 'custom prompt',
      'run.step.image': 'image',
      'run.step.refs': 'references',
      'run.step.off': 'off',
      'result.prompt': 'Prompt',
      'result.pipeline': 'Pipeline',
      'err.noPromptKey': 'Set prompt stage API key in ⚙ (or choose “No LLM”).',
      'err.noImageKey': 'Set image stage API key in ⚙.',
      'err.noAiName': 'Enter AI character name.',
      'err.noMessages': 'No chat text to generate from',
      'err.sceneDisabled': 'Image stage disabled — prompt below, copy to your generator.',
      'err.needSceneForImage': 'Enable stage 2 (image) in ⚙ or use a preset with generation.',
      'err.noCustomOrChat': 'For “Image only” you need a custom prompt or chat messages.',
      'warn.refVeniceOnly': 'Reference stage supports Venice AI only.',
      'settings.tab.general': 'General',
      'settings.tab.pipeline': 'Pipeline',
      'settings.tab.apis': 'APIs',
      'settings.tab.advanced': 'More',
      'settings.presets': 'Preset',
      'preset.custom': 'Custom settings',
      'preset.openrouterVenice': 'OpenRouter + Venice (full)',
      'preset.promptOnly': 'Prompt only (OpenRouter)',
      'preset.manualVenice': 'No LLM + Venice',
      'preset.openaiFull': 'OpenAI (prompt + image)',
      'preset.veniceSceneOnly': 'Venice scene, no references',
      'help.customPrompt': 'Your own prompt text. Replaces LLM at stage 1. “Prompt only” copies it. “Image only” sends it straight to Venice/DALL·E without LLM.',
      'help.promptOnlyBtn': 'Build prompt from chat (stage 1) and stop. Or disable stage 2 in ⚙ and use this button.',
      'help.imageOnlyBtn': 'Skip LLM: custom prompt above or simple chat template → image (stage 2) directly.',
      'help.pipeline': 'Three stages: (1) LLM writes a prompt from chat, (2) image generator draws it, (3) Venice matches faces from photo refs. Each stage can be disabled.',
      'help.preset': 'A preset sets providers and stages. API keys are kept — enter them once under the API tab.',
      'help.promptStage': 'Stage 1: last chat messages → image prompt. OpenRouter/OpenAI = smart prompt. No LLM = simple template, no API.',
      'help.sceneStage': 'Stage 2: prompt → image. Venice (flux) or OpenAI DALL·E. Disable to copy the prompt only.',
      'help.refStage': 'Stage 3 — Venice multi-edit ONLY. Matches face/fur from uploaded photos. No Venice = unavailable — use appearance text in stage 1.',
      'help.openrouter': 'Key: openrouter.ai/keys. Base URL: https://openrouter.ai/api/v1. Model: google/gemma-3-12b-it etc.',
      'help.venice': 'Venice: stage 2 (flux scene) and/or stage 3 (ref edit). Key needed only for Venice stages you enable. Images without refs work via OpenAI at stage 2 — Venice not required.',
      'float.title': 'Scene',
      'float.controls': 'LMB drag · wheel zoom · × or RMB to dock',
      'float.menuFloat': 'Floating mode',
      'float.menuDock': 'Return to panel',
      'float.activeHint': 'Image is floating — RMB on it or × to dock',
      'float.hint': 'Right-click image for menu',
      'help.openai': 'OpenAI-compatible: /chat/completions and /images/generations. Less tested than OpenRouter+Venice — errors and NSFW filters possible.',
      'help.refPass': 'Apply stage 3 on generate. Needs: Venice API key, uploaded refs, stage-2 image.',
      'help.refsNoVenice': 'Without Venice: photo refs are stored but never sent to APIs. Stage 1 LLM only gets appearance text. For similar characters — describe looks in detail.',
      'help.otherApis': 'OpenRouter and Venice are the main tested paths. OpenAI-compatible uses standard endpoints but providers differ — errors are possible. Check the status error text.',
      'help.artStyle': 'Affects prompt wording: furry/anime/realistic. Venice models from style preset unless custom models on.',
      'help.connect': 'Tampermonkey blocks unknown hosts. Add // @connect your.host at the top of the script.',
    },
  };

  let locale = DEFAULTS.locale;
  let lastScenePrompt = '';
  let lastRunMode = { promptOnly: false, imageOnly: false };

  function t(key, vars) {
    const table = I18N[locale] || I18N.ru;
    let text = table[key] || I18N.en[key] || I18N.ru[key] || key;
    if (vars) {
      Object.entries(vars).forEach(([k, v]) => {
        text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      });
    }
    return text;
  }

  function formatModelOption(entry) {
    const tag = entry.censored ? t('model.censored') : t('model.uncensored');
    const cost = entry.cost ? ` · ${entry.cost}` : '';
    return `${entry.id} — ${tag}${cost}`;
  }

  function setModelSelectValue(selectId, customId, catalogKey, value) {
    const select = document.getElementById(selectId);
    const custom = document.getElementById(customId);
    if (!select) return;
    const known = MODEL_CATALOG[catalogKey]?.some((e) => e.id === value);
    if (known) {
      select.value = value;
      if (custom) {
        custom.style.display = 'none';
        custom.value = '';
      }
    } else if (value) {
      select.value = '__custom__';
      if (custom) {
        custom.style.display = 'block';
        custom.value = value;
      }
    } else if (MODEL_CATALOG[catalogKey]?.[0]) {
      select.value = MODEL_CATALOG[catalogKey][0].id;
      if (custom) custom.style.display = 'none';
    }
  }

  function readModelSelectValue(selectId, customId) {
    const select = document.getElementById(selectId);
    if (!select) return '';
    if (select.value === '__custom__') {
      return document.getElementById(customId)?.value.trim() || '';
    }
    return select.value;
  }

  function populateModelSelect(selectId, catalogKey) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const cur = select.value;
    select.innerHTML = '';
    (MODEL_CATALOG[catalogKey] || []).forEach((entry) => {
      const opt = document.createElement('option');
      opt.value = entry.id;
      opt.textContent = formatModelOption(entry);
      select.appendChild(opt);
    });
    const customOpt = document.createElement('option');
    customOpt.value = '__custom__';
    customOpt.textContent = t('model.custom');
    select.appendChild(customOpt);
    if (cur) select.value = cur;
  }

  function refreshModelSelectLabels() {
    MODEL_SELECTS.forEach(({ selectId, customId, catalog }) => {
      const currentVal = readModelSelectValue(selectId, customId);
      populateModelSelect(selectId, catalog);
      setModelSelectValue(selectId, customId, catalog, currentVal);
    });
  }

  function initModelSelects() {
    MODEL_SELECTS.forEach(({ selectId, customId, catalog }) => {
      populateModelSelect(selectId, catalog);
      const select = document.getElementById(selectId);
      const custom = document.getElementById(customId);
      if (!select || select.dataset.modelBound === '1') return;
      select.dataset.modelBound = '1';
      select.addEventListener('change', () => {
        if (custom) custom.style.display = select.value === '__custom__' ? 'block' : 'none';
      });
    });
  }

  function loadModelSelectsFromSettings(settings) {
    setModelSelectValue('jig-set-openrouter-model-select', 'jig-set-openrouter-model-custom', 'openrouter_prompt', settings.providers.openrouter.model);
    setModelSelectValue('jig-set-openai-prompt-model-select', 'jig-set-openai-prompt-model-custom', 'openai_prompt', settings.providers.openai_prompt.model);
    setModelSelectValue('jig-set-venice-model-select', 'jig-set-venice-model-custom', 'venice_scene', settings.veniceModel);
    setModelSelectValue('jig-set-venice-edit-model-select', 'jig-set-venice-edit-model-custom', 'venice_edit', settings.veniceEditModel);
    setModelSelectValue('jig-set-openai-image-model-select', 'jig-set-openai-image-model-custom', 'openai_image', settings.providers.openai_image.model);
  }

  const CONFIG_PRESETS = {
    custom: { labelKey: 'preset.custom' },
    openrouter_venice: {
      labelKey: 'preset.openrouterVenice',
      pipeline: {
        prompt: { enabled: true, provider: 'openrouter' },
        scene: { enabled: true, provider: 'venice' },
        refEdit: { enabled: true, provider: 'venice' },
      },
    },
    prompt_only: {
      labelKey: 'preset.promptOnly',
      pipeline: {
        prompt: { enabled: true, provider: 'openrouter' },
        scene: { enabled: false, provider: 'venice' },
        refEdit: { enabled: false, provider: 'none' },
      },
    },
    manual_venice: {
      labelKey: 'preset.manualVenice',
      pipeline: {
        prompt: { enabled: true, provider: 'manual' },
        scene: { enabled: true, provider: 'venice' },
        refEdit: { enabled: true, provider: 'venice' },
      },
    },
    openai_full: {
      labelKey: 'preset.openaiFull',
      pipeline: {
        prompt: { enabled: true, provider: 'openai_compat' },
        scene: { enabled: true, provider: 'openai_compat' },
        refEdit: { enabled: false, provider: 'none' },
      },
    },
    venice_scene_only: {
      labelKey: 'preset.veniceSceneOnly',
      pipeline: {
        prompt: { enabled: true, provider: 'openrouter' },
        scene: { enabled: true, provider: 'venice' },
        refEdit: { enabled: false, provider: 'none' },
      },
    },
  };

  function helpIcon(helpKey) {
    return `<button type="button" class="jig-help-btn" data-help="${helpKey}" aria-label="Help">?</button>`;
  }

  function labelWithHelp(textKey, helpKey) {
    return `<span class="jig-label-row"><span data-i18n="${textKey}">${t(textKey)}</span>${helpIcon(helpKey)}</span>`;
  }

  function showHelp(key) {
    if (!key) return;
    alert(t(key));
  }

  function initHelpDelegation() {
    const root = document.getElementById('jig-root');
    if (!root || root.dataset.helpBound === '1') return;
    root.dataset.helpBound = '1';
    root.addEventListener('click', (e) => {
      const btn = e.target.closest('.jig-help-btn');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      showHelp(btn.getAttribute('data-help'));
    });
  }

  function canUseRefStage(settings) {
    return !!(settings.pipeline?.refEdit?.enabled
      && settings.pipeline?.refEdit?.provider === 'venice'
      && settings.providers?.venice?.apiKey);
  }

  function getPanelWarnings(settings, refs) {
    const warnings = [];
    const hasRefs = hasRefImages(refs);

    if (hasRefs && !canUseRefStage(settings)) {
      warnings.push(t('warn.refsNeedVenice'));
    }
    if (hasRefs && canUseRefStage(settings) && !settings.refFacePass) {
      warnings.push(t('warn.refsDisabledInPanel'));
    }
    if (settings.pipeline?.scene?.enabled && settings.pipeline?.scene?.provider === 'openai_compat') {
      warnings.push(t('warn.openaiScene'));
    }
    if (settings.pipeline?.prompt?.enabled && settings.pipeline?.prompt?.provider === 'openai_compat') {
      warnings.push(t('warn.openaiPrompt'));
    }
    if (settings.pipeline?.prompt?.enabled && settings.pipeline?.prompt?.provider === 'manual') {
      warnings.push(t('warn.manualPrompt'));
    }
    return warnings;
  }

  function shouldUseRefStage(settings, refs) {
    return hasRefImages(refs)
      && canUseRefStage(settings)
      && settings.refFacePass;
  }

  function updateRefStageUI() {
    const settings = getRunSettings(loadSettings());
    const canUse = canUseRefStage(settings);
    const refBox = document.getElementById('jig-ref-face-pass');
    const refRow = refBox?.closest('.jig-quality-row');
    if (refBox) refBox.disabled = !canUse;
    if (refRow) {
      refRow.classList.toggle('jig-disabled', !canUse);
      refRow.title = !canUse ? t('help.refsNoVenice') : '';
    }
  }

  function updatePanelWarnings() {
    const box = document.getElementById('jig-warn-box');
    if (!box) return;
    const settings = getRunSettings(loadSettings());
    const refs = getStoredRefImages();
    const warnings = getPanelWarnings(settings, refs);
    if (!warnings.length) {
      box.style.display = 'none';
      box.innerHTML = '';
      return;
    }
    box.style.display = 'block';
    box.innerHTML = warnings.map((w) => `<div class="jig-warn-line">${w}</div>`).join('');
  }

  function getCustomPromptFromUI() {
    return document.getElementById('jig-custom-prompt')?.value.trim() || '';
  }

  function buildPipelinePreviewSteps(settings, refs, override = {}) {
    const custom = getCustomPromptFromUI();
    const steps = [];

    if (override.promptOnly) {
      if (custom) steps.push(t('run.step.promptCustom'));
      else if (settings.pipeline.prompt.enabled && settings.pipeline.prompt.provider !== 'manual') {
        steps.push(t('run.step.promptLlm'));
      } else {
        steps.push(t('run.step.promptManual'));
      }
      steps.push(`${t('run.step.image')} (${t('run.step.off')})`);
    } else if (override.imageOnly) {
      steps.push(custom ? t('run.step.promptCustom') : t('run.step.promptManual'));
      steps.push(t('run.step.image'));
    } else {
      if (custom) steps.push(t('run.step.promptCustom'));
      else if (!settings.pipeline.prompt.enabled || settings.pipeline.prompt.provider === 'manual') {
        steps.push(t('run.step.promptManual'));
      } else {
        steps.push(t('run.step.promptLlm'));
      }
      if (settings.pipeline.scene.enabled) steps.push(t('run.step.image'));
      else steps.push(`${t('run.step.image')} (${t('run.step.off')})`);
    }

    if (!override.promptOnly && settings.pipeline.scene.enabled && shouldUseRefStage(settings, refs)) {
      steps.push(t('run.step.refs'));
    }

    return steps.join(' → ');
  }

  function updatePipelinePreview(override = {}) {
    const el = document.getElementById('jig-pipeline-preview');
    if (!el) return;
    const settings = getRunSettings(loadSettings());
    const refs = getStoredRefImages();
    el.textContent = t('run.preview', { steps: buildPipelinePreviewSteps(settings, refs, override) });
    const shortcut = document.getElementById('jig-run-shortcut');
    if (shortcut) shortcut.textContent = t('run.shortcut');
  }

  function updateRunButtonLabel() {
    const btn = document.getElementById('jig-run-btn');
    if (!btn) return;
    const settings = getRunSettings(loadSettings());
    if (!settings.pipeline.scene.enabled) {
      btn.textContent = t('btn.getPrompt');
    } else if (!settings.pipeline.prompt.enabled || settings.pipeline.prompt.provider === 'manual' || getCustomPromptFromUI()) {
      btn.textContent = t('btn.generateImage');
    } else {
      btn.textContent = t('btn.generate');
    }
  }

  function updateRunUI() {
    updateRunButtonLabel();
    updatePipelinePreview();
    updatePanelWarnings();
    updateRefStageUI();
  }

  function normalizeOpenAIImageSize(requestedSize, modelId) {
    const allowed = ['1024x1024', '1024x1792', '1792x1024', '256x256', '512x512'];
    if (allowed.includes(requestedSize)) return requestedSize;
    const m = (modelId || '').toLowerCase();
    if (m.includes('dall-e-3')) {
      if (requestedSize && requestedSize.includes('x')) {
        const [w, h] = requestedSize.split('x').map(Number);
        if (w > h) return '1792x1024';
        if (h > w) return '1024x1792';
      }
      return '1024x1024';
    }
    return '1024x1024';
  }

  function applyPresetToForm(presetId) {
    const preset = CONFIG_PRESETS[presetId];
    if (!preset?.pipeline) return;

    const p = preset.pipeline;
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    };
    const setCheck = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.checked = val;
    };

    setCheck('jig-pipeline-prompt-enabled', p.prompt.enabled);
    set('jig-pipeline-prompt-provider', p.prompt.provider);
    setCheck('jig-pipeline-scene-enabled', p.scene.enabled);
    set('jig-pipeline-scene-provider', p.scene.provider);
    setCheck('jig-pipeline-ref-enabled', p.refEdit.enabled);
    set('jig-pipeline-ref-provider', p.refEdit.provider);
    updateSettingsTabVisibility();
    updateRunUI();
    if (p.prompt?.provider === 'openai_compat' || p.scene?.provider === 'openai_compat') {
      maybeSwitchToApisTab();
    }
  }

  function switchSettingsTab(tabId) {
    document.querySelectorAll('.jig-settings-tab').forEach((btn) => {
      btn.classList.toggle('jig-tab-active', btn.getAttribute('data-tab') === tabId);
    });
    document.querySelectorAll('.jig-tab-panel').forEach((panel) => {
      panel.classList.toggle('jig-tab-visible', panel.getAttribute('data-tab-panel') === tabId);
    });
  }

  function setApiBlockState(blockId, active, badgeKey) {
    const el = document.getElementById(blockId);
    if (!el) return;
    el.classList.remove('jig-api-hidden');
    el.classList.toggle('jig-api-inactive', !active);
    const badge = el.querySelector('.jig-api-badge');
    if (badge) {
      badge.textContent = active ? `● ${t(badgeKey)}` : `○ ${t('settings.apiInactive')}`;
      badge.classList.toggle('jig-api-badge-active', active);
    }
  }

  function updateVeniceApiBlock(sceneEnabled, sceneProvider, refEnabled, refProvider) {
    const veniceScene = sceneEnabled && sceneProvider === 'venice';
    const veniceRef = refEnabled && refProvider === 'venice';
    const active = veniceScene || veniceRef;
    const el = document.getElementById('jig-api-venice');
    if (!el) return;
    el.classList.remove('jig-api-hidden');
    el.classList.toggle('jig-api-inactive', !active);
    const badge = el.querySelector('.jig-api-badge');
    if (badge) {
      if (active) {
        const parts = [];
        if (veniceScene) parts.push(t('settings.apiStage2'));
        if (veniceRef) parts.push(t('settings.apiStage3'));
        badge.textContent = `● ${parts.join(' · ')}`;
        badge.classList.add('jig-api-badge-active');
      } else {
        badge.textContent = `○ ${t('settings.apiInactive')}`;
        badge.classList.remove('jig-api-badge-active');
      }
    }
  }

  function updateSettingsTabVisibility() {
    const promptEnabled = document.getElementById('jig-pipeline-prompt-enabled')?.checked !== false;
    const sceneEnabled = document.getElementById('jig-pipeline-scene-enabled')?.checked !== false;
    const refEnabled = document.getElementById('jig-pipeline-ref-enabled')?.checked !== false;
    const promptProvider = document.getElementById('jig-pipeline-prompt-provider')?.value;
    const sceneProvider = document.getElementById('jig-pipeline-scene-provider')?.value;
    const refProvider = document.getElementById('jig-pipeline-ref-provider')?.value;

    setApiBlockState('jig-api-openrouter', promptEnabled && promptProvider === 'openrouter', 'settings.apiStage1');
    setApiBlockState('jig-api-openai-prompt', promptEnabled && promptProvider === 'openai_compat', 'settings.apiStage1');
    updateVeniceApiBlock(sceneEnabled, sceneProvider, refEnabled, refProvider);
    setApiBlockState('jig-api-openai-image', sceneEnabled && sceneProvider === 'openai_compat', 'settings.apiStage2');
    document.getElementById('jig-api-venice-ref')?.classList.toggle('jig-api-hidden', refProvider !== 'venice');
  }

  function maybeSwitchToApisTab() {
    const promptProvider = document.getElementById('jig-pipeline-prompt-provider')?.value;
    const sceneProvider = document.getElementById('jig-pipeline-scene-provider')?.value;
    if (promptProvider === 'openai_compat' || sceneProvider === 'openai_compat') {
      switchSettingsTab('apis');
    }
  }

  function loadProviderConfig(id) {
    const base = PROVIDER_DEFAULTS[id] ? { ...PROVIDER_DEFAULTS[id] } : {};
    try {
      const saved = GM_getValue(`provider_${id}`, '');
      if (saved) Object.assign(base, JSON.parse(saved));
    } catch (_) { /* ignore */ }
    return base;
  }

  function saveProviderConfig(id, config) {
    GM_setValue(`provider_${id}`, JSON.stringify(config));
  }

  function migrateToV2() {
    if (GM_getValue('settingsV2', false)) return;
    const orKey = GM_getValue('openrouterKey', '');
    const vKey = GM_getValue('veniceKey', '');
    if (orKey) {
      saveProviderConfig('openrouter', {
        ...loadProviderConfig('openrouter'),
        apiKey: orKey,
        model: GM_getValue('openrouterModel', DEFAULTS.openrouterModel),
      });
    }
    if (vKey) {
      saveProviderConfig('venice', {
        ...loadProviderConfig('venice'),
        apiKey: vKey,
        baseUrl: GM_getValue('veniceBaseUrl', DEFAULTS.veniceBaseUrl),
        sceneModel: GM_getValue('veniceModel', DEFAULTS.veniceModel),
        editModel: GM_getValue('veniceEditModel', DEFAULTS.veniceEditModel),
        safeMode: GM_getValue('safeMode', DEFAULTS.safeMode),
      });
    }
    GM_setValue('settingsV2', true);
  }

  function applyLocaleToUI() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      const val = t(key);
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        if (el.hasAttribute('data-i18n-placeholder')) el.placeholder = val;
      } else {
        el.textContent = val;
      }
    });
    document.querySelectorAll('[data-i18n-lang]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n-lang'));
    });
    document.querySelectorAll('[data-i18n-option]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n-option'));
    });
    const presetSelect = document.getElementById('jig-preset-select');
    if (presetSelect) {
      [...presetSelect.options].forEach((opt) => {
        const preset = CONFIG_PRESETS[opt.value];
        if (preset?.labelKey) opt.textContent = t(preset.labelKey);
      });
    }
    const status = document.getElementById('jig-status');
    if (status && !status.textContent.trim()) status.textContent = t('app.ready');
    refreshModelSelectLabels();
    updateRunButtonLabel();
  }

  const STYLE_PRESETS = {
    furry_anthro: {
      label: 'Furry / Anthro',
      veniceModel: 'flux-2-pro',
      veniceEditModel: 'flux-2-max-edit',
      openrouterExtra: 'Art style: anthropomorphic furry characters (animal-human hybrids), illustrated digital art, visual novel / furry fandom style. NOT realistic humans. NOT photographs. NOT real animals on four legs. Describe species traits (ears, tail, muzzle, fur/scales colors) from character notes.',
      openrouterEnd: 'Output must describe an illustrated furry anthro scene with bipedal anthropomorphic characters, never photorealistic humans, never a normal pet dog or cat.',
      enrichSuffix: 'anthropomorphic furry characters, bipedal humanoid with animal features, illustrated digital art, visual novel style, detailed fur ears tail muzzle, NOT photorealistic, NOT real pet animal, NOT quadruped',
      editKeep: 'Image 1 is the complete two-character scene from step 1. NEVER replace image 1 with a reference portrait. PRESERVE both characters, hug/interaction, poses, background, lighting, and layout exactly.',
      editRef: (name) => `Image {n} is reference for ${name}. ONLY adjust their face, ears, fur colors and species details inside image 1. Do NOT change pose, do NOT remove the other character, do NOT turn into solo portrait.`,
      editEnd: 'Two characters must remain hugging/interacting as in image 1. Illustrated furry anthro style. Never solo pinup facing camera.',
    },
    anime: {
      label: 'Anime / Manga',
      veniceModel: 'flux-2-pro',
      veniceEditModel: 'flux-2-max-edit',
      openrouterExtra: 'Art style: anime/manga illustration, cel-shaded, NOT photorealistic, NOT photographs.',
      openrouterEnd: 'Anime illustration style only.',
      enrichSuffix: 'anime illustration, detailed linework, expressive, NOT photorealistic',
      editKeep: 'Image 1 is the scene. KEEP composition, poses, environment, and anime art style exactly.',
      editRef: (name) => `Image {n} is reference for ${name}. Match their face, hair, outfit, and anime art style from the reference in image 1. Keep pose from image 1.`,
      editEnd: 'Consistent anime illustration style throughout.',
    },
    realistic: {
      label: 'Реализм (фото)',
      veniceModel: 'lustify-v7',
      veniceEditModel: 'flux-2-max-edit',
      openrouterExtra: 'Art style: photorealistic cinematic photography.',
      openrouterEnd: 'Photorealistic cinematic style.',
      enrichSuffix: 'photorealistic, cinematic lighting, detailed environment, natural skin',
      editKeep: 'Image 1 is the scene. KEEP composition, poses, environment, lighting, and mood exactly.',
      editRef: (name) => `Image {n} is reference for ${name}. Match face, hair, skin tone, and body proportions in image 1 to the reference. Keep pose from image 1.`,
      editEnd: 'Photorealistic natural blend.',
    },
  };

  const EDIT_MODEL_FALLBACKS = [
    'flux-2-max-edit',
    'qwen-edit-uncensored',
    'qwen-image-2-pro-edit',
    'grok-imagine-quality-edit',
  ];

  function isExplicitScene(text) {
    return /\b(nude|naked|topless|undress|sex|intercourse|penetration|bare chest|without clothes)\b/i.test(text || '');
  }

  const HUG_PATTERN = /\b(hug(?:ging|ged|s)?|embrac(?:e|ing|ed|es)?|arms (?:around|tightly)|wrapped (?:her|his|their) arms|holding (?:each other|him|her|you) tightly|clutch(?:ing|ed)?|buried (?:her|his|their) face|around (?:his|her|your) waist|tight embrace|pull(?:ed|s|ing)? (?:him|her|you) close|обним|объят|прижал[аи]?|обнял[аи]?|крепко (?:держ|приж)|hugging back)\b/i;

  function analyzeInteraction(context, persona) {
    const last = context?.lastText || '';
    const ctx = `${context?.contextTranscript || ''}\n${last}`;
    const lastLower = last.toLowerCase();
    const ctxLower = ctx.toLowerCase();
    const embraceInLast = HUG_PATTERN.test(last);
    const embraceInCtx = HUG_PATTERN.test(ctx);
    const emotionalPayoff = /\b(cry|tear|sob|trembl|shake|whisper|beautiful idiot|hold(?:ing)? (?:you|him|her)|clutch|buried (?:her|his|their) face)\b/i.test(lastLower)
      && /\b(hug|embrac|confess|love|arms|pull(?:ed|s)? (?:him|her|you) close)\b/i.test(ctxLower);
    const embrace = embraceInLast || emotionalPayoff;
    const twoChar = embrace || embraceInCtx || /\bboth\b/i.test(lastLower) || /\b(two|together|each other)\b/i.test(lastLower);
    return { embrace, twoChar, embraceInCtx, emotionalPayoff };
  }

  function extractSceneSetting(context) {
    const last = (context?.lastText || '').toLowerCase();
    const ctx = (context?.contextTranscript || '').toLowerCase();
    if (/\b(classroom|school desk|chalkboard|lesson|teacher)\b/.test(last)) {
      return 'school classroom';
    }
    if (/\b(bedroom|dark room|dim room|radiator|private room)\b/.test(last)) {
      return 'dim bedroom, warm low light, intimate';
    }
    if (/\b(hallway|corridor)\b/.test(last)) {
      return 'dim indoor hallway';
    }
    if (/\b(bedroom|dark room|dim room|radiator|private room)\b/.test(ctx)) {
      return 'dim bedroom or private room, warm low light';
    }
    if (/\b(hallway|corridor)\b/.test(ctx) && !/\b(classroom|school desk)\b/.test(ctx)) {
      return 'dim indoor hallway';
    }
    return 'indoor private space, soft dim lighting';
  }

  function buildCompositionLock(context, persona) {
    const u = persona.userCharName || 'character A';
    const a = persona.aiCharName || 'character B';
    const { embrace, twoChar } = analyzeInteraction(context, persona);

    if (twoChar || embrace) {
      return `${u} and ${a}, two bipedal anthropomorphic furry characters hugging together, both full bodies visible, medium wide shot, side angle, emotional embrace`;
    }
    return `${u} and ${a} together in the same scene`;
  }

  function shouldSkipRefFacePass(context, settings, persona) {
    if (!settings.pipeline?.refEdit?.enabled || settings.pipeline?.refEdit?.provider === 'none') {
      return { skip: true, reason: 'reference stage disabled' };
    }
    if (!settings.refFacePass) {
      return { skip: true, reason: 'disabled in panel' };
    }
    return { skip: false };
  }

  function getImageDimensions(settings, context, persona) {
    const { embrace, twoChar } = analyzeInteraction(context, persona);
    if (embrace || twoChar) {
      return { width: 1216, height: 832 };
    }
    return { width: settings.imageWidth, height: settings.imageHeight };
  }

  function buildNegativePrompt(settings, context) {
    const parts = ['blurry, deformed, bad anatomy, extra limbs'];
    const { embrace, twoChar } = analyzeInteraction(context, personaFromContext(context));

    if (twoChar || embrace) {
      parts.push('solo, single character, alone, one person, pinup, portrait, looking at viewer, facing camera, breaking fourth wall, arched back, surprised face, open mouth gasp, school uniform, anime schoolgirl pose, real dog, pet dog, quadruped animal, wolf, husky, normal cat, empty corridor, doors only, no characters');
    }
    if (!isExplicitScene(context?.lastText)) {
      parts.push('nude, naked, topless, nipples, explicit nudity, lingerie');
    }
    parts.push('classroom, school desk, chalkboard, students, academic setting');
    if (settings.artStyle !== 'realistic') {
      parts.push('human, photorealistic, realistic photo, human skin, photograph');
    }
    return clampVenicePrompt(parts.join(', '), 800);
  }

  function personaFromContext(context) {
    return context?.persona || {};
  }

  function postProcessScenePrompt(scenePrompt, settings, persona, context) {
    let text = (scenePrompt || '').replace(/\s+/g, ' ').trim();
    const uName = persona.userCharName || 'Player';
    const aName = persona.aiCharName || 'Character';

    if (settings.artStyle !== 'realistic') {
      const uApp = truncateText(persona.userCharAppearance, 90);
      const aApp = truncateText(persona.aiCharAppearance, 90);
      text = text
        .replace(/\b(human|person|woman|man|boy|girl)\b/gi, 'anthro character')
        .replace(/\bhair\b/gi, 'fur')
        .replace(/\bskin\b/gi, 'fur');
      const prefix = `${uName} (${uApp || 'anthro'}), ${aName} (${aApp || 'anthro'}), furry anthro illustration, both characters in frame, `;
      if (!text.toLowerCase().includes('anthro') && !text.toLowerCase().includes('furry')) {
        text = prefix + text;
      }
    }

    if (!isExplicitScene(context.lastText)) {
      text += ' Both characters fully clothed. Emotional scene, not nude, not pinup.';
    }

    const { embrace } = analyzeInteraction(context, persona);
    if (embrace) {
      text += ` ${persona.userCharName || 'A'} and ${persona.aiCharName || 'B'} hugging together, eyes closed or on each other, side view medium wide shot.`;
    }

    const lock = buildCompositionLock(context, persona);
    text = `${lock}. ${text}`;

    return text.trim();
  }

  function getStylePreset(artStyle) {
    return STYLE_PRESETS[artStyle] || STYLE_PRESETS.furry_anthro;
  }

  function getRunSettings(settings) {
    const stylePreset = getStylePreset(settings.artStyle);
    const customModels = GM_getValue('useCustomVeniceModels', false);
    const venice = settings.providers?.venice || loadProviderConfig('venice');
    return {
      ...settings,
      stylePreset,
      veniceKey: venice.apiKey,
      veniceBaseUrl: (venice.baseUrl || DEFAULTS.veniceBaseUrl).replace(/\/$/, ''),
      safeMode: venice.safeMode ?? settings.safeMode ?? false,
      openrouterKey: settings.providers?.openrouter?.apiKey || '',
      openrouterModel: settings.providers?.openrouter?.model || DEFAULTS.openrouterModel,
      veniceModel: customModels ? settings.veniceModel : stylePreset.veniceModel,
      veniceEditModel: customModels ? settings.veniceEditModel : stylePreset.veniceEditModel,
    };
  }

  const cfg = { token: null, busy: false };
  const floatImgState = { active: false, scale: 1, baseWidth: 280, drag: null, src: '' };

  function applyFloatZoom(wrap, floatImg) {
    if (!wrap || !floatImg) return;
    const imgW = Math.round(floatImgState.baseWidth * floatImgState.scale);
    floatImg.style.width = `${imgW}px`;
    floatImg.style.maxWidth = 'none';
    wrap.style.width = `${imgW + 16}px`;
    wrap.style.maxWidth = 'none';
  }

  function getResultImageSrc() {
    if (floatImgState.active && floatImgState.src) return floatImgState.src;
    const img = document.getElementById('jig-result-img');
    if (img?.src && img.style.display !== 'none') return img.src;
    return GM_getValue('lastImageDataUrl', '');
  }

  function downloadImageSrc(src) {
    if (!src) return;
    const ext = src.startsWith('data:image/png') ? 'png'
      : src.startsWith('data:image/jpeg') ? 'jpg' : 'webp';
    const a = document.createElement('a');
    a.href = src;
    a.download = `janitor-scene-${Date.now()}.${ext}`;
    a.click();
  }

  function hideImageContextMenu() {
    document.getElementById('jig-img-context-menu')?.classList.remove('jig-visible');
  }

  function showImageContextMenu(x, y, mode) {
    ensureFloatingImageUi();
    const menu = document.getElementById('jig-img-context-menu');
    if (!menu) return;
    menu.querySelector('[data-action="float"]')?.classList.toggle('jig-menu-hidden', mode !== 'panel');
    menu.querySelector('[data-action="dock"]')?.classList.toggle('jig-menu-hidden', mode !== 'float');
    menu.style.left = `${Math.min(x, window.innerWidth - 200)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 120)}px`;
    menu.classList.add('jig-visible');
    applyLocaleToUI();
  }

  function ensureFloatingImageUi() {
    if (!document.getElementById('jig-img-context-menu')) {
      const menu = document.createElement('div');
      menu.id = 'jig-img-context-menu';
      menu.className = 'jig-context-menu';
      menu.innerHTML = `
        <button type="button" data-action="download" data-i18n="btn.download">Download</button>
        <button type="button" data-action="float" data-i18n="float.menuFloat">Floating mode</button>
        <button type="button" data-action="dock" data-i18n="float.menuDock">Return to panel</button>
      `;
      document.body.appendChild(menu);
      menu.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;
        const action = btn.getAttribute('data-action');
        hideImageContextMenu();
        if (action === 'download') downloadImageSrc(getResultImageSrc());
        else if (action === 'float') openFloatingImage(getResultImageSrc());
        else if (action === 'dock') dockFloatingImage();
      });
    }

    if (document.getElementById('jig-float-wrap')) return;

    const wrap = document.createElement('div');
    wrap.id = 'jig-float-wrap';
    wrap.innerHTML = `
      <div class="jig-float-toolbar">
        <span class="jig-float-title" data-i18n="float.title">Scene</span>
        <button type="button" class="jig-float-close" aria-label="Close">×</button>
      </div>
      <div class="jig-float-body">
        <img class="jig-float-img" alt="Generated scene" draggable="false" />
      </div>
      <div class="jig-float-hint" data-i18n="float.controls">LMB drag · wheel zoom</div>
    `;
    document.body.appendChild(wrap);

    const floatImg = wrap.querySelector('.jig-float-img');

    wrap.querySelector('.jig-float-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      dockFloatingImage();
    });

    wrap.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showImageContextMenu(e.clientX, e.clientY, 'float');
    });

    wrap.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.jig-float-close')) return;
      floatImgState.drag = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        origX: wrap.getBoundingClientRect().left,
        origY: wrap.getBoundingClientRect().top,
      };
      wrap.setPointerCapture(e.pointerId);
      wrap.classList.add('jig-float-dragging');
      e.preventDefault();
    });

    wrap.addEventListener('pointermove', (e) => {
      if (!floatImgState.drag || floatImgState.drag.pointerId !== e.pointerId) return;
      wrap.style.left = `${floatImgState.drag.origX + e.clientX - floatImgState.drag.startX}px`;
      wrap.style.top = `${floatImgState.drag.origY + e.clientY - floatImgState.drag.startY}px`;
    });

    const endDrag = (e) => {
      if (!floatImgState.drag || floatImgState.drag.pointerId !== e.pointerId) return;
      floatImgState.drag = null;
      wrap.classList.remove('jig-float-dragging');
      try { wrap.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    };
    wrap.addEventListener('pointerup', endDrag);
    wrap.addEventListener('pointercancel', endDrag);

    wrap.addEventListener('wheel', (e) => {
      if (!floatImgState.active) return;
      e.preventDefault();
      e.stopPropagation();
      const step = e.deltaY < 0 ? 0.15 : -0.15;
      floatImgState.scale = Math.max(0.25, floatImgState.scale + step);
      applyFloatZoom(wrap, floatImg);
    }, { passive: false, capture: true });
  }

  function setPanelFloatPlaceholder(visible) {
    const img = document.getElementById('jig-result-img');
    const ph = document.getElementById('jig-result-float-placeholder');
    if (img) img.style.display = visible ? 'none' : '';
    if (ph) ph.style.display = visible ? 'block' : 'none';
  }

  function openFloatingImage(src) {
    if (!src) return;
    ensureFloatingImageUi();
    const wrap = document.getElementById('jig-float-wrap');
    const floatImg = wrap?.querySelector('.jig-float-img');
    if (!wrap || !floatImg) return;

    floatImgState.src = src;
    floatImg.src = src;
    floatImgState.scale = 1;
    floatImgState.baseWidth = 280;

    const w = 300;
    wrap.style.left = `${Math.max(16, window.innerWidth - w - 32)}px`;
    wrap.style.top = `${Math.max(80, Math.round(window.innerHeight * 0.15))}px`;
    applyFloatZoom(wrap, floatImg);

    wrap.classList.add('jig-float-visible');
    floatImgState.active = true;
    setPanelFloatPlaceholder(true);
    applyLocaleToUI();
  }

  function dockFloatingImage() {
    hideImageContextMenu();
    document.getElementById('jig-float-wrap')?.classList.remove('jig-float-visible');
    floatImgState.active = false;
    floatImgState.drag = null;
    setPanelFloatPlaceholder(false);
    const panelImg = document.getElementById('jig-result-img');
    if (panelImg && floatImgState.src) panelImg.src = floatImgState.src;
  }

  function closeFloatingImage() {
    dockFloatingImage();
    floatImgState.src = '';
  }

  function syncFloatingImageSrc(src) {
    if (!floatImgState.active || !src) return;
    floatImgState.src = src;
    const floatImg = document.querySelector('#jig-float-wrap .jig-float-img');
    if (floatImg) floatImg.src = src;
  }

  function initFloatingImageControls() {
    ensureFloatingImageUi();
    const img = document.getElementById('jig-result-img');
    if (!img || img.dataset.floatBound === '1') return;
    img.dataset.floatBound = '1';
    img.title = t('float.hint');

    img.addEventListener('contextmenu', (e) => {
      if (!img.src || (img.style.display === 'none' && !floatImgState.active)) return;
      e.preventDefault();
      showImageContextMenu(e.clientX, e.clientY, floatImgState.active ? 'float' : 'panel');
    });

    document.getElementById('jig-result-float-placeholder')?.addEventListener('contextmenu', (e) => {
      if (!floatImgState.active) return;
      e.preventDefault();
      showImageContextMenu(e.clientX, e.clientY, 'float');
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#jig-img-context-menu')) hideImageContextMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        hideImageContextMenu();
        if (floatImgState.active) dockFloatingImage();
      }
    });
  }

  function loadSettings() {
    migrateToV2();
    locale = GM_getValue('locale', DEFAULTS.locale);
    const providers = {
      openrouter: loadProviderConfig('openrouter'),
      openai_prompt: loadProviderConfig('openai_prompt'),
      venice: loadProviderConfig('venice'),
      openai_image: loadProviderConfig('openai_image'),
    };

    const pipeline = {
      prompt: {
        enabled: GM_getValue('pipelinePromptEnabled', DEFAULTS.pipelinePromptEnabled),
        provider: GM_getValue('pipelinePromptProvider', DEFAULTS.pipelinePromptProvider),
      },
      scene: {
        enabled: GM_getValue('pipelineSceneEnabled', DEFAULTS.pipelineSceneEnabled),
        provider: GM_getValue('pipelineSceneProvider', DEFAULTS.pipelineSceneProvider),
      },
      refEdit: {
        enabled: GM_getValue('pipelineRefEnabled', DEFAULTS.pipelineRefEnabled),
        provider: GM_getValue('pipelineRefProvider', DEFAULTS.pipelineRefProvider),
      },
    };

    return {
      locale,
      pipeline,
      providers,
      openrouterKey: providers.openrouter.apiKey,
      veniceKey: providers.venice.apiKey,
      veniceBaseUrl: (providers.venice.baseUrl || DEFAULTS.veniceBaseUrl).replace(/\/$/, ''),
      openrouterModel: providers.openrouter.model || DEFAULTS.openrouterModel,
      veniceModel: (() => {
        const saved = providers.venice.sceneModel || GM_getValue('veniceModel', DEFAULTS.veniceModel);
        if (saved === 'flux-dev-uncensored' || saved === 'flux-dev') return DEFAULTS.veniceModel;
        if (saved === 'wai-Illustrious' && !GM_getValue('useCustomVeniceModels', false) && !GM_getValue('veniceModelMigrated150', false)) {
          GM_setValue('veniceModelMigrated150', true);
          return DEFAULTS.veniceModel;
        }
        return saved;
      })(),
      veniceEditModel: (() => {
        const saved = providers.venice.editModel || GM_getValue('veniceEditModel', DEFAULTS.veniceEditModel);
        if ((saved === 'qwen-edit-uncensored' || saved === 'qwen-edit') && !GM_getValue('useCustomVeniceModels', false) && !GM_getValue('veniceEditModelMigrated160', false)) {
          GM_setValue('veniceEditModelMigrated160', true);
          return DEFAULTS.veniceEditModel;
        }
        return saved;
      })(),
      safeMode: providers.venice.safeMode ?? GM_getValue('safeMode', DEFAULTS.safeMode),
      messageCount: Number(GM_getValue('messageCount', DEFAULTS.messageCount)) || DEFAULTS.messageCount,
      imageWidth: Number(GM_getValue('imageWidth', DEFAULTS.imageWidth)) || DEFAULTS.imageWidth,
      imageHeight: Number(GM_getValue('imageHeight', DEFAULTS.imageHeight)) || DEFAULTS.imageHeight,
      qualityTwoStep: GM_getValue('qualityTwoStep', DEFAULTS.qualityTwoStep),
      refFacePass: (() => {
        if (!GM_getValue('refFacePassMigrated151', false)) {
          GM_setValue('refFacePass', true);
          GM_setValue('refFacePassMigrated151', true);
          return true;
        }
        return GM_getValue('refFacePass', DEFAULTS.refFacePass);
      })(),
      artStyle: GM_getValue('artStyle', DEFAULTS.artStyle),
      userCharName: GM_getValue('userCharName', DEFAULTS.userCharName),
      userCharAppearance: GM_getValue('userCharAppearance', DEFAULTS.userCharAppearance),
      aiCharName: GM_getValue('aiCharName', DEFAULTS.aiCharName),
      aiCharAppearance: GM_getValue('aiCharAppearance', DEFAULTS.aiCharAppearance),
      customScenePrompt: GM_getValue('customScenePrompt', DEFAULTS.customScenePrompt),
    };
  }

  function saveSettings(settings) {
    Object.entries(settings).forEach(([key, value]) => GM_setValue(key, value));
  }

  function savePersonaFields() {
    saveSettings({
      userCharName: document.getElementById('jig-user-name')?.value.trim() || '',
      userCharAppearance: document.getElementById('jig-user-appearance')?.value.trim() || '',
      aiCharName: document.getElementById('jig-ai-name')?.value.trim() || '',
      aiCharAppearance: document.getElementById('jig-ai-appearance')?.value.trim() || '',
      artStyle: document.getElementById('jig-art-style')?.value || DEFAULTS.artStyle,
      customScenePrompt: getCustomPromptFromUI(),
    });
  }

  function applyArtStyle(styleId) {
    const preset = STYLE_PRESETS[styleId];
    if (!preset) return;
    GM_setValue('artStyle', styleId);
    if (!GM_getValue('useCustomVeniceModels', false)) {
      GM_setValue('veniceModel', preset.veniceModel);
      GM_setValue('veniceEditModel', preset.veniceEditModel);
    }
  }

  function loadPersonaFieldsIntoUI() {
    const s = loadSettings();
    const map = [
      ['jig-user-name', s.userCharName],
      ['jig-user-appearance', s.userCharAppearance],
      ['jig-ai-name', s.aiCharName],
      ['jig-ai-appearance', s.aiCharAppearance],
    ];
    map.forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el && val) el.value = val;
    });
    const customEl = document.getElementById('jig-custom-prompt');
    if (customEl && s.customScenePrompt) customEl.value = s.customScenePrompt;
    const styleEl = document.getElementById('jig-art-style');
    if (styleEl) styleEl.value = s.artStyle || DEFAULTS.artStyle;
  }

  function formatError(err) {
    if (!err) return 'Неизвестная ошибка';
    if (typeof err === 'string') return err;
    if (err instanceof Error && err.message) return err.message;
    if (typeof err?.message === 'string') return err.message;
    try {
      return JSON.stringify(err);
    } catch (_) {
      return String(err);
    }
  }

  function gmRequest(options) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        ...options,
        onload(resp) {
          if (resp.status === 0) {
            reject(new Error(`Запрос заблокирован: ${options.url || 'API'}. Проверьте @connect в Tampermonkey.`));
            return;
          }
          resolve(resp);
        },
        onerror() {
          reject(new Error(`Сетевая ошибка запроса: ${options.url || 'API'}`));
        },
        ontimeout: () => reject(new Error('Таймаут запроса')),
      });
    });
  }

  function truncateText(text, maxLen) {
    if (!text || text.length <= maxLen) return text || '';
    return `${text.slice(0, maxLen)}…`;
  }

  function extractMessageContent(message) {
    if (!message) return '';
    const content = message.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map((part) => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text' || part?.type === 'output_text') return part.text || '';
        return '';
      }).filter(Boolean).join('\n');
    }
    return String(content || '');
  }

  function extractScenePrompt(raw) {
    let text = (raw || '').trim();
    text = text.replace(/[\s\S]*?<\/think>/gi, '').trim();

    const craftQuoted = text.match(/Let's craft:\s*[\n\r]*"([\s\S]*?)"/i);
    if (craftQuoted?.[1]?.trim()) return craftQuoted[1].trim();

    const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
    const sceneParts = paragraphs.filter((p) => (
      p.length > 60
      && !/^We need to|^Must |^Rules:|^PRIORITY|^Let's craft|^The user prompt|^Output ONLY/i.test(p)
    ));
    if (sceneParts.length) {
      return sceneParts[sceneParts.length - 1].replace(/^["'`]+|["'`]+$/g, '').trim();
    }

    const inlineQuote = text.match(/"([A-Za-z][^"]{50,})"/);
    if (inlineQuote?.[1]) return inlineQuote[1].trim();

    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 60);
    if (lines.length) return lines[lines.length - 1].replace(/^["'`]+|["'`]+$/g, '').trim();

    return text.replace(/^["'`]+|["'`]+$/g, '').trim();
  }

  function parseRefImage(stored) {
    if (!stored) return null;
    const base64 = stored.includes(',') ? stored.split(',')[1] : stored;
    return { dataUrl: stored.startsWith('data:') ? stored : `data:image/jpeg;base64,${stored}`, base64 };
  }

  function getStoredRefImages() {
    return {
      user: parseRefImage(GM_getValue('userRefImage', '')),
      ai: parseRefImage(GM_getValue('aiRefImage', '')),
    };
  }

  function hasRefImages(refs) {
    return !!(refs.user || refs.ai);
  }

  async function compressImageFile(file, maxSide = 768) {
    if (!file?.type?.startsWith('image/')) {
      throw new Error('Выберите файл изображения (JPG, PNG, WebP)');
    }
    if (file.size > 12 * 1024 * 1024) {
      throw new Error('Файл слишком большой (макс. ~12 МБ до сжатия)');
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          resolve({ dataUrl, base64: dataUrl.split(',')[1] });
        };
        img.onerror = () => reject(new Error('Не удалось прочитать изображение'));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error('Ошибка чтения файла'));
      reader.readAsDataURL(file);
    });
  }

  async function handleRefUpload(inputId, previewId, storageKey) {
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    const file = input?.files?.[0];
    if (!file) return;

    try {
      const compressed = await compressImageFile(file);
      GM_setValue(storageKey, compressed.dataUrl);
      if (preview) {
        preview.src = compressed.dataUrl;
        preview.classList.add('jig-ref-visible');
      }
      setStatus('Референс сохранён');
      updatePanelWarnings();
    } catch (err) {
      alert(formatError(err));
      if (input) input.value = '';
    }
  }

  function loadRefPreviews() {
    const refs = getStoredRefImages();
    if (refs.user) {
      const el = document.getElementById('jig-user-ref-preview');
      if (el) { el.src = refs.user.dataUrl; el.classList.add('jig-ref-visible'); }
    }
    if (refs.ai) {
      const el = document.getElementById('jig-ai-ref-preview');
      if (el) { el.src = refs.ai.dataUrl; el.classList.add('jig-ref-visible'); }
    }
  }

  function clearRefImage(storageKey, previewId, inputId) {
    GM_setValue(storageKey, '');
    const preview = document.getElementById(previewId);
    if (preview) {
      preview.removeAttribute('src');
      preview.classList.remove('jig-ref-visible');
    }
    const input = document.getElementById(inputId);
    if (input) input.value = '';
    updatePanelWarnings();
  }

  function findTokenInCookies() {
    try {
      const tokenChunks = [];
      document.cookie.split(';').forEach((c) => {
        const parts = c.trim().split('=');
        if (parts[0]?.startsWith('sb-auth-auth-token.')) {
          const index = parseInt(parts[0].split('.').pop(), 10);
          tokenChunks[index] = decodeURIComponent(parts.slice(1).join('='));
        }
      });
      if (tokenChunks.length > 0) {
        const fullValue = tokenChunks.join('').replace('base64-', '').replace(/-/g, '+').replace(/_/g, '/');
        const sessionObj = JSON.parse(atob(fullValue));
        if (sessionObj?.access_token) return `Bearer ${sessionObj.access_token}`;
      }
    } catch (_) { /* ignore */ }
    return null;
  }

  function findTokenInStorage() {
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
          const item = JSON.parse(localStorage.getItem(key));
          if (item?.access_token) return `Bearer ${item.access_token}`;
        }
      }
    } catch (_) { /* ignore */ }
    return null;
  }

  function findToken() {
    if (cfg.token) return cfg.token;
    return findTokenInCookies() || findTokenInStorage();
  }

  const originalFetch = window.fetch;
  window.fetch = new Proxy(window.fetch, {
    apply(target, thisArg, args) {
      const [, config] = args;
      if (config?.headers && !cfg.token) {
        try {
          let auth;
          if (config.headers instanceof Headers) auth = config.headers.get('Authorization');
          else auth = config.headers.Authorization || config.headers.authorization;
          if (auth?.includes('Bearer')) cfg.token = auth;
        } catch (_) { /* ignore */ }
      }
      return target.apply(thisArg, args);
    },
  });

  function stripHtml(text) {
    return (text || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }

  function isChatPage() {
    return /\/chats\/[a-zA-Z0-9-]+/.test(window.location.pathname);
  }

  function getChatId() {
    return window.location.pathname.match(/\/chats\/([a-zA-Z0-9-]+)/)?.[1] || null;
  }

  async function fetchChatMessages(limit, persona) {
    const chatId = getChatId();
    const token = findToken();
    if (!chatId || !token) {
      throw new Error('Не удалось получить chat ID или токен Janitor. Обновите страницу и отправьте сообщение в чат.');
    }

    const resp = await originalFetch(`https://janitorai.com/hampter/chats/${chatId}`, {
      method: 'GET',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
        'x-app-version': '7.4.9.9.7',
      },
      credentials: 'include',
    });

    if (!resp.ok) throw new Error(`Janitor API: ${resp.status}`);

    const json = await resp.json();
    const msgs = json.chatMessages || json.messages || (Array.isArray(json) ? json : null);
    if (!msgs?.length) throw new Error('В чате нет сообщений');

    msgs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    const userLabel = persona.userCharName || 'You';
    const aiLabel = persona.aiCharName || 'Character';

    return msgs.slice(-limit).map((msg) => ({
      role: msg.is_bot ? 'assistant' : 'user',
      name: msg.is_bot ? aiLabel : userLabel,
      text: stripHtml(msg.message || msg.content || ''),
    })).filter((m) => m.text);
  }

  function extractMessagesFromDom(limit, persona) {
    const nodes = Array.from(document.querySelectorAll('[class*="message"], [data-testid*="message"], article'))
      .map((el) => stripHtml(el.innerText))
      .filter((t) => t.length > 20);

    if (nodes.length < 1) {
      throw new Error('DOM fallback: сообщения не найдены.');
    }

    const userLabel = persona.userCharName || 'You';
    const aiLabel = persona.aiCharName || 'Character';

    return nodes.slice(-limit).map((text, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      name: i % 2 === 0 ? userLabel : aiLabel,
      text,
    }));
  }

  function buildPromptContext(messages, persona) {
    const contextMessages = messages.slice(0, -1);
    const last = messages[messages.length - 1];

    const fullTranscript = messages.map((m, i) => `[${i + 1}] ${m.name}: ${truncateText(m.text, i === messages.length - 1 ? 1200 : 600)}`).join('\n\n');
    const contextTranscript = contextMessages.length
      ? contextMessages.map((m, i) => `[${i + 1}] ${m.name}: ${truncateText(m.text, 600)}`).join('\n\n')
      : '(нет более ранних сообщений в выборке)';

    return {
      fullTranscript,
      contextTranscript,
      lastText: truncateText(last?.text || '', 1200),
      lastSpeaker: last?.name || persona.aiCharName || 'Character',
      lastRole: last?.role || 'assistant',
      persona,
    };
  }

  function buildOpenRouterCompositionHint(context, persona) {
    const lock = buildCompositionLock(context, persona);
    const { embrace } = analyzeInteraction(context, persona);
    const u = persona.userCharName || 'Player';
    const a = persona.aiCharName || 'Character';
    if (!embrace) return `Composition: ${lock}.`;
    return `Composition REQUIRED: ${lock}.
WRONG output example: solo ${a} alone, arched back, open mouth, looking at camera, classroom pinup.
CORRECT output: ${u} and ${a} in medium wide shot, mutual embrace, emotional, ${extractSceneSetting(context)}.
The LAST message describes mutual hugging — both characters embracing. NOT the stunned moment before she hugs back.`;
  }

  function buildManualScenePrompt(context, settings) {
    const persona = context.persona;
    const setting = extractSceneSetting(context);
    const lock = buildCompositionLock(context, persona);
    const core = `${setting}. ${lock}. Scene from the last chat message: ${context.lastText}`;
    return postProcessScenePrompt(core, settings, persona, context);
  }

  function buildPromptMessages(settings, context, refs) {
    const { persona } = context;
    const userName = persona.userCharName || 'Player character';
    const aiName = persona.aiCharName || 'AI character';
    const useRefImages = hasRefImages(refs);
    const preset = settings.stylePreset || getStylePreset(settings.artStyle);
    const userLook = persona.userCharAppearance || 'species and colors not specified — infer from chat if mentioned';
    const aiLook = persona.aiCharAppearance || 'species and colors not specified — infer from chat if mentioned';
    const isIllustrated = settings.artStyle !== 'realistic';

    const lookInstruction = useRefImages && isIllustrated
      ? `Include character species/appearance from notes below (reference art images will be attached — match that illustrated style):
   • ${aiName}: ${truncateText(aiLook, 180)}
   • ${userName}: ${truncateText(userLook, 180)}
   Still describe poses, expressions, emotions in detail.`
      : useRefImages
        ? 'Use character NAMES only for looks (reference photos handle appearance). Still describe expressions and poses in detail.'
        : `Use these fixed appearances:
   • ${aiName}: ${aiLook}
   • ${userName}: ${userLook}`;

    const systemPrompt = `You output ONE English paragraph — a detailed image scene prompt. No reasoning, no planning, no markdown, no quotes wrapping the answer.

${preset.openrouterExtra}

PRIORITY (strict):
1. LAST MESSAGE ONLY = the exact frame to draw. If it describes a response (hugging back, crying, answering), draw THAT outcome — NOT the previous message's moment.
2. If the last message involves two characters interacting, BOTH must be visible in the frame together.
3. Earlier messages = room, lighting, props ONLY if missing from the last message.

FORBIDDEN words in output: human, person, man, woman, boy, girl, hair, skin (use fur, muzzle, anthro, furry instead).

REQUIRED:
- Explicit facial expressions and emotions (fear, tension, desire, anger, etc.)
- Body language and exact poses
- Camera framing (close-up, medium shot, wide shot)
- Spatial layout in the scene

${lookInstruction}
${buildOpenRouterCompositionHint(context, persona)}
NSFW allowed. ${preset.openrouterEnd}`;

    const characterSheets = useRefImages && isIllustrated
      ? `AI character: ${aiName}
Appearance notes: ${aiLook}
Player character: ${userName}
Appearance notes: ${userLook}
Reference art images attached — match illustrated style and species.`
      : useRefImages
        ? `AI character name: ${aiName}
Player character name: ${userName}
(Reference images attached separately.)`
        : `AI character name: ${aiName}
AI appearance: ${aiLook}

Player character name: ${userName}
Player appearance: ${userLook}`;

    const userPrompt = `=== CHARACTERS ===
${characterSheets}

=== CHAT CONTEXT (earlier messages — location, setting, situation) ===
${context.contextTranscript}

=== LAST MESSAGE (DRAW EXACTLY THIS — final frame) ===
Speaker: ${context.lastSpeaker}
Message:
${context.lastText}

Repeat: illustrate ONLY the actions and emotions in the LAST MESSAGE above. If it says she hugs back or cries while embracing, show mutual embrace — not the moment before she reacts.

=== FULL TRANSCRIPT (reference) ===
${context.fullTranscript}

Write the scene prompt now. Emphasize emotions and poses from the last message.`;

    return { systemPrompt, userPrompt };
  }

  async function callChatCompletions(apiConfig, model, messages, isOpenRouter) {
    const baseUrl = (apiConfig.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    const requestBody = (m) => ({
      model: m,
      temperature: 0.65,
      max_tokens: 500,
      ...(isOpenRouter ? { reasoning: { enabled: false } } : {}),
      messages,
    });

    let currentModel = model || apiConfig.model;
    let resp = await gmRequest({
      method: 'POST',
      url: `${baseUrl}/chat/completions`,
      headers: {
        Authorization: `Bearer ${apiConfig.apiKey}`,
        'Content-Type': 'application/json',
        ...(isOpenRouter ? { 'HTTP-Referer': 'https://janitorai.com', 'X-Title': 'Janitor Image Gen' } : {}),
      },
      data: JSON.stringify(requestBody(currentModel)),
      timeout: 120000,
    });

    if (isOpenRouter && resp.status === 404 && currentModel.endsWith(':free')) {
      currentModel = currentModel.replace(/:free$/, '');
      resp = await gmRequest({
        method: 'POST',
        url: `${baseUrl}/chat/completions`,
        headers: {
          Authorization: `Bearer ${apiConfig.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://janitorai.com',
          'X-Title': 'Janitor Image Gen',
        },
        data: JSON.stringify(requestBody(currentModel)),
        timeout: 120000,
      });
    }

    if (resp.status < 200 || resp.status >= 300) {
      let hint = '';
      try {
        const errJson = JSON.parse(resp.responseText);
        const paidSlug = errJson?.error?.message?.match(/use this slug instead: ([^\s"]+)/i)?.[1];
        if (paidSlug) hint = ` → ${paidSlug}`;
      } catch (_) { /* ignore */ }
      throw new Error(`${baseUrl} ${resp.status}: ${resp.responseText?.slice(0, 280)}${hint}`);
    }

    return JSON.parse(resp.responseText);
  }

  async function runPromptStage(settings, context, refs) {
    const provider = settings.pipeline.prompt.provider;
    if (!settings.pipeline.prompt.enabled || provider === 'manual') {
      return buildManualScenePrompt(context, settings);
    }

    const { persona } = context;
    const { systemPrompt, userPrompt } = buildPromptMessages(settings, context, refs);
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    let apiConfig;
    let isOpenRouter = false;
    if (provider === 'openrouter') {
      apiConfig = settings.providers.openrouter;
      isOpenRouter = true;
    } else if (provider === 'openai_compat') {
      apiConfig = settings.providers.openai_prompt;
    } else {
      throw new Error(`Unknown prompt provider: ${provider}`);
    }

    if (!apiConfig.apiKey) throw new Error(t('err.noPromptKey'));

    const data = await callChatCompletions(apiConfig, apiConfig.model, messages, isOpenRouter);
    const choice = data.choices?.[0];
    const rawContent = extractMessageContent(choice?.message);
    const scenePrompt = extractScenePrompt(rawContent);

    if (!scenePrompt || scenePrompt.length < 40) {
      throw new Error(`Prompt API returned empty or too short response. Model: ${data.model || apiConfig.model}`);
    }

    if (choice?.finish_reason === 'length') {
      console.warn('[Janitor Image Gen] Prompt API truncated response (length)');
    }

    return postProcessScenePrompt(
      scenePrompt.replace(/^["'`]+|["'`]+$/g, '').trim(),
      settings,
      persona,
      context,
    );
  }

  async function generateOpenAIImage(apiConfig, prompt, dims) {
    if (!apiConfig.apiKey) throw new Error(t('err.noImageKey'));
    const baseUrl = (apiConfig.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    const model = apiConfig.model || 'dall-e-3';
    const size = normalizeOpenAIImageSize(apiConfig.size || '1024x1024', model);
    const resp = await gmRequest({
      method: 'POST',
      url: `${baseUrl}/images/generations`,
      headers: {
        Authorization: `Bearer ${apiConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      data: JSON.stringify({
        model,
        prompt: clampVenicePrompt(prompt, 4000),
        size,
        response_format: 'b64_json',
      }),
      timeout: 180000,
    });

    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`OpenAI images ${resp.status}: ${resp.responseText?.slice(0, 280)}`);
    }

    const data = JSON.parse(resp.responseText);
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI images: no image in response');
    return `data:image/png;base64,${b64}`;
  }

  async function runSceneStage(settings, scenePrompt, persona, context, refs, onStatus) {
    const provider = settings.pipeline.scene.provider;
    const dims = getImageDimensions(settings, context, persona);
    const outputFormat = shouldUseRefStage(settings, refs) ? 'png' : 'webp';

    if (provider === 'venice') {
      if (!settings.veniceKey) throw new Error(t('err.noImageKey'));
      const model = settings.veniceModel;
      onStatus(t('status.scene', { provider: 'Venice', model }));
      const enriched = enrichScenePrompt(scenePrompt, persona, model, settings.stylePreset, context);
      return {
        imageDataUrl: await generateImageTextOnly(
          settings,
          enriched,
          model,
          buildNegativePrompt(settings, context),
          dims,
          outputFormat,
        ),
        log: `Stage 2 (Venice ${model}): ${enriched}`,
      };
    }

    if (provider === 'openai_compat') {
      const cfg = settings.providers.openai_image;
      if (!cfg.apiKey) throw new Error(t('err.noImageKey'));
      onStatus(t('status.scene', { provider: 'OpenAI', model: cfg.model }));
      const enriched = enrichScenePrompt(scenePrompt, persona, cfg.model, settings.stylePreset, context);
      return {
        imageDataUrl: await generateOpenAIImage(cfg, enriched, dims),
        log: `Stage 2 (OpenAI ${cfg.model}): ${enriched}`,
      };
    }

    throw new Error(`Unknown image provider: ${provider}`);
  }

  async function applyRefEdits(settings, sceneDataUrl, refs, persona, context, onStatus) {
    const skip = shouldSkipRefFacePass(context, settings, persona);
    if (skip.skip) {
      return { imageDataUrl: sceneDataUrl, log: `Stage 3 skipped: ${skip.reason}` };
    }

    const refPasses = [];
    if (refs.user?.base64) refPasses.push({ role: 'user', ref: refs.user, label: persona.userCharName || 'player' });
    if (refs.ai?.base64) refPasses.push({ role: 'ai', ref: refs.ai, label: persona.aiCharName || 'AI' });
    if (!refPasses.length) return { imageDataUrl: sceneDataUrl, log: 'Stage 3: no reference images' };

    let currentDataUrl = sceneDataUrl;
    const editLog = [];
    let editFailures = 0;

    for (let i = 0; i < refPasses.length; i += 1) {
      const pass = refPasses[i];
      const editPrompt = buildSingleRefEditPrompt(persona, pass.role, settings.stylePreset);
      try {
        const { imageDataUrl, modelId } = await veniceMultiEditWithFallback(
          settings,
          [dataUrlToBase64(currentDataUrl), pass.ref.base64],
          editPrompt,
          'auto',
          (tryModel) => onStatus(t('status.ref', { total: refPasses.length, name: pass.label, model: tryModel })),
        );
        currentDataUrl = imageDataUrl;
        editLog.push(`Stage 3.${i + 1} OK (${pass.label}, ${modelId}): ${editPrompt}`);
      } catch (err) {
        editFailures += 1;
        editLog.push(`Stage 3.${i + 1} FAILED (${pass.label}): ${formatError(err)}`);
        onStatus(formatError(err), true);
      }
    }

    const summary = editFailures
      ? `\n⚠ Stage 3: ${editFailures}/${refPasses.length} reference passes failed.`
      : '';
    return { imageDataUrl: currentDataUrl, log: `${editLog.join('\n')}${summary}` };
  }

  async function generateImagePrompt(settings, context, refs) {
    return runPromptStage(settings, context, refs);
  }

  function getVenicePromptLimit(modelId, mode) {
    const m = (modelId || '').toLowerCase();
    if (mode === 'edit') return 8000;
    if (m.includes('lustify') || m.includes('wai-') || m.includes('pony')) return 1500;
    if (m.includes('flux-2') || m.includes('qwen-image')) return 7500;
    return 7500;
  }

  function clampVenicePrompt(prompt, maxLen) {
    const text = (prompt || '').replace(/\s+/g, ' ').trim();
    if (!maxLen || text.length <= maxLen) return text;
    return `${text.slice(0, Math.max(1, maxLen - 1))}…`;
  }

  function getVeniceCfgScale(modelId) {
    const m = (modelId || '').toLowerCase();
    if (m.includes('flux-2')) return 8;
    if (m.includes('wai-') || m.includes('pony')) return 5;
    return 7;
  }

  function enrichScenePrompt(scenePrompt, persona, modelId, stylePreset, context) {
    const preset = stylePreset || getStylePreset(DEFAULTS.artStyle);
    const limit = getVenicePromptLimit(modelId, 'generate');
    const names = [persona.userCharName, persona.aiCharName].filter(Boolean);
    const namesPart = names.length ? `Characters: ${names.join(' and ')}.` : '';

    let appearance = '';
    if (persona.userCharAppearance) {
      appearance += `${persona.userCharName || 'Player'}: ${truncateText(persona.userCharAppearance, 160)}. `;
    }
    if (persona.aiCharAppearance) {
      appearance += `${persona.aiCharName || 'Character'}: ${truncateText(persona.aiCharAppearance, 160)}. `;
    }

    const lock = context ? buildCompositionLock(context, persona) : '';
    const suffix = preset.enrichSuffix;
    const reserved = appearance.length + namesPart.length + lock.length + suffix.length + 24;
    const sceneMax = Math.max(400, limit - reserved);
    const core = clampVenicePrompt(scenePrompt, sceneMax);

    return clampVenicePrompt(`${core} ${appearance}${namesPart}${lock}. ${suffix}`, limit);
  }

  function dataUrlToBase64(dataUrl) {
    return dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  }

  function buildSingleRefEditPrompt(persona, targetRole, stylePreset) {
    const preset = stylePreset || getStylePreset(DEFAULTS.artStyle);
    const isUser = targetRole === 'user';
    const targetName = isUser ? (persona.userCharName || 'player character') : (persona.aiCharName || 'AI character');
    const otherName = isUser ? (persona.aiCharName || 'other character') : (persona.userCharName || 'other character');
    const appearance = truncateText(isUser ? persona.userCharAppearance : persona.aiCharAppearance, 120);

    return [
      'Image 1 is the full scene. Keep background, walls, lighting, environment, embrace pose, and both characters positions exactly.',
      `Only change ${targetName} in image 1 to match face, fur, ears, markings, and species from image 2.`,
      appearance ? `${targetName}: ${appearance}.` : '',
      `Leave ${otherName} unchanged. Do not remove background. Do not crop to solo portrait.`,
      preset.editEnd,
    ].filter(Boolean).join(' ');
  }

  function buildVeniceEditPrompt(scenePrompt, persona, refs, modelId, stylePreset, refImageOffset) {
    const preset = stylePreset || getStylePreset(DEFAULTS.artStyle);
    const limit = getVenicePromptLimit(modelId, 'edit');
    const scenePart = clampVenicePrompt(scenePrompt, Math.min(350, limit - 550));
    const baseOffset = refImageOffset || 1;
    const lines = [`Generate this illustrated scene: ${scenePart}.`];
    let idx = baseOffset;

    if (refs.user) {
      lines.push(preset.editRef(persona.userCharName || 'player character').replace('{n}', String(idx)));
      idx += 1;
    }
    if (refs.ai) {
      lines.push(preset.editRef(persona.aiCharName || 'AI character').replace('{n}', String(idx)));
    }

    lines.push(preset.editEnd);
    return clampVenicePrompt(lines.join(' '), limit);
  }

  function arrayBufferToDataUrl(buffer, mimeType) {
    if (!buffer) throw new Error('Venice: пустой ответ (нет данных изображения)');
    const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer || buffer);
    if (!bytes.length) throw new Error('Venice: пустой файл изображения');
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return `data:${mimeType};base64,${btoa(binary)}`;
  }

  function parseVeniceError(resp) {
    try {
      let text = '';
      if (resp.response instanceof ArrayBuffer) {
        text = new TextDecoder().decode(resp.response).slice(0, 800);
      } else {
        text = resp.responseText?.slice(0, 800) || '';
      }
      const json = JSON.parse(text);
      const err = json.error;
      if (typeof err === 'string') return err;
      if (err?.message) return err.message;
      return json.message || text || `HTTP ${resp.status}`;
    } catch (_) {
      return resp.responseText?.slice(0, 400) || `HTTP ${resp.status}`;
    }
  }

  function getVeniceResponseMeta(resp) {
    const raw = resp.responseHeaders || '';
    const read = (name) => {
      const match = raw.match(new RegExp(`^${name}:\\s*(.+)$`, 'im'));
      return match?.[1]?.trim();
    };
    return {
      contentViolation: read('x-venice-is-content-violation') === 'true',
      blurred: read('x-venice-is-blurred') === 'true',
      adultViolation: read('x-venice-is-adult-model-content-violation') === 'true',
    };
  }

  function buildVeniceEditError(resp, modelId) {
    const meta = getVeniceResponseMeta(resp);
    const base = parseVeniceError(resp);
    const parts = [`Venice multi-edit ${resp.status} (${modelId}): ${base}`];

    if (meta.contentViolation || meta.adultViolation) {
      parts.push('Venice пометила контент как нарушение — edit-модели фильтруют строже, чем flux на шаге 1.');
    } else if (meta.blurred) {
      parts.push('Изображение размыто Safe Venice — отключите Safe mode в ⚙.');
    } else if (resp.status === 500 && /edit failed/i.test(base)) {
      parts.push('Частые причины: цензура edit-модели, несовместимый формат картинки, перегрузка. Скрипт попробует другую модель или вернёт шаг 1.');
    }

    const err = new Error(parts.join(' '));
    err.veniceMeta = { ...meta, modelId, status: resp.status };
    return err;
  }

  function getResponseMimeType(resp) {
    const raw = resp.responseHeaders || '';
    const match = raw.match(/^content-type:\s*([^\s;]+)/im);
    return match?.[1] || 'image/png';
  }

  async function veniceMultiEditOnce(settings, images, prompt, aspectRatio, modelId) {
    const editPrompt = clampVenicePrompt(prompt, getVenicePromptLimit(modelId, 'edit'));
    const body = {
      modelId,
      prompt: editPrompt,
      images,
      safe_mode: settings.safeMode,
      aspect_ratio: aspectRatio || 'auto',
      output_format: 'png',
    };
    if (modelId.includes('gpt-image-2')) {
      body.quality = 'high';
    }

    const resp = await gmRequest({
      method: 'POST',
      url: `${settings.veniceBaseUrl}/image/multi-edit`,
      headers: {
        Authorization: `Bearer ${settings.veniceKey}`,
        'Content-Type': 'application/json',
      },
      data: JSON.stringify(body),
      responseType: 'arraybuffer',
      timeout: 180000,
    });

    if (resp.status < 200 || resp.status >= 300) {
      throw buildVeniceEditError(resp, modelId);
    }

    if (!(resp.response instanceof ArrayBuffer) && !resp.response) {
      throw new Error(`Venice multi-edit (${modelId}): неожиданный формат ответа.`);
    }

    return arrayBufferToDataUrl(resp.response, getResponseMimeType(resp));
  }

  function getEditModelCandidates(primaryModel) {
    return [...new Set([primaryModel, ...EDIT_MODEL_FALLBACKS].filter(Boolean))];
  }

  async function veniceMultiEditWithFallback(settings, images, prompt, aspectRatio, onTry) {
    const models = getEditModelCandidates(settings.veniceEditModel);
    let lastError = null;

    for (const modelId of models) {
      if (onTry) onTry(modelId);
      try {
        return { imageDataUrl: await veniceMultiEditOnce(settings, images, prompt, aspectRatio, modelId), modelId };
      } catch (err) {
        lastError = err;
        console.warn('[Janitor Image Gen] edit model failed:', modelId, err.message);
      }
    }

    throw lastError || new Error('Venice multi-edit: все модели edit не сработали.');
  }

  async function generateImageTwoStep(settings, scenePrompt, refs, persona, onStatus, context) {
    const scene = await runSceneStage(settings, scenePrompt, persona, context, refs, onStatus);
    const ref = await applyRefEdits(settings, scene.imageDataUrl, refs, persona, context, onStatus);
    return {
      imageDataUrl: ref.imageDataUrl,
      venicePrompt: `${scene.log}\n\n${ref.log}`,
    };
  }

  async function generateImageWithRefs(settings, scenePrompt, refs, persona, onStatus, context) {
    const result = await generateImageTwoStep(settings, scenePrompt, refs, persona, onStatus, context);
    return result.imageDataUrl;
  }

  function parseVeniceSuggestedModel(responseText) {
    const match = (responseText || '').match(/Did you mean:\s*([^"?]+)/i);
    if (!match) return null;
    return match[1].split(',')[0].trim();
  }

  async function generateImageTextOnly(settings, prompt, modelOverride, negativePrompt, dimensions, outputFormat = 'webp') {
    if (!prompt || prompt.length < 20) {
      throw new Error('Промпт слишком короткий для Venice');
    }

    let model = modelOverride || settings.veniceModel;
    const promptLimit = getVenicePromptLimit(model, 'generate');
    const safePrompt = clampVenicePrompt(prompt, promptLimit);
    const dims = dimensions || { width: settings.imageWidth, height: settings.imageHeight };

    const url = `${settings.veniceBaseUrl}/image/generate`;
    const body = {
      model,
      prompt: safePrompt,
      negative_prompt: negativePrompt || '',
      width: dims.width,
      height: dims.height,
      safe_mode: settings.safeMode,
      hide_watermark: true,
      format: outputFormat,
      cfg_scale: getVeniceCfgScale(model),
    };

    let resp = await gmRequest({
      method: 'POST',
      url,
      headers: {
        Authorization: `Bearer ${settings.veniceKey}`,
        'Content-Type': 'application/json',
      },
      data: JSON.stringify(body),
      timeout: 180000,
    });

    if (resp.status === 404) {
      const suggested = parseVeniceSuggestedModel(resp.responseText);
      if (suggested && suggested !== model) {
        model = suggested;
        body.model = model;
        resp = await gmRequest({
          method: 'POST',
          url,
          headers: {
            Authorization: `Bearer ${settings.veniceKey}`,
            'Content-Type': 'application/json',
          },
          data: JSON.stringify(body),
          timeout: 180000,
        });
      }
    }

    if (resp.status < 200 || resp.status >= 300) {
      const hint = parseVeniceSuggestedModel(resp.responseText);
      let msg = resp.responseText?.slice(0, 260) || `HTTP ${resp.status}`;
      if (resp.status === 400 && msg.includes('1500')) {
        msg = `Промпт слишком длинный для ${model} (макс. 1500 символов). Обновите скрипт до v1.3.2 или смените модель на flux-2-pro в ⚙.`;
      }
      throw new Error(`Venice ${resp.status}: ${msg}${hint ? ` → ${hint}` : ''}`);
    }

    const data = JSON.parse(resp.responseText);
    const b64 = data.images?.[0];
    if (!b64) throw new Error('Venice не вернул изображение');

    const mime = outputFormat === 'png' ? 'image/png' : outputFormat === 'jpeg' ? 'image/jpeg' : 'image/webp';
    return `data:${mime};base64,${b64}`;
  }

  function setStatus(text, isError = false) {
    const el = document.getElementById('jig-status');
    if (el) {
      el.textContent = typeof text === 'string' ? text : formatError(text);
      el.style.color = isError ? '#ff8a8a' : '#b8c5d6';
    }
  }

  function showResult({ imageDataUrl, prompt, venicePrompt, promptOnly }) {
    const img = document.getElementById('jig-result-img');
    const promptEl = document.getElementById('jig-result-prompt');
    const block = document.getElementById('jig-result-block');
    const downloadBtn = document.getElementById('jig-download-btn');
    const openBtn = document.getElementById('jig-open-tab-btn');
    if (!promptEl || !block) return;

    lastScenePrompt = prompt || '';

    if (img) {
      if (imageDataUrl) {
        img.src = imageDataUrl;
        img.style.display = floatImgState.active ? 'none' : '';
        img.title = t('float.hint');
        floatImgState.src = imageDataUrl;
        syncFloatingImageSrc(imageDataUrl);
        setPanelFloatPlaceholder(floatImgState.active);
      } else {
        img.removeAttribute('src');
        img.style.display = 'none';
        closeFloatingImage();
        setPanelFloatPlaceholder(false);
      }
    }

    if (downloadBtn) downloadBtn.style.display = imageDataUrl ? '' : 'none';
    if (openBtn) openBtn.style.display = imageDataUrl ? '' : 'none';
    const regenBtn = document.getElementById('jig-regenerate-btn');
    if (regenBtn) regenBtn.style.display = '';

    promptEl.textContent = venicePrompt
      ? `${t('result.prompt')}:\n${prompt}\n\n${t('result.pipeline')}:\n${venicePrompt}`
      : prompt;
    block.classList.add('jig-has-result');
    if (imageDataUrl) GM_setValue('lastImageDataUrl', imageDataUrl);
    else GM_setValue('lastImageDataUrl', '');
    GM_setValue('lastScenePrompt', lastScenePrompt);
    GM_setValue('lastPrompt', promptEl.textContent);
    if (promptOnly) setStatus(t('status.promptReady'));
  }

  function openMainPanel() {
    loadPersonaFieldsIntoUI();
    loadRefPreviews();
    applyLocaleToUI();
    updateRunUI();
    document.getElementById('jig-panel')?.classList.add('jig-visible');
  }

  function openSettingsModal() {
    const settings = loadSettings();
    locale = settings.locale;
    const overlay = document.getElementById('jig-settings-overlay');
    if (!overlay) return;

    overlay.querySelector('#jig-set-locale').value = settings.locale;
    overlay.querySelector('#jig-pipeline-prompt-enabled').checked = settings.pipeline.prompt.enabled;
    overlay.querySelector('#jig-pipeline-prompt-provider').value = settings.pipeline.prompt.provider;
    overlay.querySelector('#jig-pipeline-scene-enabled').checked = settings.pipeline.scene.enabled;
    overlay.querySelector('#jig-pipeline-scene-provider').value = settings.pipeline.scene.provider;
    overlay.querySelector('#jig-pipeline-ref-enabled').checked = settings.pipeline.refEdit.enabled;
    overlay.querySelector('#jig-pipeline-ref-provider').value = settings.pipeline.refEdit.provider;

    const or = settings.providers.openrouter;
    overlay.querySelector('#jig-set-openrouter-key').value = or.apiKey;
    overlay.querySelector('#jig-set-openrouter-url').value = or.baseUrl;
    loadModelSelectsFromSettings(settings);

    const oap = settings.providers.openai_prompt;
    overlay.querySelector('#jig-set-openai-prompt-key').value = oap.apiKey;
    overlay.querySelector('#jig-set-openai-prompt-url').value = oap.baseUrl;

    const venice = settings.providers.venice;
    overlay.querySelector('#jig-set-venice-key').value = venice.apiKey;
    overlay.querySelector('#jig-set-venice-url').value = venice.baseUrl;

    overlay.querySelector('#jig-set-safe-mode').checked = venice.safeMode;

    const oai = settings.providers.openai_image;
    overlay.querySelector('#jig-set-openai-image-key').value = oai.apiKey;
    overlay.querySelector('#jig-set-openai-image-url').value = oai.baseUrl;
    overlay.querySelector('#jig-set-openai-image-size').value = oai.size;

    overlay.querySelector('#jig-set-message-count').value = settings.messageCount;
    overlay.querySelector('#jig-set-width').value = settings.imageWidth;
    overlay.querySelector('#jig-set-height').value = settings.imageHeight;
    overlay.querySelector('#jig-set-custom-models').checked = GM_getValue('useCustomVeniceModels', false);
    const presetSelect = document.getElementById('jig-preset-select');
    if (presetSelect) presetSelect.value = GM_getValue('activePreset', 'custom');
    switchSettingsTab('general');
    updateSettingsTabVisibility();
    applyLocaleToUI();
    initHelpDelegation();
    overlay.classList.add('jig-visible');
  }

  function getPersonaFromUI() {
    return {
      userCharName: document.getElementById('jig-user-name')?.value.trim() || '',
      userCharAppearance: document.getElementById('jig-user-appearance')?.value.trim() || '',
      aiCharName: document.getElementById('jig-ai-name')?.value.trim() || '',
      aiCharAppearance: document.getElementById('jig-ai-appearance')?.value.trim() || '',
    };
  }

  async function resolveScenePrompt(settings, context, refs, options = {}) {
    const custom = getCustomPromptFromUI();
    if (custom) {
      return { prompt: custom, logLabel: 'Stage 1 (custom prompt)', usedLlm: false };
    }

    const skipLlm = options.skipLlm
      || !settings.pipeline.prompt.enabled
      || settings.pipeline.prompt.provider === 'manual';

    if (skipLlm) {
      const prompt = buildManualScenePrompt(context, settings);
      return { prompt, logLabel: 'Stage 1 (manual template)', usedLlm: false };
    }

    const prompt = await runPromptStage(settings, context, refs);
    return { prompt, logLabel: 'Stage 1', usedLlm: true };
  }

  async function runGeneration(override = {}) {
    if (cfg.busy) return;

    lastRunMode = { promptOnly: override.promptOnly === true, imageOnly: override.imageOnly === true };

    const settings = getRunSettings(loadSettings());
    const persona = getPersonaFromUI();
    const promptOnly = override.promptOnly === true;
    const imageOnly = override.imageOnly === true;
    const runScene = !promptOnly && (imageOnly || settings.pipeline.scene.enabled);
    const customPrompt = getCustomPromptFromUI();

    if (!persona.aiCharName && !customPrompt) {
      alert(t('err.noAiName'));
      document.getElementById('jig-ai-name')?.focus();
      return;
    }

    const needsLlmKey = !customPrompt
      && !imageOnly
      && settings.pipeline.prompt.enabled
      && settings.pipeline.prompt.provider !== 'manual';

    if (needsLlmKey) {
      const pk = settings.pipeline.prompt.provider === 'openrouter'
        ? settings.providers.openrouter.apiKey
        : settings.providers.openai_prompt.apiKey;
      if (!pk) {
        alert(t('err.noPromptKey'));
        openSettingsModal();
        return;
      }
    }

    if (imageOnly && !settings.pipeline.scene.enabled) {
      alert(t('err.needSceneForImage'));
      openSettingsModal();
      return;
    }

    if (runScene) {
      const imgKey = settings.pipeline.scene.provider === 'venice'
        ? settings.providers.venice.apiKey
        : settings.providers.openai_image.apiKey;
      if (!imgKey) {
        alert(t('err.noImageKey'));
        openSettingsModal();
        return;
      }
    }

    savePersonaFields();
    cfg.busy = true;
    const btn = document.getElementById('jig-run-btn');
    const promptBtn = document.getElementById('jig-prompt-only-btn');
    const imageBtn = document.getElementById('jig-image-only-btn');
    [btn, promptBtn, imageBtn].forEach((b) => { if (b) b.disabled = true; });

    try {
      setStatus(t('status.reading', { n: settings.messageCount }));
      let messages;
      try {
        messages = await fetchChatMessages(settings.messageCount, persona);
      } catch (apiErr) {
        console.warn('[Janitor Image Gen] API fallback:', apiErr);
        messages = extractMessagesFromDom(settings.messageCount, persona);
      }

      if (!messages.length && !getCustomPromptFromUI()) {
        throw new Error(t('err.noMessages'));
      }

      const context = buildPromptContext(messages, persona);
      const refs = getStoredRefImages();

      if (imageOnly && !getCustomPromptFromUI() && !messages.length) {
        throw new Error(t('err.noCustomOrChat'));
      }

      const promptProvider = settings.pipeline.prompt.provider;
      if (!getCustomPromptFromUI() && !imageOnly) {
        setStatus(t('status.prompt', { provider: t(`provider.${promptProvider === 'openai_compat' ? 'openai_compat' : promptProvider}`) }));
      } else if (imageOnly) {
        setStatus(t('status.scene', { provider: settings.pipeline.scene.provider === 'venice' ? 'Venice' : 'OpenAI', model: '…' }));
      }

      const { prompt: scenePrompt, logLabel } = await resolveScenePrompt(settings, context, refs, { skipLlm: imageOnly });
      const pipelineLog = [`${logLabel}: ${scenePrompt}`];

      if (!runScene) {
        showResult({ prompt: scenePrompt, venicePrompt: pipelineLog.join('\n'), promptOnly: true });
        setStatus(t('status.promptReady'));
        return;
      }

      let imageDataUrl;
      const useRefs = shouldUseRefStage(settings, refs);

      if (useRefs) {
        const result = await generateImageTwoStep(settings, scenePrompt, refs, persona, setStatus, context);
        imageDataUrl = result.imageDataUrl;
        pipelineLog.push(result.venicePrompt);
      } else {
        if (hasRefImages(refs) && settings.pipeline.refEdit.enabled && settings.pipeline.refEdit.provider === 'venice' && !settings.refFacePass) {
          pipelineLog.push('Stage 3 skipped: unchecked in panel');
        } else if (hasRefImages(refs) && settings.pipeline.refEdit.enabled && settings.pipeline.refEdit.provider !== 'venice') {
          setStatus(t('warn.refVeniceOnly'), true);
          pipelineLog.push(`Note: ${t('warn.refVeniceOnly')}`);
        }
        const scene = await runSceneStage(settings, scenePrompt, persona, context, refs, setStatus);
        imageDataUrl = scene.imageDataUrl;
        pipelineLog.push(scene.log);
      }

      showResult({ imageDataUrl, prompt: scenePrompt, venicePrompt: pipelineLog.join('\n\n') });
      setStatus(t('app.done'));
    } catch (err) {
      console.error('[Janitor Image Gen]', err);
      const msg = formatError(err);
      setStatus(msg, true);
      alert(msg);
    } finally {
      cfg.busy = false;
      [btn, promptBtn, imageBtn].forEach((b) => { if (b) b.disabled = false; });
      updatePipelinePreview();
    }
  }

  function createUI() {
    if (document.getElementById('jig-root')) return;

    const root = document.createElement('div');
    root.id = 'jig-root';
    root.innerHTML = `
      <div id="jig-toolbar">
        <button id="jig-open-btn" title="Scene generator">🎨</button>
        <button id="jig-settings-btn" title="Settings">⚙</button>
      </div>

      <div id="jig-panel">
        <div id="jig-panel-header">
          <span data-i18n="app.title">Scene generator</span>
          <button id="jig-panel-close" title="Close">×</button>
        </div>

        <label><span data-i18n="app.lang">Language</span>
          <select id="jig-locale-select">
            <option value="ru" data-i18n-lang="lang.ru">Russian</option>
            <option value="en" data-i18n-lang="lang.en">English</option>
          </select>
        </label>

        <label>${labelWithHelp('field.artStyle', 'help.artStyle')}
          <select id="jig-art-style">
            <option value="furry_anthro" data-i18n-option="style.furry">Furry / Anthro</option>
            <option value="anime" data-i18n-option="style.anime">Anime / Manga</option>
            <option value="realistic" data-i18n-option="style.realistic">Realistic</option>
          </select>
        </label>

        <div class="jig-section">
          <div class="jig-section-title" data-i18n="section.user">Your character</div>
          <label><span data-i18n="field.name">Name</span><input id="jig-user-name" type="text" data-i18n-placeholder="field.name" placeholder="Name" /></label>
          <label><span data-i18n="field.ref">Reference</span><input id="jig-user-ref" type="file" accept="image/*" /></label>
          <div class="jig-ref-row">
            <img id="jig-user-ref-preview" class="jig-ref-preview" alt="User ref" />
            <button id="jig-user-ref-clear" type="button" class="jig-ref-clear" data-i18n="btn.clearRef">Remove</button>
          </div>
          <label><span data-i18n="field.appearance">Appearance</span><textarea id="jig-user-appearance" rows="2"></textarea></label>
        </div>

        <div class="jig-section">
          <div class="jig-section-title" data-i18n="section.ai">AI character</div>
          <label><span data-i18n="field.name">Name</span><input id="jig-ai-name" type="text" placeholder="Character name" /></label>
          <label><span data-i18n="field.ref">Reference</span><input id="jig-ai-ref" type="file" accept="image/*" /></label>
          <div class="jig-ref-row">
            <img id="jig-ai-ref-preview" class="jig-ref-preview" alt="AI ref" />
            <button id="jig-ai-ref-clear" type="button" class="jig-ref-clear" data-i18n="btn.clearRef">Remove</button>
          </div>
          <label><span data-i18n="field.appearance">Appearance</span><textarea id="jig-ai-appearance" rows="2"></textarea></label>
        </div>

        <label class="jig-checkbox jig-quality-row">
          ${helpIcon('help.refPass')}
          <input id="jig-ref-face-pass" type="checkbox" checked />
          <span data-i18n="ref.pass">Stage 3: match references</span>
        </label>
        <p class="jig-hint" data-i18n="ref.hint">Stage 3 is Venice-only.</p>
        <div id="jig-warn-box" class="jig-warn-box" style="display:none"></div>

        <label class="jig-custom-prompt-block">${labelWithHelp('field.customPrompt', 'help.customPrompt')}
          <textarea id="jig-custom-prompt" rows="3" data-i18n-placeholder="field.customPrompt" placeholder="Custom prompt"></textarea>
        </label>
        <div class="jig-inline-actions">
          <button id="jig-clear-custom-prompt" type="button" class="jig-link-btn" data-i18n="btn.clearCustomPrompt">Clear</button>
        </div>
        <p class="jig-hint" data-i18n="field.customPromptHint">If filled — stage 1 is skipped.</p>

        <div id="jig-pipeline-preview" class="jig-pipeline-preview"></div>
        <div id="jig-run-shortcut" class="jig-run-shortcut"></div>
        <div class="jig-run-row">
          <button id="jig-run-btn" type="button" data-i18n="btn.generate">Run</button>
          <button id="jig-prompt-only-btn" type="button" class="jig-run-secondary">${helpIcon('help.promptOnlyBtn')}<span data-i18n="btn.promptOnly">Prompt only</span></button>
          <button id="jig-image-only-btn" type="button" class="jig-run-secondary">${helpIcon('help.imageOnlyBtn')}<span data-i18n="btn.imageOnly">Image only</span></button>
        </div>
        <div id="jig-status" data-i18n="app.ready">Ready</div>

        <div id="jig-result-block">
          <img id="jig-result-img" alt="Generated image" />
          <div id="jig-result-float-placeholder" class="jig-float-placeholder" style="display:none" data-i18n="float.activeHint">Floating mode active</div>
          <div id="jig-result-prompt"></div>
          <div id="jig-actions">
            <button id="jig-regenerate-btn" type="button" data-i18n="btn.regenerate" style="display:none">Run again</button>
            <button id="jig-download-btn" type="button" data-i18n="btn.download">Download</button>
            <button id="jig-copy-prompt-btn" type="button" data-i18n="btn.copyPrompt">Copy prompt</button>
            <button id="jig-open-tab-btn" type="button" data-i18n="btn.open">Open</button>
          </div>
        </div>
      </div>

      <div id="jig-settings-overlay">
        <div id="jig-settings-box">
          <div class="jig-settings-header">
            <h3 data-i18n="settings.title">API & pipeline</h3>
            <button type="button" id="jig-settings-close" class="jig-panel-close-btn">×</button>
          </div>

          <div class="jig-settings-tabs">
            <button type="button" class="jig-settings-tab jig-tab-active" data-tab="general" data-i18n="settings.tab.general">General</button>
            <button type="button" class="jig-settings-tab" data-tab="pipeline" data-i18n="settings.tab.pipeline">Pipeline</button>
            <button type="button" class="jig-settings-tab" data-tab="apis" data-i18n="settings.tab.apis">APIs</button>
            <button type="button" class="jig-settings-tab" data-tab="advanced" data-i18n="settings.tab.advanced">More</button>
          </div>

          <div class="jig-settings-body">
            <div class="jig-tab-panel jig-tab-visible" data-tab-panel="general">
              <label>${labelWithHelp('settings.presets', 'help.preset')}<select id="jig-preset-select"></select></label>
              <label><span data-i18n="app.lang">Language</span><select id="jig-set-locale"><option value="ru" data-i18n-lang="lang.ru">Russian</option><option value="en" data-i18n-lang="lang.en">English</option></select></label>
            </div>

            <div class="jig-tab-panel" data-tab-panel="pipeline">
              <p class="jig-settings-intro"><span data-i18n="pipeline.title">Pipeline</span> ${helpIcon('help.pipeline')}</p>
              <p class="jig-settings-note" data-i18n="settings.apiKeysHint">API keys on the APIs tab.</p>
              <button type="button" id="jig-goto-apis" class="jig-link-btn jig-goto-apis" data-i18n="settings.gotoApis">Go to API keys →</button>
              <label class="jig-checkbox">${helpIcon('help.promptStage')}<input id="jig-pipeline-prompt-enabled" type="checkbox" checked /> <span data-i18n="pipeline.prompt">1. Scene prompt</span></label>
              <label><select id="jig-pipeline-prompt-provider">
                <option value="openrouter" data-i18n-option="provider.openrouter">OpenRouter</option>
                <option value="openai_compat" data-i18n-option="provider.openai">OpenAI</option>
                <option value="manual" data-i18n-option="provider.manual">No LLM</option>
              </select></label>
              <label class="jig-checkbox">${helpIcon('help.sceneStage')}<input id="jig-pipeline-scene-enabled" type="checkbox" checked /> <span data-i18n="pipeline.scene">2. Image</span></label>
              <label><select id="jig-pipeline-scene-provider">
                <option value="venice" data-i18n-option="provider.venice">Venice AI</option>
                <option value="openai_compat" data-i18n-option="provider.openai">OpenAI</option>
              </select></label>
              <label class="jig-checkbox">${helpIcon('help.refStage')}<input id="jig-pipeline-ref-enabled" type="checkbox" checked /> <span data-i18n="pipeline.ref">3. References</span></label>
              <label><select id="jig-pipeline-ref-provider"><option value="venice">Venice AI</option><option value="none">Disabled</option></select></label>
            </div>

            <div class="jig-tab-panel" data-tab-panel="apis">
              <p class="jig-settings-note jig-api-note">${helpIcon('help.otherApis')}<span data-i18n="help.otherApis">${t('help.otherApis')}</span></p>
              <p class="jig-settings-note jig-model-note">${helpIcon('help.models')}<span data-i18n="model.costNote">${t('model.costNote')}</span></p>
              <div id="jig-api-openrouter" class="jig-api-block jig-api-inactive">
                <div class="jig-settings-section">OpenRouter <span class="jig-api-badge"></span> ${helpIcon('help.openrouter')}</div>
                <a class="jig-api-link" href="https://openrouter.ai/keys" target="_blank" rel="noopener" data-i18n="link.openrouterKeys">OpenRouter keys →</a>
                <label><span data-i18n="settings.apiKey">API key</span><input id="jig-set-openrouter-key" type="password" autocomplete="off" /></label>
                <label><span data-i18n="settings.baseUrl">Base URL</span><input id="jig-set-openrouter-url" type="text" placeholder="https://openrouter.ai/api/v1" /></label>
                <label><span data-i18n="settings.model">Model</span><select id="jig-set-openrouter-model-select"></select></label>
                <label class="jig-model-custom-wrap"><span data-i18n="settings.modelCustom">Custom model ID</span><input id="jig-set-openrouter-model-custom" type="text" class="jig-model-custom" style="display:none" /></label>
              </div>
              <div id="jig-api-openai-prompt" class="jig-api-block jig-api-inactive">
                <div class="jig-settings-section">OpenAI — prompt <span class="jig-api-badge"></span> ${helpIcon('help.openai')}</div>
                <label><span data-i18n="settings.apiKey">API key</span><input id="jig-set-openai-prompt-key" type="password" autocomplete="off" placeholder="sk-…" /></label>
                <label><span data-i18n="settings.baseUrl">Base URL</span><input id="jig-set-openai-prompt-url" type="text" placeholder="https://api.openai.com/v1" /></label>
                <label><span data-i18n="settings.model">Model</span><select id="jig-set-openai-prompt-model-select"></select></label>
                <label class="jig-model-custom-wrap"><span data-i18n="settings.modelCustom">Custom model ID</span><input id="jig-set-openai-prompt-model-custom" type="text" class="jig-model-custom" style="display:none" /></label>
              </div>
              <div id="jig-api-venice" class="jig-api-block">
                <div class="jig-settings-section">Venice <span class="jig-api-badge"></span> ${helpIcon('help.venice')}</div>
                <a class="jig-api-link" href="https://venice.ai/settings/api" target="_blank" rel="noopener" data-i18n="link.veniceKeys">Venice keys →</a>
                <p class="jig-settings-note jig-venice-note" data-i18n="settings.apiVeniceOptional">Venice optional</p>
                <label><span data-i18n="settings.apiKey">API key</span><input id="jig-set-venice-key" type="password" autocomplete="off" /></label>
                <label><span data-i18n="settings.baseUrl">Base URL</span><input id="jig-set-venice-url" type="text" placeholder="https://api.venice.ai/api/v1" /></label>
                <label><span data-i18n="settings.sceneModel">Scene model</span><select id="jig-set-venice-model-select"></select></label>
                <label class="jig-model-custom-wrap"><span data-i18n="settings.modelCustom">Custom model ID</span><input id="jig-set-venice-model-custom" type="text" class="jig-model-custom" style="display:none" /></label>
                <div id="jig-api-venice-ref">
                  <label><span data-i18n="settings.editModel">Edit model</span><select id="jig-set-venice-edit-model-select"></select></label>
                  <label class="jig-model-custom-wrap"><span data-i18n="settings.modelCustom">Custom model ID</span><input id="jig-set-venice-edit-model-custom" type="text" class="jig-model-custom" style="display:none" /></label>
                </div>
                <label class="jig-checkbox"><input id="jig-set-safe-mode" type="checkbox" /> <span data-i18n="settings.safeMode">Safe mode</span></label>
              </div>
              <div id="jig-api-openai-image" class="jig-api-block jig-api-inactive">
                <div class="jig-settings-section">OpenAI — image <span class="jig-api-badge"></span> ${helpIcon('help.openai')}</div>
                <label><span data-i18n="settings.apiKey">API key</span><input id="jig-set-openai-image-key" type="password" autocomplete="off" placeholder="sk-…" /></label>
                <label><span data-i18n="settings.baseUrl">Base URL</span><input id="jig-set-openai-image-url" type="text" placeholder="https://api.openai.com/v1" /></label>
                <label><span data-i18n="settings.model">Model</span><select id="jig-set-openai-image-model-select"></select></label>
                <label class="jig-model-custom-wrap"><span data-i18n="settings.modelCustom">Custom model ID</span><input id="jig-set-openai-image-model-custom" type="text" class="jig-model-custom" style="display:none" /></label>
                <label><span data-i18n="settings.imageSize">Size</span><input id="jig-set-openai-image-size" type="text" placeholder="1024x1024" /></label>
              </div>
              <button type="button" id="jig-sync-openai-keys" class="jig-link-btn" data-i18n="btn.syncOpenAIKeys">Same key for OpenAI prompt + image</button>
            </div>

            <div class="jig-tab-panel" data-tab-panel="advanced">
              <label class="jig-checkbox"><input id="jig-set-custom-models" type="checkbox" /> <span data-i18n="settings.customModels">Custom Venice models</span></label>
              <label><span data-i18n="settings.messageCount">Messages</span><input id="jig-set-message-count" type="number" min="1" max="50" /></label>
              <label><span data-i18n="settings.width">Width</span><input id="jig-set-width" type="number" min="512" max="1280" step="64" /></label>
              <label><span data-i18n="settings.height">Height</span><input id="jig-set-height" type="number" min="512" max="1280" step="64" /></label>
              <p class="jig-settings-note">${helpIcon('help.connect')}<span data-i18n="help.connect">${t('help.connect')}</span></p>
            </div>
          </div>

          <div id="jig-settings-actions">
            <button id="jig-settings-save" type="button" data-i18n="btn.save">Save</button>
            <button id="jig-settings-cancel" type="button" data-i18n="btn.cancel">Cancel</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(root);
    locale = loadSettings().locale;
    const localeSelect = document.getElementById('jig-locale-select');
    if (localeSelect) {
      localeSelect.value = locale;
      localeSelect.addEventListener('change', () => {
        locale = localeSelect.value;
        GM_setValue('locale', locale);
        applyLocaleToUI();
      });
    }
    applyLocaleToUI();
    loadPersonaFieldsIntoUI();
    loadRefPreviews();
    updateRunUI();
    initModelSelects();
    loadModelSelectsFromSettings(loadSettings());
    initHelpDelegation();
    initFloatingImageControls();

    const presetSelect = document.getElementById('jig-preset-select');
    if (presetSelect) {
      Object.entries(CONFIG_PRESETS).forEach(([id, preset]) => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = t(preset.labelKey);
        presetSelect.appendChild(opt);
      });
      presetSelect.addEventListener('change', () => {
        if (presetSelect.value !== 'custom') {
          applyPresetToForm(presetSelect.value);
          if (presetSelect.value === 'openai_full') switchSettingsTab('apis');
        }
      });
    }

    document.getElementById('jig-goto-apis')?.addEventListener('click', () => switchSettingsTab('apis'));

    document.querySelectorAll('.jig-settings-tab').forEach((btn) => {
      btn.addEventListener('click', () => switchSettingsTab(btn.getAttribute('data-tab')));
    });

    ['jig-pipeline-prompt-provider', 'jig-pipeline-scene-provider', 'jig-pipeline-ref-provider',
      'jig-pipeline-prompt-enabled', 'jig-pipeline-scene-enabled', 'jig-pipeline-ref-enabled'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', () => {
        updateSettingsTabVisibility();
        if (id.includes('provider')) maybeSwitchToApisTab();
      });
    });

    document.getElementById('jig-sync-openai-keys')?.addEventListener('click', () => {
      const key = document.getElementById('jig-set-openai-prompt-key')?.value || '';
      const url = document.getElementById('jig-set-openai-prompt-url')?.value || '';
      const imgKey = document.getElementById('jig-set-openai-image-key');
      const imgUrl = document.getElementById('jig-set-openai-image-url');
      if (imgKey) imgKey.value = key;
      if (imgUrl && url) imgUrl.value = url;
      setStatus(t('settings.saved'));
    });

    document.getElementById('jig-settings-close')?.addEventListener('click', () => {
      document.getElementById('jig-settings-overlay').classList.remove('jig-visible');
    });

    const refFaceBox = document.getElementById('jig-ref-face-pass');
    if (refFaceBox) {
      refFaceBox.checked = loadSettings().refFacePass;
      refFaceBox.addEventListener('change', () => {
        GM_setValue('refFacePass', refFaceBox.checked);
        updatePanelWarnings();
      });
    }

    const styleSelect = document.getElementById('jig-art-style');
    if (styleSelect) {
      styleSelect.addEventListener('change', () => applyArtStyle(styleSelect.value));
    }

    document.getElementById('jig-open-btn').addEventListener('click', openMainPanel);
    document.getElementById('jig-settings-btn').addEventListener('click', openSettingsModal);
    document.getElementById('jig-panel-close').addEventListener('click', () => {
      document.getElementById('jig-panel').classList.remove('jig-visible');
    });
    document.getElementById('jig-run-btn').addEventListener('click', () => runGeneration());
    document.getElementById('jig-prompt-only-btn')?.addEventListener('click', () => {
      updatePipelinePreview({ promptOnly: true });
      runGeneration({ promptOnly: true });
    });
    document.getElementById('jig-image-only-btn')?.addEventListener('click', () => {
      updatePipelinePreview({ imageOnly: true });
      runGeneration({ imageOnly: true });
    });

    document.getElementById('jig-custom-prompt')?.addEventListener('input', () => {
      updateRunUI();
    });
    document.getElementById('jig-custom-prompt')?.addEventListener('blur', savePersonaFields);
    document.getElementById('jig-clear-custom-prompt')?.addEventListener('click', () => {
      const el = document.getElementById('jig-custom-prompt');
      if (el) el.value = '';
      savePersonaFields();
      updateRunUI();
    });

    document.getElementById('jig-regenerate-btn')?.addEventListener('click', () => runGeneration(lastRunMode));

    ['jig-user-name', 'jig-user-appearance', 'jig-ai-name', 'jig-ai-appearance'].forEach((id) => {
      document.getElementById(id)?.addEventListener('blur', savePersonaFields);
    });

    document.getElementById('jig-user-ref')?.addEventListener('change', () => {
      handleRefUpload('jig-user-ref', 'jig-user-ref-preview', 'userRefImage');
    });
    document.getElementById('jig-ai-ref')?.addEventListener('change', () => {
      handleRefUpload('jig-ai-ref', 'jig-ai-ref-preview', 'aiRefImage');
    });
    document.getElementById('jig-user-ref-clear')?.addEventListener('click', () => {
      clearRefImage('userRefImage', 'jig-user-ref-preview', 'jig-user-ref');
    });
    document.getElementById('jig-ai-ref-clear')?.addEventListener('click', () => {
      clearRefImage('aiRefImage', 'jig-ai-ref-preview', 'jig-ai-ref');
    });

    document.getElementById('jig-download-btn').addEventListener('click', () => {
      downloadImageSrc(getResultImageSrc());
    });

    document.getElementById('jig-copy-prompt-btn').addEventListener('click', async () => {
      const text = lastScenePrompt
        || GM_getValue('lastScenePrompt', '')
        || document.getElementById('jig-result-prompt')?.textContent;
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        setStatus(t('status.promptCopied'));
      } catch (_) {
        alert(text);
      }
    });

    document.getElementById('jig-open-tab-btn').addEventListener('click', () => {
      const src = getResultImageSrc();
      if (src) window.open(src, '_blank');
    });

    document.getElementById('jig-settings-save').addEventListener('click', () => {
      locale = document.getElementById('jig-set-locale').value || DEFAULTS.locale;
      GM_setValue('locale', locale);

      GM_setValue('pipelinePromptEnabled', document.getElementById('jig-pipeline-prompt-enabled').checked);
      GM_setValue('pipelinePromptProvider', document.getElementById('jig-pipeline-prompt-provider').value);
      GM_setValue('pipelineSceneEnabled', document.getElementById('jig-pipeline-scene-enabled').checked);
      GM_setValue('pipelineSceneProvider', document.getElementById('jig-pipeline-scene-provider').value);
      GM_setValue('pipelineRefEnabled', document.getElementById('jig-pipeline-ref-enabled').checked);
      GM_setValue('pipelineRefProvider', document.getElementById('jig-pipeline-ref-provider').value);

      saveProviderConfig('openrouter', {
        apiKey: document.getElementById('jig-set-openrouter-key').value.trim(),
        baseUrl: document.getElementById('jig-set-openrouter-url').value.trim() || PROVIDER_DEFAULTS.openrouter.baseUrl,
        model: readModelSelectValue('jig-set-openrouter-model-select', 'jig-set-openrouter-model-custom') || DEFAULTS.openrouterModel,
      });
      saveProviderConfig('openai_prompt', {
        apiKey: document.getElementById('jig-set-openai-prompt-key').value.trim(),
        baseUrl: document.getElementById('jig-set-openai-prompt-url').value.trim() || PROVIDER_DEFAULTS.openai_prompt.baseUrl,
        model: readModelSelectValue('jig-set-openai-prompt-model-select', 'jig-set-openai-prompt-model-custom') || PROVIDER_DEFAULTS.openai_prompt.model,
      });
      saveProviderConfig('venice', {
        apiKey: document.getElementById('jig-set-venice-key').value.trim(),
        baseUrl: document.getElementById('jig-set-venice-url').value.trim() || DEFAULTS.veniceBaseUrl,
        sceneModel: readModelSelectValue('jig-set-venice-model-select', 'jig-set-venice-model-custom') || DEFAULTS.veniceModel,
        editModel: readModelSelectValue('jig-set-venice-edit-model-select', 'jig-set-venice-edit-model-custom') || DEFAULTS.veniceEditModel,
        safeMode: document.getElementById('jig-set-safe-mode').checked,
      });
      saveProviderConfig('openai_image', {
        apiKey: document.getElementById('jig-set-openai-image-key').value.trim(),
        baseUrl: document.getElementById('jig-set-openai-image-url').value.trim() || PROVIDER_DEFAULTS.openai_image.baseUrl,
        model: readModelSelectValue('jig-set-openai-image-model-select', 'jig-set-openai-image-model-custom') || PROVIDER_DEFAULTS.openai_image.model,
        size: document.getElementById('jig-set-openai-image-size').value.trim() || PROVIDER_DEFAULTS.openai_image.size,
      });

      saveSettings({
        messageCount: Number(document.getElementById('jig-set-message-count').value) || DEFAULTS.messageCount,
        imageWidth: Number(document.getElementById('jig-set-width').value) || DEFAULTS.imageWidth,
        imageHeight: Number(document.getElementById('jig-set-height').value) || DEFAULTS.imageHeight,
        veniceModel: readModelSelectValue('jig-set-venice-model-select', 'jig-set-venice-model-custom') || DEFAULTS.veniceModel,
        veniceEditModel: readModelSelectValue('jig-set-venice-edit-model-select', 'jig-set-venice-edit-model-custom') || DEFAULTS.veniceEditModel,
      });
      GM_setValue('useCustomVeniceModels', document.getElementById('jig-set-custom-models').checked);
      GM_setValue('activePreset', document.getElementById('jig-preset-select')?.value || 'custom');

      const panelLocale = document.getElementById('jig-locale-select');
      if (panelLocale) panelLocale.value = locale;
      applyLocaleToUI();
      updateRunUI();
      document.getElementById('jig-settings-overlay').classList.remove('jig-visible');
      setStatus(t('settings.saved'));
    });

    document.getElementById('jig-settings-cancel').addEventListener('click', () => {
      document.getElementById('jig-settings-overlay').classList.remove('jig-visible');
    });

    const lastImage = GM_getValue('lastImageDataUrl', '');
    const lastPrompt = GM_getValue('lastPrompt', '');
    lastScenePrompt = GM_getValue('lastScenePrompt', '');
    if (lastImage) {
      const img = document.getElementById('jig-result-img');
      if (img) {
        img.src = lastImage;
        img.title = t('float.hint');
        floatImgState.src = lastImage;
      }
      document.getElementById('jig-result-prompt').textContent = lastPrompt;
      document.getElementById('jig-result-block')?.classList.add('jig-has-result');
      const regenBtn = document.getElementById('jig-regenerate-btn');
      if (regenBtn) regenBtn.style.display = '';
    }

    const mainInput = document.querySelector('textarea[placeholder^="Type a message"]');
    const toolbar = document.getElementById('jig-toolbar');
    if (mainInput && toolbar) {
      mainInput.addEventListener('focus', () => { toolbar.style.opacity = '0.35'; });
      mainInput.addEventListener('blur', () => { toolbar.style.opacity = '1'; });
    }

    document.addEventListener('keydown', (e) => {
      const panel = document.getElementById('jig-panel');
      if (!panel?.classList.contains('jig-visible')) return;
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !cfg.busy) {
        e.preventDefault();
        runGeneration(lastRunMode);
      }
    });
  }

  GM_addStyle(`
    #jig-root { font-family: system-ui, -apple-system, Segoe UI, sans-serif; }

    #jig-toolbar {
      position: fixed; z-index: 99998;
      left: calc(50% + 22rem); bottom: 18%;
      display: flex; flex-direction: column; gap: 8px;
      transition: opacity 0.2s;
    }
    #jig-toolbar button {
      width: 48px; height: 48px; border: none; border-radius: 50%;
      cursor: pointer; font-size: 22px; color: #fff;
      box-shadow: 0 4px 14px rgba(0,0,0,0.35);
    }
    #jig-open-btn { background: linear-gradient(135deg, #7c3aed, #db2777); }
    #jig-settings-btn { background: #334155; font-size: 18px; }

    #jig-panel, #jig-settings-overlay {
      position: fixed; z-index: 99999;
      opacity: 0; pointer-events: none; transition: opacity 0.2s;
    }
    #jig-panel.jig-visible, #jig-settings-overlay.jig-visible {
      opacity: 1; pointer-events: auto;
    }

    #jig-panel {
      right: 16px; top: 16px;
      width: min(440px, calc(100vw - 32px));
      max-height: calc(100vh - 32px); overflow: auto;
      background: #0f172a; border: 1px solid #334155; border-radius: 12px;
      padding: 14px; color: #e2e8f0;
      box-shadow: 0 12px 40px rgba(0,0,0,0.45);
    }
    #jig-panel-header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 12px; font-weight: 600;
    }
    #jig-panel-close {
      background: transparent; border: none; color: #94a3b8;
      font-size: 22px; cursor: pointer;
    }

    .jig-section { margin-bottom: 12px; }
    .jig-section-title {
      font-size: 11px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.05em; color: #a78bfa; margin-bottom: 6px;
    }
    #jig-panel label {
      display: block; font-size: 12px; margin-bottom: 8px; color: #cbd5e1;
    }
    #jig-panel input[type="text"],
    #jig-panel input[type="password"],
    #jig-panel input[type="number"],
    #jig-panel input[type="file"],
    #jig-panel select,
    #jig-panel textarea,
    #jig-settings-box input[type="text"],
    #jig-settings-box input[type="password"],
    #jig-settings-box input[type="number"],
    #jig-settings-box select,
    #jig-settings-box textarea {
      width: 100%; margin-top: 4px; box-sizing: border-box;
      padding: 8px 10px; border-radius: 8px;
      border: 1px solid #475569 !important;
      background: #1e293b !important;
      color: #f8fafc !important;
      font-family: inherit; font-size: 13px; resize: vertical;
      -webkit-text-fill-color: #f8fafc !important;
    }
    #jig-root input::placeholder,
    #jig-root textarea::placeholder { color: #64748b !important; opacity: 1; }
    #jig-root input:-webkit-autofill,
    #jig-root input:-webkit-autofill:hover,
    #jig-root input:-webkit-autofill:focus {
      -webkit-box-shadow: 0 0 0 1000px #1e293b inset !important;
      -webkit-text-fill-color: #f8fafc !important;
      caret-color: #f8fafc;
    }
    #jig-root select option { background: #1e293b; color: #f8fafc; }

    .jig-ref-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .jig-ref-preview {
      width: 72px; height: 72px; object-fit: cover; border-radius: 8px;
      background: #1e293b; border: 1px solid #475569; display: none;
    }
    .jig-ref-preview.jig-ref-visible { display: block; }
    .jig-ref-clear {
      padding: 6px 10px; border: none; border-radius: 6px;
      background: #475569; color: #e2e8f0; font-size: 11px; cursor: pointer;
    }
    .jig-hint-inline code { color: #a5b4fc; font-size: 10px; }

    .jig-hint-inline {
      font-size: 11px; color: #64748b; margin: 0 0 10px; line-height: 1.4;
    }
    .jig-hint-inline strong { color: #94a3b8; }

    #jig-run-btn {
      width: 100%; padding: 11px; border: none; border-radius: 8px;
      background: linear-gradient(135deg, #7c3aed, #db2777);
      color: #fff; font-weight: 600; cursor: pointer; font-size: 14px;
    }
    #jig-run-btn:disabled { opacity: 0.6; cursor: wait; }

    #jig-status {
      font-size: 12px; color: #b8c5d6; margin: 8px 0; min-height: 16px;
    }

    #jig-result-block { display: none; margin-top: 8px; }
    #jig-result-block.jig-has-result { display: block; }
    #jig-result-img {
      width: 100%; border-radius: 8px; background: #1e293b; display: block;
    }
    .jig-float-placeholder {
      padding: 24px 12px; text-align: center; font-size: 11px; color: #94a3b8;
      border: 2px dashed #6366f1; border-radius: 8px; background: #1e293b;
      line-height: 1.4;
    }

    #jig-float-wrap {
      position: fixed; z-index: 100002;
      background: #0f172a; border: 1px solid #6366f1; border-radius: 10px;
      box-shadow: 0 16px 48px rgba(0,0,0,0.65); display: none; flex-direction: column;
      overflow: visible; max-width: none;
      touch-action: none; user-select: none;
    }
    #jig-float-wrap.jig-float-visible { display: flex; }
    #jig-float-wrap.jig-float-dragging { cursor: grabbing; }
    .jig-float-toolbar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 6px 10px; background: #1e293b; cursor: grab;
      border-bottom: 1px solid #334155; flex-shrink: 0;
    }
    #jig-float-wrap.jig-float-dragging .jig-float-toolbar { cursor: grabbing; }
    .jig-float-title { font-size: 12px; font-weight: 600; color: #e2e8f0; }
    .jig-float-close {
      background: transparent; border: none; color: #94a3b8;
      font-size: 20px; line-height: 1; cursor: pointer; padding: 0 4px;
    }
    .jig-float-close:hover { color: #fff; }
    .jig-float-body {
      padding: 8px; display: flex; align-items: center; justify-content: center;
      background: #0b1220; cursor: grab; overflow: visible;
    }
    #jig-float-wrap.jig-float-dragging .jig-float-body { cursor: grabbing; }
    .jig-float-img {
      height: auto; display: block; pointer-events: none; max-width: none;
    }
    .jig-float-hint {
      font-size: 10px; color: #64748b; padding: 5px 8px; text-align: center;
      border-top: 1px solid #334155; flex-shrink: 0;
    }

    #jig-img-context-menu {
      position: fixed; z-index: 100003; min-width: 180px;
      background: #1e293b; border: 1px solid #475569; border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5); padding: 4px;
      display: none; flex-direction: column;
    }
    #jig-img-context-menu.jig-visible { display: flex; }
    #jig-img-context-menu button {
      background: transparent; border: none; color: #e2e8f0;
      text-align: left; padding: 8px 12px; font-size: 12px; cursor: pointer;
      border-radius: 6px; width: 100%;
    }
    #jig-img-context-menu button:hover { background: #334155; }
    #jig-img-context-menu button.jig-menu-hidden { display: none; }
    .jig-venice-note { margin: -4px 0 8px; font-size: 10px; }
    .jig-model-note { margin-bottom: 10px; font-size: 10px; }
    .jig-model-custom-wrap { margin-top: -4px; }
    #jig-settings-box select { font-size: 11px; }
    .jig-api-link {
      display: inline-block; font-size: 11px; color: #818cf8;
      margin: 0 0 8px; text-decoration: none;
    }
    .jig-api-link:hover { text-decoration: underline; color: #a5b4fc; }
    #jig-result-prompt {
      margin-top: 8px; font-size: 11px; line-height: 1.4; color: #94a3b8;
      max-height: 100px; overflow: auto; white-space: pre-wrap;
    }
    #jig-actions { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
    #jig-actions button {
      flex: 1; min-width: 90px; padding: 8px; border: none; border-radius: 8px;
      background: #1d4ed8; color: #fff; cursor: pointer; font-size: 12px;
    }

    #jig-settings-overlay {
      inset: 0; background: rgba(0,0,0,0.55);
      display: flex; align-items: center; justify-content: center; padding: 12px;
    }
    #jig-settings-box {
      width: min(480px, 100%); max-height: min(85vh, 680px);
      background: #0f172a; border: 1px solid #334155; border-radius: 12px;
      color: #e2e8f0; display: flex; flex-direction: column; overflow: hidden;
      padding: 0;
    }
    .jig-settings-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 14px; border-bottom: 1px solid #334155; flex-shrink: 0;
    }
    .jig-settings-header h3 { margin: 0; font-size: 15px; }
    .jig-panel-close-btn {
      background: transparent; border: none; color: #94a3b8;
      font-size: 22px; cursor: pointer; line-height: 1; padding: 0 4px;
    }
    .jig-settings-tabs {
      display: flex; gap: 4px; padding: 8px 10px 0; flex-shrink: 0;
      border-bottom: 1px solid #334155;
    }
    .jig-settings-tab {
      flex: 1; padding: 8px 6px; border: none; border-radius: 8px 8px 0 0;
      background: transparent; color: #94a3b8; font-size: 11px; cursor: pointer;
    }
    .jig-settings-tab.jig-tab-active {
      background: #1e293b; color: #e2e8f0; font-weight: 600;
    }
    .jig-settings-body {
      flex: 1; overflow-y: auto; padding: 12px 14px; min-height: 0;
    }
    .jig-tab-panel { display: none; }
    .jig-tab-panel.jig-tab-visible { display: block; }
    .jig-api-block.jig-api-hidden { display: none; }
    .jig-settings-intro {
      font-size: 11px; color: #94a3b8; margin: 0 0 10px; display: flex; align-items: center; gap: 6px;
    }
    .jig-label-row { display: inline-flex; align-items: center; gap: 6px; }
    .jig-help-btn {
      width: 18px; height: 18px; min-width: 18px; padding: 0; border-radius: 50%;
      border: 1px solid #6366f1; background: #312e81; color: #c7d2fe;
      font-size: 11px; font-weight: 700; cursor: pointer; line-height: 1;
    }
    .jig-help-btn:hover { background: #4338ca; color: #fff; }
    .jig-checkbox .jig-help-btn { margin-right: 2px; }
    #jig-settings-box h3 { margin: 0; }
    .jig-settings-section {
      font-size: 11px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.05em; color: #a78bfa; margin: 10px 0 8px;
      display: flex; align-items: center; gap: 6px;
    }
    .jig-api-block { margin-bottom: 8px; padding: 8px; border-radius: 8px; border: 1px solid #334155; }
    .jig-api-block.jig-api-inactive { opacity: 0.55; border-color: #1e293b; }
    .jig-api-badge {
      font-size: 9px; font-weight: 600; text-transform: none; letter-spacing: 0;
      color: #64748b; margin-left: auto; margin-right: 6px;
    }
    .jig-api-badge-active { color: #86efac; }
    .jig-goto-apis { margin: 0 0 12px; }
    .jig-link-btn {
      background: none; border: none; color: #818cf8; font-size: 11px;
      cursor: pointer; padding: 0; text-decoration: underline;
    }
    .jig-link-btn:hover { color: #a5b4fc; }
    .jig-inline-actions { margin: -8px 0 8px; text-align: right; }
    .jig-custom-prompt-block { display: block; }
    #jig-settings-box label { display: block; font-size: 12px; margin-bottom: 10px; color: #cbd5e1; }
    .jig-checkbox { display: flex !important; align-items: flex-start; gap: 8px; }
    .jig-checkbox input[type="checkbox"] { width: auto !important; margin: 3px 0 0; flex-shrink: 0; }
    .jig-quality-row { font-size: 11px; color: #94a3b8; margin-bottom: 10px; line-height: 1.35; }
    .jig-hint { font-size: 11px; color: #64748b; margin: -4px 0 12px; line-height: 1.35; }
    .jig-warn-box {
      margin: 0 0 12px; padding: 8px 10px; border-radius: 8px;
      background: rgba(251, 191, 36, 0.12); border: 1px solid rgba(251, 191, 36, 0.35);
    }
    .jig-warn-line { font-size: 11px; color: #fcd34d; line-height: 1.4; margin-bottom: 4px; }
    .jig-warn-line:last-child { margin-bottom: 0; }
    .jig-quality-row.jig-disabled { opacity: 0.55; }
    .jig-api-note { margin-bottom: 12px; }
    .jig-pipeline-preview {
      font-size: 11px; color: #64748b; margin: 0 0 4px; line-height: 1.35;
    }
    .jig-run-shortcut { font-size: 10px; color: #475569; margin: 0 0 10px; }
    .jig-run-row {
      display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; align-items: stretch;
    }
    .jig-run-row #jig-run-btn { flex: 1 1 140px; margin-bottom: 0; }
    .jig-run-secondary {
      flex: 1 1 120px; padding: 10px 8px; border-radius: 8px; border: 1px solid #334155;
      background: #1e293b; color: #cbd5e1; font-size: 11px; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center; gap: 4px;
    }
    .jig-run-secondary:hover { background: #334155; }
    .jig-run-secondary:disabled { opacity: 0.5; cursor: not-allowed; }
    #jig-settings-actions {
      display: flex; gap: 8px; padding: 12px 14px; border-top: 1px solid #334155; flex-shrink: 0;
    }
    #jig-settings-actions button {
      flex: 1; padding: 10px; border: none; border-radius: 8px; cursor: pointer;
    }
    #jig-settings-save { background: #16a34a; color: #fff; }
    #jig-settings-cancel { background: #475569; color: #fff; }
    .jig-settings-note {
      font-size: 11px; color: #fbbf24; margin: 8px 0 4px; line-height: 1.4;
      display: flex; align-items: flex-start; gap: 6px;
    }

    @media (max-width: 900px) {
      #jig-toolbar { left: auto; right: 12px; bottom: 22%; }
    }
  `);

  function init() {
    if (!isChatPage()) return;
    createUI();
  }

  if (document.body) init();
  else window.addEventListener('DOMContentLoaded', init, { once: true });

  setInterval(() => {
    if (isChatPage() && !document.getElementById('jig-root') && document.body) createUI();
  }, 2000);

  console.log('[Janitor Image Gen] v2.1.0 loaded');
})();
