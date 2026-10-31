/**
 * Browser half of the J.A.R.V.I.S. HUD bundle.
 *
 * Two registrations share one module-level bus:
 *  - `shell.overlay`        the full-screen boot scan and the persistent corner HUD.
 *  - `conversation.composer.dock`  a zero-height sensor that republishes the
 *    current session's live state (`running`, in-flight tool calls, last agent
 *    error, blank flag) so the root-scoped HUD can react to it.
 *
 * Reactivity comes from the framework seat `useSession` on the session-scoped
 * sensor; the bus is a plain publish/subscribe pair created at module scope so
 * both components see the same values without a second subscription inside the
 * HUD component itself.
 */
window.__ModuleLoader__.load({
  id: '@local/jarvis-hud',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /* ------------------------------------------------------------------ */
    /* settings                                                            */
    /* ------------------------------------------------------------------ */

    const SETTINGS_KEY = 'jarvis-hud:settings';
    const BOOTED_KEY = 'jarvis-hud:booted';

    /* The Windows caption strip is painted above the page. The desktop shell
     * picks its color from the two tokens below, which it measures in this same
     * document and forwards over its own IPC, so overriding them for the boot
     * makes the strip part of the scan; removing the override restores it. */
    const CHROME_FILL = '#030c14';
    const CHROME_SYMBOL = '#cfefff';

    /* J.A.R.V.I.S. palette. Registering a theme with `colorScheme: 'dark'`
     * makes the built-in dark base palette apply, and these alias-token
     * overrides tint the surfaces cyan on top of it. */
    /* A third-party theme id cannot cross the built-in settings schema, so the
     * preference is pinned to the built-in `dark` — the only value that
     * survives a restart — and the cyan tint rides on a token layer. */
    const THEME_PREFERENCE = 'dark';
    const THEME_CHOICE_KEY = 'jarvis-hud:theme-choice';
    const THEME_PREVIOUS_KEY = 'jarvis-hud:theme-previous';

    const JARVIS_TOKENS = {
      '--dsw-alias-bg-base': '#0c1a24',
      '--dsw-alias-bg-layer-1': '#10242f',
      '--dsw-alias-bg-layer-2': '#14303d',
      '--dsw-alias-bg-overlay': '#0f2733',
      '--dsw-alias-border-l1': 'rgba(120,205,235,0.07)',
      '--dsw-alias-border-l2': 'rgba(120,205,235,0.14)',
      '--dsw-alias-brand-primary': '#4fd8ff',
      '--dsw-alias-label-primary': '#e8f7fd',
      '--dsw-alias-label-secondary': 'rgba(198,232,245,0.66)',
      '--dsw-alias-state-error-primary': '#ff7a7a',
      '--dsw-alias-state-idle-primary': '#7fa9ba',
      '--dsw-alias-state-success-primary': '#4fe0b0',
      '--dsw-alias-state-warn-primary': '#ffcb6b',
      '--dsw-specific-sidebar-fill': '#0a1a24',
    };

    /* A dust ring around the core, laid out by angle so the particles form a
     * band rather than a perfect circle. Idle: every particle twinkles on its
     * own clock. Generating: the delays become a function of angle and radius,
     * so one bright crest travels around the band while a second, softer one
     * follows outward from the centre. */
    const WAVE_PERIOD = 1.15;

    const PARTICLES = (function buildParticles() {
      const items = [];
      const total = 120;
      for (let index = 0; index < total; index += 1) {
        const band = index % 6 === 0 ? 47 : index % 3 === 0 ? 44 : 40;
        const radius = band + ((index * 13) % 9) - 4;
        const angle = (index / total) * Math.PI * 2 + (index % 7) * 0.08;
        const wave = (index / total) * WAVE_PERIOD + ((radius - 37) / 12) * 0.22;
        items.push({
          x: Math.round((50 + Math.cos(angle) * radius) * 100) / 100,
          y: Math.round((50 + Math.sin(angle) * radius) * 100) / 100,
          size: Math.round((1.2 + ((index * 7) % 5) * 0.6) * 100) / 100,
          duration: Math.round((2 + ((index * 5) % 9) * 0.35) * 100) / 100,
          delay: Math.round(((index * 11) % 17) * 0.19 * 100) / 100,
          wave: Math.round(wave * 1000) / 1000,
          peak: Math.round((0.45 + ((index * 3) % 6) * 0.09) * 100) / 100,
        });
      }
      return items;
    })();

    let themeService = null;

    function readStore(key) {
      try {
        return window.localStorage.getItem(key);
      } catch (error) {
        /* Storage refusal only costs persistence. */
        console.warn('[jarvis-hud] storage read failed', key, error);
        return null;
      }
    }

    function writeStore(key, value) {
      try {
        window.localStorage.setItem(key, value);
      } catch (error) {
        console.warn('[jarvis-hud] storage write failed', key, error);
      }
    }

    /* The master switch owns the whole appearance, so a disabled plugin must not
     * tint anything or re-assert the dark preference on load either. */
    function themeWanted() {
      if (!bus.settings.enabled) return false;
      return readStore(THEME_CHOICE_KEY) !== 'off';
    }

    const THEME_STYLE_ID = 'jarvis-hud-theme';

    /* Written as a plain `body` rule rather than through the theme service: the
     * base palette is durable through the preference, but this tint has to be
     * re-applied on every load anyway, and `!important` beats the sheet that
     * declares the same tokens on `body`. */
    function setThemeLayer(on) {
      const existing = document.getElementById(THEME_STYLE_ID);
      if (!on) {
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
        return;
      }
      if (existing) return;
      const style = document.createElement('style');
      style.id = THEME_STYLE_ID;
      style.setAttribute('data-jarvis-theme', '');
      const declarations = Object.keys(JARVIS_TOKENS).map(function (name) {
        return name + ':' + JARVIS_TOKENS[name] + ' !important';
      }).join(';');
      style.textContent = 'body{' + declarations + '}';
      document.head.appendChild(style);
    }

    const GLASS_ATTR = 'data-jh-glass';

    function clearGlass() {
      document.querySelectorAll('[' + GLASS_ATTR + ']').forEach(function (node) {
        node.removeAttribute(GLASS_ATTR);
      });
    }

    /* The app's class names are hashed per build, so both surfaces are located
     * by structure and marked with an attribute React does not manage; the
     * stylesheet then targets `[data-jh-glass]`. */
    const GLASS_NAV_TEXT = ['新会话', '新建会话', '新建对话', 'New session', 'New chat'];

    function findComposerCard() {
      /* `data-input-scroll` is a hand-written hook in the composer source and
       * sits directly inside the card, so the card is its parent. */
      const scroll = document.querySelector('[data-input-scroll]');
      if (scroll && scroll.parentElement) return scroll.parentElement;
      const input = document.querySelector('textarea');
      if (!input) return null;
      let node = input.parentElement;
      for (let depth = 0; node && node !== document.body && depth < 8; depth += 1) {
        if (node.getBoundingClientRect().width >= 320 && node.querySelector('button') !== null) return node;
        node = node.parentElement;
      }
      return null;
    }

    function findNavRows() {
      const rows = [];
      const expression = GLASS_NAV_TEXT.map(function (label) {
        return 'normalize-space(text())="' + label + '"';
      }).join(' or ');
      let snapshot;
      try {
        snapshot = document.evaluate('//*[' + expression + ']', document, null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      } catch (error) {
        /* XPath refusal only costs the sidebar surface. */
        console.warn('[jarvis-hud] nav lookup failed', error);
        return rows;
      }
      for (let index = 0; index < snapshot.snapshotLength; index += 1) {
        const node = snapshot.snapshotItem(index);
        if (node === null) continue;
        const row = node.closest('button,a,[role="button"]');
        /* Only the clickable surface itself, and only the outermost of a
         * nested match, so one row never collects several frames. */
        if (row === null || rows.indexOf(row) !== -1) continue;
        rows.push(row);
      }
      return rows.filter(function (row) {
        return !rows.some(function (other) {
          return other !== row && other.contains(row);
        });
      });
    }

    function tagGlassSurfaces() {
      if (!bus.settings.enabled) {
        clearGlass();
        return;
      }
      const card = findComposerCard();
      document.querySelectorAll('[' + GLASS_ATTR + '="composer"]').forEach(function (node) {
        if (node !== card) node.removeAttribute(GLASS_ATTR);
      });
      if (card && card.getAttribute(GLASS_ATTR) !== 'composer') card.setAttribute(GLASS_ATTR, 'composer');

      const rows = findNavRows();
      document.querySelectorAll('[' + GLASS_ATTR + '="nav"]').forEach(function (node) {
        if (rows.indexOf(node) === -1) node.removeAttribute(GLASS_ATTR);
      });
      rows.forEach(function (row) {
        if (row.getAttribute(GLASS_ATTR) !== 'nav') row.setAttribute(GLASS_ATTR, 'nav');
      });
    }

    function themeIsJarvis() {
      if (!themeService) return false;
      try {
        return themeWanted() && themeService.getTheme().preference === THEME_PREFERENCE;
      } catch (error) {
        console.warn('[jarvis-hud] theme read failed', error);
        return false;
      }
    }

    function restoreThemePreference() {
      if (!themeService) return;
      try {
        if (themeService.getTheme().preference !== THEME_PREFERENCE) return;
        themeService.setTheme(readStore(THEME_PREVIOUS_KEY) || 'light');
      } catch (error) {
        console.warn('[jarvis-hud] theme restore failed', error);
      }
    }

    function applyTheme(on) {
      if (!themeService) return;
      setThemeLayer(on);
      try {
        if (!on) {
          restoreThemePreference();
          return;
        }
        const current = themeService.getTheme().preference;
        if (current === THEME_PREFERENCE) return;
        writeStore(THEME_PREVIOUS_KEY, current);
        themeService.setTheme(THEME_PREFERENCE);
      } catch (error) {
        console.warn('[jarvis-hud] theme switch failed', error);
      }
    }

    let themeGraceUntil = 0;

    /* Only the preference needs re-asserting: a refetched settings section can
     * replace it after we switch, while the token layer restacks on its own. */
    function assertTheme() {
      if (!themeService || !themeWanted()) return;
      try {
        if (themeService.getTheme().preference === THEME_PREFERENCE) return;
        themeService.setTheme(THEME_PREFERENCE);
      } catch (error) {
        console.warn('[jarvis-hud] theme re-assert failed', error);
      }
    }

    const DEFAULT_SETTINGS = {
      enabled: true,
      hud: true,
      boot: true,
      bootMs: 5000,
      lang: 'en',
      voiceURI: '',
      rate: 0.95,
      muted: false,
    };

    function readSettings() {
      try {
        const raw = window.localStorage.getItem(SETTINGS_KEY);
        if (!raw) return Object.assign({}, DEFAULT_SETTINGS);
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return Object.assign({}, DEFAULT_SETTINGS);
        return Object.assign({}, DEFAULT_SETTINGS, parsed);
      } catch (error) {
        /* Unreadable or malformed saved settings must not block the interface. */
        console.warn('[jarvis-hud] settings unreadable, using defaults', error);
        return Object.assign({}, DEFAULT_SETTINGS);
      }
    }

    const bus = {
      settings: readSettings(),
      live: {
        running: false,
        tool: false,
        error: null,
        sessionId: null,
        blank: false,
        subtitle: '',
        replayBoot: 0,
        chat: null,
        chatTop: null,
      },
      listeners: new Set(),
    };

    function emit(patch) {
      bus.live = Object.assign({}, bus.live, patch);
      bus.listeners.forEach(function (listener) { listener(); });
    }

    function saveSettings(patch) {
      bus.settings = Object.assign({}, bus.settings, patch);
      try {
        window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(bus.settings));
      } catch (error) {
        /* Private-mode storage refusal only costs persistence, not the feature. */
        console.warn('[jarvis-hud] settings not persisted', error);
      }
      emit({});
    }

    function useBus() {
      const [, force] = React.useState(0);
      React.useEffect(function () {
        const listener = function () { force(function (n) { return n + 1; }); };
        bus.listeners.add(listener);
        return function () { bus.listeners.delete(listener); };
      }, []);
      return bus;
    }

    /* ------------------------------------------------------------------ */
    /* speech                                                              */
    /* ------------------------------------------------------------------ */

    const LINES = {
      en: {
        boot: 'All systems online, sir. Beginning retrieval sweep.',
        session: 'New session.',
        thinking: 'Scanning.',
        tool: 'Accessing.',
        done: 'Complete.',
        error: 'Warning. Anomaly detected.',
      },
      zh: {
        boot: '系统已就绪，先生。开始检索。',
        session: '新会话。',
        thinking: '扫描中。',
        tool: '接入中。',
        done: '完成。',
        error: '警告，检测到异常。',
      },
    };

    function textOf(key) {
      const table = LINES[bus.settings.lang] || LINES.en;
      return table[key] || LINES.en[key] || '';
    }

    let subtitleTimer = 0;
    function showSubtitle(text) {
      if (!text) return;
      emit({ subtitle: text });
      window.clearTimeout(subtitleTimer);
      subtitleTimer = window.setTimeout(function () { emit({ subtitle: '' }); }, 2600);
    }

    const VOICE_HINTS = {
      en: ['daniel', 'george', 'arthur', 'google uk english male', 'microsoft ryan', 'microsoft guy', 'microsoft george', 'alex', 'oliver', 'thomas'],
      zh: ['yunxi', 'yunjian', 'kangkang', 'huihui', 'ting-ting', 'tingting', 'google 普通话', 'liang', 'yaoyao'],
    };

    let voices = [];

    function refreshVoices() {
      try {
        const synth = window.speechSynthesis;
        if (!synth) return;
        voices = Array.prototype.slice.call(synth.getVoices() || []);
      } catch (error) {
        /* getVoices throws before the engine is ready in a few embedded browsers. */
        console.warn('[jarvis-hud] voice list unavailable', error);
        voices = [];
      }
    }

    function supportedVoices(lang) {
      const prefix = lang === 'zh' ? 'zh' : 'en';
      return voices.filter(function (voice) {
        return String(voice.lang || '').toLowerCase().indexOf(prefix) === 0;
      });
    }

    function pickVoice() {
      const lang = bus.settings.lang;
      const wanted = bus.settings.voiceURI;
      if (wanted) {
        const exact = voices.filter(function (voice) { return voice.voiceURI === wanted; })[0];
        if (exact) return exact;
      }
      const scoped = supportedVoices(lang);
      const pool = scoped.length ? scoped : voices;
      const hints = VOICE_HINTS[lang] || VOICE_HINTS.en;
      for (let index = 0; index < hints.length; index += 1) {
        const hint = hints[index];
        const hit = pool.filter(function (voice) {
          return String(voice.name || '').toLowerCase().indexOf(hint) >= 0;
        })[0];
        if (hit) return hit;
      }
      return pool[0] || null;
    }

    let unlocked = false;
    let pendingLine = '';
    let lastText = '';
    let lastAt = 0;

    function armUnlock() {
      if (unlocked) return;
      function onGesture() {
        unlocked = true;
        window.removeEventListener('pointerdown', onGesture, true);
        window.removeEventListener('keydown', onGesture, true);
        if (pendingLine) {
          const line = pendingLine;
          pendingLine = '';
          utter(line, true);
        }
      }
      window.addEventListener('pointerdown', onGesture, true);
      window.addEventListener('keydown', onGesture, true);
    }

    function utter(text, replay) {
      const synth = window.speechSynthesis;
      const Utterance = window.SpeechSynthesisUtterance;
      if (!synth || typeof Utterance !== 'function') return;
      const now = Date.now();
      if (!replay && text === lastText && now - lastAt < 1200) return;
      lastText = text;
      lastAt = now;
      try {
        if (synth.speaking || synth.pending) synth.cancel();
        const utterance = new Utterance(text);
        const voice = pickVoice();
        utterance.lang = voice ? voice.lang : (bus.settings.lang === 'zh' ? 'zh-CN' : 'en-GB');
        if (voice) utterance.voice = voice;
        utterance.rate = bus.settings.rate;
        utterance.pitch = 0.9;
        utterance.volume = 1;
        synth.speak(utterance);
      } catch (error) {
        console.warn('[jarvis-hud] speech failed', error);
        return;
      }
      /* Blocked autoplay produces no error and no `speaking`; retry on first gesture. */
      window.setTimeout(function () {
        if (unlocked) return;
        if (synth.speaking || synth.pending) return;
        pendingLine = text;
        armUnlock();
      }, 350);
    }

    function say(key) {
      const text = textOf(key);
      if (!text) return;
      showSubtitle(text);
      if (!bus.settings.enabled || bus.settings.muted) return;
      utter(text, false);
    }

    function requestBoot() {
      emit({ replayBoot: Date.now() });
    }

    /* ------------------------------------------------------------------ */
    /* boot sequence                                                       */
    /* ------------------------------------------------------------------ */

    const CHECKS = [
      { id: 'link', label: 'LINK HANDSHAKE', note: '链路握手', at: 0.05 },
      { id: 'identity', label: 'IDENTITY VERIFICATION', note: '身份核验', at: 0.16 },
      { id: 'access', label: 'ACCESS PERMISSION', note: '访问许可', at: 0.28 },
      { id: 'memory', label: 'MEMORY INDEX', note: '记忆索引', at: 0.40 },
      { id: 'retrieval', label: 'RETRIEVAL LINK', note: '检索链路', at: 0.52 },
      { id: 'bus', label: 'SESSION BUS', note: '会话总线', at: 0.63 },
      { id: 'cognition', label: 'COGNITION CORE', note: '认知核心', at: 0.74 },
    ];

    /* Each row spends `STEP_SPAN` of the whole boot switching between its
     * "scanning" and "passed" states, so only one row verifies at a time. */
    const STEP_SPAN = 0.075;

    function BootScreen(props) {
      const duration = props.duration;
      const [started, setStarted] = React.useState(0);
      const [lit, setLit] = React.useState(0);
      const [exiting, setExiting] = React.useState(false);
      const doneRef = React.useRef(false);

      const finish = React.useCallback(function () {
        if (doneRef.current) return;
        doneRef.current = true;
        setStarted(CHECKS.length);
        setLit(CHECKS.length);
        setExiting(true);
        window.setTimeout(function () { props.onDone(); }, 380);
      }, [props.onDone]);

      React.useEffect(function () {
        const timers = [];
        CHECKS.forEach(function (check, index) {
          timers.push(window.setTimeout(function () {
            setStarted(function (count) { return Math.max(count, index + 1); });
          }, Math.max(140, duration * check.at)));
          timers.push(window.setTimeout(function () {
            setLit(function (count) { return Math.max(count, index + 1); });
          }, Math.max(240, duration * (check.at + STEP_SPAN))));
        });
        timers.push(window.setTimeout(finish, duration));
        function onKey(event) {
          if (event.key === 'Escape') finish();
        }
        window.addEventListener('keydown', onKey, true);
        return function () {
          timers.forEach(function (timer) { window.clearTimeout(timer); });
          window.removeEventListener('keydown', onKey, true);
        };
      }, [duration, finish]);

      /* The theme declares both tokens on `body`, so a `:root` override never
       * reaches the caption probe: the probe inherits from `body`, whose own
       * declaration shadows anything set further up. Writing them inline on
       * `body` is the only level that wins, and the style attribute change is
       * itself what makes the desktop shell re-measure and repaint the strip. */
      React.useEffect(function () {
        const body = document.body;
        if (!body) return;
        body.style.setProperty('--dsw-specific-sidebar-fill', CHROME_FILL, 'important');
        body.style.setProperty('--dsw-alias-label-primary', CHROME_SYMBOL, 'important');
        return function () {
          body.style.removeProperty('--dsw-specific-sidebar-fill');
          body.style.removeProperty('--dsw-alias-label-primary');
        };
      }, []);

      return h('div', {
        className: 'jh-boot' + (exiting ? ' jh-boot--exit' : ''),
        'aria-label': 'J.A.R.V.I.S. boot sequence',
      },
      h('div', { className: 'jh-boot-hit', onClick: finish }),
      h('div', { className: 'jh-grid' }),
      h('div', { className: 'jh-scan' }),
      h('div', { className: 'jh-checks' },
        h('div', { className: 'jh-checks-head' + (lit >= CHECKS.length ? ' jh-checks-head--granted' : '') },
          lit >= CHECKS.length ? 'ACCESS GRANTED' : 'AUTHENTICATING'),
        CHECKS.map(function (check, index) {
          const state = index < lit ? 'done' : index < started ? 'verifying' : 'pending';
          return h('div', { key: check.id, className: 'jh-check jh-check--' + state },
            h('span', { className: 'jh-dot' }),
            h('span', { className: 'jh-check-label' },
              h('span', { className: 'jh-check-name' }, check.label),
              h('span', { className: 'jh-check-note' }, check.note)),
            h('span', { className: 'jh-check-state' },
              state === 'done' ? 'OK' : state === 'verifying' ? 'SCAN' : '--'));
        })),
      h('div', { className: 'jh-core' },
        h('div', { className: 'jh-radar' },
          h('div', { className: 'jh-sweep' }),
          h('svg', { className: 'jh-ring jh-ring--dash', viewBox: '0 0 260 260', 'aria-hidden': true },
            h('circle', { cx: 130, cy: 130, r: 122, fill: 'none', stroke: 'rgba(110,230,255,.5)', strokeWidth: 1, strokeDasharray: '3 9' })),
          h('svg', { className: 'jh-ring jh-ring--arc', viewBox: '0 0 260 260', 'aria-hidden': true },
            h('circle', { cx: 130, cy: 130, r: 98, fill: 'none', stroke: 'rgba(110,230,255,.62)', strokeWidth: 1.2, strokeDasharray: '70 40' })),
          h('svg', { className: 'jh-ring', viewBox: '0 0 260 260', 'aria-hidden': true },
            h('circle', { cx: 130, cy: 130, r: 74, fill: 'none', stroke: 'rgba(110,230,255,.26)', strokeWidth: 1 }),
            h('circle', { cx: 130, cy: 130, r: 7, fill: 'rgba(160,240,255,.9)' }))),
        h('div', { className: 'jh-core-text' },
          h('div', { className: 'jh-title' }, 'J.A.R.V.I.S'),
          h('div', { className: 'jh-sub' }, 'DEEPSEEK RETRIEVAL INTERFACE'))),
      h('div', { className: 'jh-foot' },
        h('div', { className: 'jh-bar' }, h('i', { style: { animationDuration: duration + 'ms' } })),
        h('div', { className: 'jh-hint' }, 'CLICK OR PRESS ESC TO SKIP')));
    }

    /* ------------------------------------------------------------------ */
    /* live HUD                                                           */
    /* ------------------------------------------------------------------ */

    function cornerNode(position) {
      return h('div', { key: position, className: 'jh-corner jh-' + position, 'aria-hidden': true },
        h('svg', { viewBox: '0 0 120 120' },
          h('g', { fill: 'none', stroke: 'currentColor', strokeWidth: 1 },
            h('path', { d: 'M4 54 Q4 4 54 4', opacity: 0.85 }),
            h('path', { d: 'M4 70 L4 92', opacity: 0.5 }),
            h('path', { d: 'M70 4 L92 4', opacity: 0.5 }),
            h('path', { d: 'M4 108 L4 116 M108 4 L116 4', opacity: 0.35 }),
            h('circle', { cx: 54, cy: 54, r: 2.5, fill: 'currentColor', stroke: 'none' }))));
    }

    const CORNERS = ['tl', 'tr', 'br', 'bl'].map(cornerNode);

    const SPEAKER_PATH = 'M4 9.5v5h3.2L12 18V6L7.2 9.5H4z M16 8.8a4.6 4.6 0 0 1 0 6.4';
    const MUTED_PATH = 'M4 9.5v5h3.2L12 18V6L7.2 9.5H4z M16 9.5l5 5 M21 9.5l-5 5';
    const SLIDERS_PATH = 'M4 8h6 M14 8h6 M4 16h4 M12 16h8';

    function controlButton(key, onClick, path, label) {
      return h('button', {
        key: key,
        type: 'button',
        className: 'jh-btn',
        onClick: onClick,
        title: label,
        'aria-label': label,
        'aria-pressed': key === 'mute' ? Boolean(bus.settings.muted) : undefined,
      },
      h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('path', { d: path })));
    }

    function row(key, label, control) {
      return h('div', { key: key, className: 'jh-row' },
        h('span', { className: 'jh-label' }, label),
        control);
    }

    function toggleButton(key, value, flip) {
      return h('button', {
        key: key,
        type: 'button',
        className: 'jh-toggle' + (value ? ' jh-toggle--on' : ''),
        onClick: flip,
        'aria-pressed': Boolean(value),
      }, value ? 'ON' : 'OFF');
    }

    function SettingsPanel() {
      useBus();
      const settings = bus.settings;
      const [voiceList, setVoiceList] = React.useState(function () { return supportedVoices(settings.lang); });

      React.useEffect(function () {
        refreshVoices();
        setVoiceList(supportedVoices(bus.settings.lang));
        const synth = window.speechSynthesis;
        if (!synth || typeof synth.addEventListener !== 'function') return function () {};
        function onChange() {
          refreshVoices();
          setVoiceList(supportedVoices(bus.settings.lang));
        }
        synth.addEventListener('voiceschanged', onChange);
        return function () { synth.removeEventListener('voiceschanged', onChange); };
      }, [settings.lang]);

      const langSelect = h('select', {
        className: 'jh-select',
        value: settings.lang,
        onChange: function (event) { saveSettings({ lang: event.target.value }); },
      },
      h('option', { value: 'en' }, 'English'),
      h('option', { value: 'zh' }, '中文'));

      const voiceSelect = h('select', {
        className: 'jh-select',
        value: settings.voiceURI,
        onChange: function (event) { saveSettings({ voiceURI: event.target.value }); },
      },
      h('option', { value: '' }, 'AUTO'),
      voiceList.map(function (voice) {
        return h('option', { key: voice.voiceURI, value: voice.voiceURI },
          String(voice.name || voice.voiceURI).slice(0, 28));
      }));

      const rateRange = h('input', {
        className: 'jh-range',
        type: 'range',
        min: 0.7,
        max: 1.15,
        step: 0.05,
        value: settings.rate,
        onChange: function (event) { saveSettings({ rate: Number(event.target.value) }); },
      });

      const bootSelect = h('select', {
        className: 'jh-select',
        value: String(settings.bootMs),
        onChange: function (event) { saveSettings({ bootMs: Number(event.target.value) }); },
      },
      h('option', { value: '1500' }, '1.5 s'),
      h('option', { value: '3000' }, '3 s'),
      h('option', { value: '5000' }, '5 s'),
      h('option', { value: '7000' }, '7 s'));

      return h('div', { className: 'jh-panel', onPointerDown: function (event) { event.stopPropagation(); } },
        h('div', { className: 'jh-panel-title' }, 'J.A.R.V.I.S. CONTROL'),
        row('on', 'PLUGIN', toggleButton('on', settings.enabled, function () {
          const next = !settings.enabled;
          if (!next && typeof window.speechSynthesis !== 'undefined') window.speechSynthesis.cancel();
          saveSettings({ enabled: next });
        })),
        row('voice', 'VOICE', toggleButton('voice', !settings.muted, function () { saveSettings({ muted: !settings.muted }); })),
        row('lang', 'LANGUAGE', langSelect),
        row('pick', 'SPEAKER', voiceSelect),
        row('rate', 'RATE', rateRange),
        row('theme', 'THEME', toggleButton('theme', themeIsJarvis(), function () {
          const next = !themeIsJarvis();
          writeStore(THEME_CHOICE_KEY, next ? 'jarvis' : 'off');
          applyTheme(next);
        })),
        row('hud', 'HUD', toggleButton('hud', settings.hud, function () { saveSettings({ hud: !settings.hud }); })),
        row('boot', 'BOOT', toggleButton('boot', settings.boot, function () { saveSettings({ boot: !settings.boot }); })),
        row('dur', 'BOOT LENGTH', bootSelect),
        h('button', {
          type: 'button',
          className: 'jh-replay',
          onClick: function () {
            say('boot');
            requestBoot();
          },
        }, 'REPLAY BOOT SEQUENCE'));
    }

    function LiveHud() {
      useBus();
      const live = bus.live;
      const settings = bus.settings;

      const [pulseKey, setPulseKey] = React.useState(0);
      const [errored, setErrored] = React.useState(false);
      const [panelOpen, setPanelOpen] = React.useState(false);
      const previous = React.useRef({ running: false, tool: false, error: null, sessionId: null });
      const errorTimer = React.useRef(0);

      React.useEffect(function () {
        const before = previous.current;
        if (live.error && live.error !== before.error) {
          setErrored(true);
          say('error');
          window.clearTimeout(errorTimer.current);
          errorTimer.current = window.setTimeout(function () { setErrored(false); }, 6000);
        }
        if (live.running && !before.running) say('thinking');
        if (live.tool && !before.tool) say('tool');
        if (!live.running && before.running) {
          say('done');
          setPulseKey(function (key) { return key + 1; });
        }
        if (live.sessionId && live.sessionId !== before.sessionId && live.blank) {
          say('session');
          setPulseKey(function (key) { return key + 1; });
        }
        previous.current = {
          running: live.running,
          tool: live.tool,
          error: live.error,
          sessionId: live.sessionId,
        };
      }, [live.running, live.tool, live.error, live.sessionId, live.blank]);

      React.useEffect(function () {
        refreshVoices();
        return function () { window.clearTimeout(errorTimer.current); };
      }, []);

      const status = errored ? 'ANOMALY' : live.tool ? 'ACCESSING' : live.running ? 'RETRIEVAL' : 'IDLE';
      const variant = errored ? ' jh-hud--error' : live.running ? ' jh-hud--thinking' : '';

      return h('div', { className: 'jh-hud' + variant },
        live.chat ? h('div', {
          className: 'jh-chat' + (live.running ? ' jh-chat--active' : ''),
          style: {
            left: live.chat.left + 'px',
            width: Math.max(0, live.chat.right - live.chat.left) + 'px',
            top: live.chatTop != null ? live.chatTop + 'px' : 'var(--dsh-windows-titlebar-height, 0px)',
            bottom: live.chat.bottomInset + 'px',
          },
          'aria-hidden': true,
        },
        h('div', { className: 'jh-energy' },
          h('div', { className: 'jh-energy-halo' }),
          h('div', { className: 'jh-dust' },
            PARTICLES.map(function (particle, index) {
              return h('div', {
                key: 'particle-' + index,
                className: 'jh-particle',
                style: {
                  left: particle.x + '%',
                  top: particle.y + '%',
                  width: particle.size + 'px',
                  height: particle.size + 'px',
                  '--tw': particle.duration + 's',
                  '--td': particle.delay + 's',
                  '--wd': particle.wave + 's',
                  '--po': particle.peak,
                },
              });
            })),
          h('div', { className: 'jh-energy-dot' })),
        h('div', { className: 'jh-cwave' })) : null,
        settings.hud ? CORNERS : null,
        pulseKey ? h('div', { key: 'pulse-' + pulseKey, className: 'jh-pulse', 'aria-hidden': true }) : null,
        (live.running || errored) ? h('div', { className: 'jh-chip' },
          h('span', { className: 'jh-chip-dot' }),
          h('span', null, 'J.A.R.V.I.S · ' + status)) : null,
        live.subtitle ? h('div', { className: 'jh-subtitle' }, live.subtitle) : null,
        h('div', { className: 'jh-controls' },
          controlButton('mute', function () { saveSettings({ muted: !settings.muted }); },
            settings.muted ? MUTED_PATH : SPEAKER_PATH, settings.muted ? 'Unmute J.A.R.V.I.S.' : 'Mute J.A.R.V.I.S.'),
          controlButton('setup', function () { setPanelOpen(function (open) { return !open; }); },
            SLIDERS_PATH, 'J.A.R.V.I.S. settings')),
        panelOpen ? h(SettingsPanel) : null);
    }

    /* ------------------------------------------------------------------ */
    /* session sensor                                                      */
    /* ------------------------------------------------------------------ */

    function Sensor(props) {
      /* One hook call returning the whole snapshot: the installed selector seat
       * and a plain snapshot hook both answer this, while a selector that
       * ignored its argument would still hand back the same object. */
      const snapshot = props.useSession(function (state) { return state; });
      const state = snapshot && typeof snapshot === 'object' ? snapshot : {};
      const running = state.running === true;
      const toolCount = state.runningCalls ? state.runningCalls.length : 0;
      let error = null;
      if (state.lastAgentError) error = 'agent:' + state.lastAgentError;
      else if (state.promptError) error = 'prompt';
      const blank = state.blank === true;
      const sessionId = props.sessionId || null;

      const anchor = React.useRef(null);

      React.useEffect(function () {
        emit({ running: running, tool: toolCount > 0, error: error, sessionId: sessionId, blank: blank });
      }, [running, toolCount, error, blank, sessionId]);

      /* The anchor itself is zero-width inside a flex row, so walk up to the first
       * ancestor wide enough to be the composer column. Only layout is read;
       * no content or styles are queried. */
      React.useEffect(function () {
        const node = anchor.current;
        if (!node) return undefined;
        function columnBox() {
          let element = node;
          for (let depth = 0; element && element !== document.body && depth < 8; depth += 1) {
            const rect = element.getBoundingClientRect();
            if (rect.width >= 320) return rect;
            element = element.parentElement;
          }
          return null;
        }
        function measure() {
          const rect = columnBox();
          if (!rect) return;
          const before = bus.live.chat;
          const next = {
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            bottomInset: Math.round(window.innerHeight - node.getBoundingClientRect().top),
          };
          if (before && before.left === next.left && before.right === next.right
            && before.bottomInset === next.bottomInset) return;
          emit({ chat: next });
        }
        measure();
        const observer = typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(measure) : null;
        /* The anchor is zero-width by design, so watch its row instead: the row
         * follows the column when the sidebar collapses or the window resizes. */
        if (observer) observer.observe(node.parentElement || node);
        window.addEventListener('resize', measure);
        return function () {
          if (observer) observer.disconnect();
          window.removeEventListener('resize', measure);
        };
      }, []);

      return h('div', { ref: anchor, className: 'jh-anchor', 'aria-hidden': true });
    }

    /* The header's bottom edge is where the scrolling content begins, so the
     * decoration starts there instead of at the window top. The anchor is
     * display:none, which costs no layout and still exposes its ancestors. */
    function HeaderSensor() {
      const anchor = React.useRef(null);

      React.useEffect(function () {
        const node = anchor.current;
        if (!node) return undefined;
        function measure() {
          let element = node;
          let top = null;
          for (let depth = 0; element && element !== document.body && depth < 6; depth += 1) {
            const rect = element.getBoundingClientRect();
            if (rect.height >= 90 && rect.height <= 220) {
              top = Math.round(rect.bottom);
              break;
            }
            element = element.parentElement;
          }
          if (top === null || top === bus.live.chatTop) return;
          emit({ chatTop: top });
        }
        measure();
        const observer = typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(measure) : null;
        if (observer) observer.observe(node.parentElement || node);
        window.addEventListener('resize', measure);
        return function () {
          if (observer) observer.disconnect();
          window.removeEventListener('resize', measure);
        };
      }, []);

      return h('div', { ref: anchor, className: 'jh-anchor jh-anchor--hidden', 'aria-hidden': true });
    }

    /* ------------------------------------------------------------------ */
    /* root                                                                */
    /* ------------------------------------------------------------------ */

    function readBooted() {
      try {
        return window.sessionStorage.getItem(BOOTED_KEY) === '1';
      } catch (error) {
        /* Storage refusal means the tab cannot remember; showing the boot again is safe. */
        return false;
      }
    }

    function markBooted() {
      try {
        window.sessionStorage.setItem(BOOTED_KEY, '1');
      } catch (error) {
        console.warn('[jarvis-hud] boot marker not persisted', error);
      }
    }

    function Overlay() {
      useBus();
      const settings = bus.settings;
      const [booting, setBooting] = React.useState(function () {
        return settings.boot && !readBooted();
      });
      const bootSpoken = React.useRef(false);

      React.useEffect(function () {
        if (booting && !bootSpoken.current) {
          bootSpoken.current = true;
          say('boot');
        }
      }, [booting]);

      React.useEffect(function () {
        if (!bus.live.replayBoot) return;
        bootSpoken.current = false;
        setBooting(true);
      }, [bus.live.replayBoot]);

      const finishBoot = React.useCallback(function () {
        markBooted();
        setBooting(false);
      }, []);

      /* Disabling must stay reversible from the page itself, so the switch leaves a
       * single dimmed dot that brings the interface back. */
      React.useEffect(function () {
        if (!settings.enabled) {
          setThemeLayer(false);
          restoreThemePreference();
          clearGlass();
          return;
        }
        setThemeLayer(themeWanted());
        if (themeWanted()) assertTheme();
        tagGlassSurfaces();
      }, [settings.enabled]);

      if (!settings.enabled) {
        return h('div', { className: 'jh-root' },
          h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
          h('button', {
            type: 'button',
            className: 'jh-ghost',
            title: 'Turn J.A.R.V.I.S. back on',
            'aria-label': 'Turn J.A.R.V.I.S. back on',
            onClick: function () { saveSettings({ enabled: true }); },
          }, 'J'));
      }

      return h('div', { className: 'jh-root' },
        h('style', { dangerouslySetInnerHTML: { __html: CSS } }),
        booting ? h(BootScreen, { duration: settings.bootMs, onDone: finishBoot }) : h(LiveHud));
    }

    /* ------------------------------------------------------------------ */
    /* styles                                                              */
    /* ------------------------------------------------------------------ */

    const CSS = [
      '.jh-root{position:fixed;inset:0;pointer-events:none;z-index:2147483000;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#6fe0ff}',
      '.jh-root *{box-sizing:border-box}',

      '.jh-boot{position:fixed;inset:0;pointer-events:none;overflow:hidden;display:flex;align-items:center;justify-content:center;',
      'background:radial-gradient(circle at 50% 46%,rgba(8,42,64,.975) 0%,rgba(3,12,20,.99) 58%,#01070c 100%);',
      'animation:jh-fade-in .45s ease-out both}',
      '.jh-boot-hit{position:fixed;left:0;right:0;top:var(--dsh-windows-titlebar-height, 0px);bottom:0;pointer-events:auto;cursor:pointer}',
      '.jh-boot--exit{animation:jh-fade-out .4s ease-in both}',
      '@keyframes jh-fade-in{from{opacity:0}to{opacity:1}}',
      '@keyframes jh-fade-out{from{opacity:1}to{opacity:0}}',

      '.jh-grid{position:absolute;inset:-25%;background-image:linear-gradient(rgba(90,220,255,.06) 1px,transparent 1px),',
      'linear-gradient(90deg,rgba(90,220,255,.06) 1px,transparent 1px);background-size:56px 56px;',
      '-webkit-mask-image:radial-gradient(circle at 50% 46%,#000 0%,transparent 70%);mask-image:radial-gradient(circle at 50% 46%,#000 0%,transparent 70%);',
      'animation:jh-grid-drift 14s linear infinite}',
      '@keyframes jh-grid-drift{to{transform:translate3d(0,56px,0)}}',

      '.jh-scan{position:absolute;left:0;right:0;height:190px;background:linear-gradient(to bottom,rgba(110,230,255,0),rgba(110,230,255,.10),rgba(110,230,255,0));',
      'animation:jh-scan 2.8s cubic-bezier(.4,0,.6,1) infinite}',
      '@keyframes jh-scan{from{transform:translateY(-220px)}to{transform:translateY(110vh)}}',

      '.jh-core{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;gap:26px}',
      '.jh-radar{position:relative;width:260px;height:260px}',
      '.jh-sweep{position:absolute;inset:0;border-radius:50%;',
      'background:conic-gradient(from 0deg,rgba(90,220,255,0) 0deg,rgba(90,220,255,.05) 30deg,rgba(90,220,255,.30) 52deg,rgba(90,220,255,0) 62deg);',
      'animation:jh-spin 2.2s linear infinite}',
      '.jh-ring{position:absolute;inset:0;width:100%;height:100%}',
      '.jh-ring--dash{animation:jh-spin 30s linear infinite reverse}',
      '.jh-ring--arc{animation:jh-spin 7s linear infinite}',
      '@keyframes jh-spin{to{transform:rotate(360deg)}}',

      '.jh-core-text{text-align:center}',
      '.jh-title{font-size:clamp(21px,3.6vw,38px);font-weight:300;letter-spacing:.5em;text-indent:.5em;color:#ddf8ff;',
      'text-shadow:0 0 20px rgba(90,220,255,.6);animation:jh-flicker 3.6s ease-in-out infinite}',
      '@keyframes jh-flicker{0%,100%{opacity:1}47%{opacity:.84}49%{opacity:1}71%{opacity:.9}73%{opacity:1}}',
      '.jh-sub{margin-top:12px;font-size:10px;letter-spacing:.42em;text-indent:.42em;color:rgba(126,227,255,.5)}',

      '.jh-checks{position:absolute;left:max(24px,4vw);top:50%;transform:translateY(-50%);z-index:2;display:flex;flex-direction:column;gap:13px;min-width:238px}',
      '.jh-checks-head{font-size:9px;letter-spacing:.34em;color:rgba(126,227,255,.45);margin-bottom:4px;transition:color .4s ease}',
      '.jh-checks-head--granted{color:rgba(126,255,214,.92)}',
      '.jh-check{display:flex;align-items:center;gap:10px;font-size:11px;letter-spacing:.16em;color:rgba(126,227,255,.26);',
      'opacity:.55;transition:color .35s ease,opacity .35s ease}',
      '.jh-check--verifying{opacity:1;color:rgba(196,247,255,.98)}',
      '.jh-check--done{opacity:.92;color:rgba(146,238,255,.74)}',
      '.jh-check-label{display:flex;flex-direction:column;line-height:1.32;flex:1 1 auto}',
      '.jh-check-note{font-size:9px;letter-spacing:.14em;opacity:.52}',
      '.jh-dot{width:6px;height:6px;border-radius:50%;background:currentColor;box-shadow:0 0 8px currentColor;opacity:.4;transition:opacity .3s}',
      '.jh-check--verifying .jh-dot{opacity:1;animation:jh-dot .8s ease-in-out infinite}',
      '.jh-check--done .jh-dot{opacity:.85}',
      '.jh-check-state{margin-left:4px;font-size:9px;letter-spacing:.18em;opacity:.75;min-width:36px;text-align:right}',
      '.jh-check--verifying .jh-check-state{animation:jh-check-blink 1s steps(2,end) infinite}',
      '@keyframes jh-check-blink{0%,100%{opacity:.95}50%{opacity:.22}}',
      '@keyframes jh-dot{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.55);opacity:.45}}',

      '.jh-foot{position:absolute;left:max(24px,4vw);right:max(24px,4vw);bottom:34px;z-index:2}',
      '.jh-bar{height:2px;background:rgba(126,227,255,.14);overflow:hidden}',
      '.jh-bar>i{display:block;height:100%;width:0;background:linear-gradient(90deg,rgba(90,220,255,.45),#9ff0ff);',
      'box-shadow:0 0 10px rgba(90,220,255,.8);animation:jh-fill linear forwards}',
      '@keyframes jh-fill{to{width:100%}}',
      '.jh-hint{margin-top:10px;font-size:9px;letter-spacing:.28em;color:rgba(126,227,255,.3)}',

      '.jh-hud{position:absolute;inset:0}',
      '.jh-corner{position:absolute;width:112px;height:112px;color:#6fe0ff;opacity:.15;animation:jh-breathe 7s ease-in-out infinite}',
      '.jh-tl{top:calc(var(--dsh-windows-titlebar-height, 0px) + 10px);left:10px}',
      '.jh-tr{top:calc(var(--dsh-windows-titlebar-height, 0px) + 10px);right:10px;transform:rotate(90deg)}',
      '.jh-br{bottom:10px;right:10px;transform:rotate(180deg)}',
      '.jh-bl{bottom:10px;left:10px;transform:rotate(270deg)}',
      '.jh-corner svg{width:100%;height:100%;display:block}',
      '@keyframes jh-breathe{0%,100%{opacity:.13}50%{opacity:.23}}',
      '.jh-hud--thinking .jh-corner{animation-duration:1.8s}',
      '.jh-hud--error .jh-corner{color:#ff5a5a}',

      '.jh-chip{position:absolute;top:calc(var(--dsh-windows-titlebar-height, 0px) + 12px);left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;',
      'padding:3px 12px;border-radius:999px;border:1px solid rgba(110,224,255,.22);background:rgba(4,20,30,.55);',
      'font-size:9.5px;letter-spacing:.3em;color:rgba(170,238,255,.82);animation:jh-chip-in .35s ease-out both}',
      '@keyframes jh-chip-in{from{opacity:0;transform:translate(-50%,-4px)}to{opacity:1;transform:translate(-50%,0)}}',
      '.jh-chip-dot{width:5px;height:5px;border-radius:50%;background:#6fe0ff;box-shadow:0 0 8px #6fe0ff;animation:jh-dot 1.2s infinite}',
      '.jh-hud--error .jh-chip{border-color:rgba(255,90,90,.5);color:#ffc0c0}',
      '.jh-hud--error .jh-chip-dot{background:#ff5a5a;box-shadow:0 0 10px #ff5a5a}',

      '.jh-subtitle{position:absolute;top:calc(var(--dsh-windows-titlebar-height, 0px) + 44px);left:50%;transform:translateX(-50%);max-width:min(70vw,720px);text-align:center;',
      'font-size:12.5px;letter-spacing:.05em;color:rgba(205,246,255,.92);text-shadow:0 0 14px rgba(90,220,255,.38);',
      'animation:jh-chip-in .4s ease-out both}',

      '.jh-pulse{position:absolute;left:50%;top:50%;width:220px;height:220px;margin:-110px 0 0 -110px;border-radius:50%;',
      'border:1px solid rgba(120,230,255,.55);animation:jh-pulse 1.1s ease-out forwards}',
      '@keyframes jh-pulse{from{transform:scale(.35);opacity:.9}to{transform:scale(1.9);opacity:0}}',

      '.jh-controls{position:absolute;right:18px;bottom:16px;display:flex;gap:8px;pointer-events:auto}',
      '.jh-btn{width:28px;height:28px;padding:0;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;',
      'border:1px solid rgba(110,224,255,.18);background:rgba(4,20,30,.42);color:rgba(160,235,255,.55);transition:all .2s ease}',
      '.jh-btn:hover{color:#c6f6ff;border-color:rgba(110,224,255,.5);background:rgba(10,40,58,.72);box-shadow:0 0 14px rgba(90,220,255,.3)}',
      '.jh-btn svg{width:14px;height:14px;display:block}',
      '.jh-ghost{position:fixed;right:14px;bottom:14px;width:24px;height:24px;padding:0;border-radius:50%;',
      'display:flex;align-items:center;justify-content:center;cursor:pointer;pointer-events:auto;',
      'font:600 10px/1 ui-monospace,monospace;letter-spacing:.04em;color:rgba(160,230,250,.75);',
      'background:rgba(8,26,36,.55);border:1px solid rgba(120,205,235,.18);opacity:.34;',
      'transition:opacity .25s ease,border-color .25s ease,color .25s ease}',
      '.jh-ghost:hover,.jh-ghost:focus-visible{opacity:1;color:#d6f6ff;border-color:rgba(110,224,255,.55)}',

      /* Liquid glass on two host surfaces. The specular highlight is a second
         background layer on the element itself, so nothing has to be wrapped
         or clipped; `backdrop-filter` does the refraction. */
      '[data-jh-glass]{position:relative;',
      'background-color:rgba(118,203,238,.05)!important;',
      'background-image:radial-gradient(135% 165% at 10% -30%,rgba(255,255,255,.22),rgba(255,255,255,0) 46%),',
      'linear-gradient(155deg,rgba(150,228,255,.11),rgba(50,130,185,.02) 54%,rgba(140,220,255,.08))!important;',
      'border:1px solid rgba(185,240,255,.2)!important;',
      '-webkit-backdrop-filter:blur(22px) saturate(170%);backdrop-filter:blur(22px) saturate(170%);',
      'box-shadow:inset 0 1px 0 rgba(255,255,255,.2),inset 0 -1px 0 rgba(255,255,255,.05),',
      'inset 0 0 26px rgba(120,220,255,.07),0 10px 30px rgba(1,10,18,.45)!important;',
      'transition:background-color .3s ease,border-color .3s ease,box-shadow .3s ease}',
      '[data-jh-glass]:hover{border-color:rgba(200,245,255,.34)!important;background-color:rgba(132,216,250,.08)!important}',
      '[data-jh-glass="nav"]{border-radius:12px!important;background-color:rgba(118,203,238,.03)!important;',
      'border:1px solid rgba(185,240,255,.09)!important;',
      'background-image:radial-gradient(120% 165% at 12% -45%,rgba(255,255,255,.10),rgba(255,255,255,0) 54%),',
      'linear-gradient(155deg,rgba(150,228,255,.055),rgba(140,220,255,.015))!important;',
      'box-shadow:inset 0 1px 0 rgba(255,255,255,.08),inset 0 0 18px rgba(120,220,255,.04)!important}',

      '.jh-panel{position:absolute;right:18px;bottom:54px;width:252px;pointer-events:auto;padding:12px;border-radius:10px;',
      'border:1px solid rgba(110,224,255,.22);background:rgba(3,16,24,.95);color:rgba(190,240,255,.86);font-size:10.5px;',
      'box-shadow:0 18px 50px rgba(0,0,0,.55),0 0 24px rgba(60,190,255,.08)}',
      '.jh-panel-title{font-size:9.5px;letter-spacing:.32em;color:rgba(150,235,255,.7);padding-bottom:8px;margin-bottom:4px;border-bottom:1px solid rgba(110,224,255,.14)}',
      '.jh-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 0}',
      '.jh-label{font-size:9px;letter-spacing:.16em;opacity:.66}',
      '.jh-select{max-width:130px;padding:2px 4px;font-family:inherit;font-size:10px;color:#bff4ff;background:rgba(10,36,50,.9);',
      'border:1px solid rgba(110,224,255,.24);border-radius:5px;outline:none}',
      '.jh-range{width:120px;accent-color:#4fd3ff;background:transparent}',
      '.jh-toggle{min-width:42px;padding:2px 8px;font-family:inherit;font-size:9.5px;letter-spacing:.14em;cursor:pointer;border-radius:5px;',
      'border:1px solid rgba(110,224,255,.24);background:rgba(10,36,50,.9);color:rgba(160,235,255,.6);transition:all .2s}',
      '.jh-toggle--on{color:#0a2230;background:#6fe0ff;border-color:#6fe0ff;box-shadow:0 0 12px rgba(110,224,255,.45)}',
      '.jh-replay{margin-top:10px;width:100%;padding:6px;font-family:inherit;font-size:9.5px;letter-spacing:.2em;cursor:pointer;border-radius:6px;',
      'border:1px solid rgba(110,224,255,.3);background:transparent;color:rgba(170,240,255,.8);transition:all .2s}',
      '.jh-replay:hover{background:rgba(110,224,255,.12);color:#d8f9ff}',

      /* Conversation-column decoration: a drifting particle ring and a data wave
         pinned to the column's top edge. The column box comes from our own
         composer-dock element. */
      '.jh-anchor{display:block;height:0;overflow:hidden;pointer-events:none}',
      '.jh-anchor--hidden{display:none}',
      '.jh-chat{position:absolute;pointer-events:none;overflow:hidden}',
      '.jh-cwave{position:absolute;left:0;right:0;top:0;height:2px;opacity:.35;',
      'background:repeating-linear-gradient(90deg,rgba(90,220,255,0) 0 3px,rgba(90,220,255,.5) 3px 5px,rgba(90,220,255,0) 5px 11px);',
      '-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 14%,#000 86%,transparent 100%);',
      'mask-image:linear-gradient(90deg,transparent 0,#000 14%,#000 86%,transparent 100%);',
      'animation:jh-cwave 2.6s linear infinite}',
      '@keyframes jh-cwave{to{background-position:120px 0}}',
      '.jh-chat--active .jh-cwave{animation-duration:.8s;opacity:.85}',

      /* Particle dust around a soft core. Every dot carries its own twinkle
         period, delay and peak through `--tw`, `--td` and `--po`, so the ring
         shimmers instead of blinking in unison; the whole band drifts around
         the centre and speeds up while the model runs. */
      '.jh-energy{position:absolute;left:50%;top:50%;width:420px;height:420px;margin:-210px 0 0 -210px;',
      '--jh-energy-rgb:150,244,255;opacity:.2;mix-blend-mode:screen;pointer-events:none;',
      'transition:opacity .9s ease,transform .6s ease}',
      '.jh-chat--active .jh-energy{opacity:.75;animation:jh-e-throb 1.9s ease-in-out infinite}',
      '@keyframes jh-e-throb{0%,100%{transform:scale(1)}50%{transform:scale(1.025)}}',
      '.jh-energy-halo{position:absolute;inset:0;border-radius:50%;',

      'background:radial-gradient(circle,rgba(var(--jh-energy-rgb),.26) 0%,rgba(var(--jh-energy-rgb),.09) 28%,rgba(var(--jh-energy-rgb),.03) 48%,transparent 66%);',
      'animation:jh-e-breathe 5.6s ease-in-out infinite}',
      '@keyframes jh-e-breathe{0%,100%{transform:scale(.97);opacity:.75}50%{transform:scale(1.04);opacity:1}}',
      '.jh-chat--active .jh-energy-halo{animation-duration:2.2s}',
      '.jh-dust{position:absolute;inset:0;animation:jh-e-drift 90s linear infinite}',
      '.jh-chat--active .jh-dust{animation-duration:24s}',
      '@keyframes jh-e-drift{to{transform:rotate(360deg)}}',
      '.jh-particle{position:absolute;border-radius:50%;background:rgba(208,250,255,.92);',
      'box-shadow:0 0 4px 1px rgba(var(--jh-energy-rgb),.7),0 0 10px 2px rgba(var(--jh-energy-rgb),.22);',
      'animation:jh-e-twinkle var(--tw,3s) ease-in-out infinite;animation-delay:var(--td,0s);will-change:opacity,transform}',
      '@keyframes jh-e-twinkle{0%,100%{opacity:calc(var(--po,.8) * .14);transform:translate(-50%,-50%) scale(.55)}',
      '50%{opacity:var(--po,.8);transform:translate(-50%,-50%) scale(1.25)}}',
      /* Generating: the delay comes from the particle's angle and radius, so a
         single crest sweeps around the band instead of every dot pulsing on
         its own. Removing the active class restores the idle twinkle. */
      '.jh-chat--active .jh-particle{animation-name:jh-e-wave;animation-duration:' + WAVE_PERIOD + 's;',
      'animation-delay:var(--wd,0s);animation-timing-function:ease-in-out;',
      'box-shadow:0 0 6px 2px rgba(var(--jh-energy-rgb),.85),0 0 16px 4px rgba(var(--jh-energy-rgb),.3)}',
      '@keyframes jh-e-wave{',
      '0%{opacity:calc(var(--po,.8) * .1);transform:translate(-50%,-50%) scale(.42)}',
      '38%{opacity:calc(var(--po,.8) * 1);transform:translate(-50%,-50%) scale(1.75)}',
      '60%{opacity:calc(var(--po,.8) * .85);transform:translate(-50%,-50%) scale(1.3)}',
      '100%{opacity:calc(var(--po,.8) * .12);transform:translate(-50%,-50%) scale(.45)}}',
      '.jh-energy-dot{position:absolute;left:50%;top:50%;width:7px;height:7px;margin:-3.5px 0 0 -3.5px;border-radius:50%;',
      'background:#eafcff;box-shadow:0 0 12px 4px rgba(var(--jh-energy-rgb),.55),0 0 34px 12px rgba(var(--jh-energy-rgb),.2);',
      'animation:jh-e-breathe 3.6s ease-in-out infinite}',
      '.jh-chat--active .jh-energy-dot{animation-duration:1.1s}',

      '@media (prefers-reduced-motion: reduce){',
      '.jh-grid,.jh-scan,.jh-sweep,.jh-ring,.jh-corner,.jh-check--lit .jh-dot,.jh-title,.jh-chip-dot,.jh-pulse,',
      '.jh-cwave,.jh-energy,.jh-energy-halo,.jh-dust,.jh-particle,.jh-energy-dot{animation:none!important}',
      '.jh-hud .jh-corner{opacity:.16}}',
    ].join('');

    /* ------------------------------------------------------------------ */
    /* plugin                                                              */
    /* ------------------------------------------------------------------ */

    return {
      inject: ['slots', 'theme'],
      apply(ctx) {
        /* Two host surfaces get the glass treatment; they are found by
         * structure because the app's class names are hashed per build. */
        ctx.effect(function () {
          let pending = 0;
          function schedule() {
            if (pending) return;
            pending = window.setTimeout(function () {
              pending = 0;
              tagGlassSurfaces();
            }, 180);
          }
          tagGlassSurfaces();
          const observer = new MutationObserver(schedule);
          observer.observe(document.body, { childList: true, subtree: true });
          return function () {
            observer.disconnect();
            window.clearTimeout(pending);
            clearGlass();
          };
        }, 'jarvis-hud:glass');

        /* The tint is ours alone, so it does not ride on the theme service. */
        ctx.effect(function () {
          setThemeLayer(themeWanted());
          return function () {
            setThemeLayer(false);
          };
        }, 'jarvis-hud:theme-layer');

        const theme = ctx.get('theme');
        if (theme) {
          themeService = theme;
          ctx.on('theme/change', function () {
            /* A stored preference restored after mount must not silently win. */
            if (themeWanted() && Date.now() < themeGraceUntil) assertTheme();
            emit({});
          });
          if (themeWanted()) {
            themeGraceUntil = Date.now() + 8000;
            ctx.effect(function () {
              assertTheme();
              /* The profile can restore a stored preference after the client has
               * mounted, which would undo a single switch; re-assert until it
               * settles, then stop so a later manual change is respected. */
              const timers = [400, 1200, 2600, 5000, 7500].map(function (delay) {
                return window.setTimeout(assertTheme, delay);
              });
              return function () {
                timers.forEach(function (timer) { window.clearTimeout(timer); });
              };
            }, 'jarvis-hud:theme-assert');
          }
        }

        ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register({ name: 'shell.overlay', id: 'jarvis-hud', order: 100 }, Overlay);
        });
        ctx.slots.inject('conversation.composer.dock', function () {
          return ctx.slots.register({ name: 'conversation.composer.dock', id: 'jarvis-sensor', order: 90 }, Sensor);
        });
        ctx.slots.inject('conversation.session.header.utilities', function () {
          return ctx.slots.register({
            name: 'conversation.session.header.utilities',
            id: 'jarvis-header-sensor',
            order: 80,
          }, HeaderSensor);
        });
      },
    };
  },
});