(function () {
  'use strict';

  var STORAGE_KEY = 'bif-theme';
  var THEMES = { light: true, dark: true };
  var TITLE_STYLE_ID = 'bif-page-title-standardizer';
  var contrastTimer = null;

  function normalize(theme) {
    return THEMES[theme] ? theme : 'light';
  }

  function read() {
    try {
      return normalize(localStorage.getItem(STORAGE_KEY));
    } catch (error) {
      return 'light';
    }
  }

  function updateThemeColor(theme) {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', theme === 'light' ? '#f4f1e8' : '#0d1b2a');
  }

  function apply(theme, persist) {
    var nextTheme = normalize(theme);
    document.documentElement.setAttribute('data-bif-theme', nextTheme);
    document.documentElement.style.colorScheme = nextTheme;

    if (persist !== false) {
      try {
        localStorage.setItem(STORAGE_KEY, nextTheme);
      } catch (error) {
        // O tema continua funcionando mesmo quando o navegador bloqueia o armazenamento.
      }
    }

    if (document.head) updateThemeColor(nextTheme);

    window.dispatchEvent(new CustomEvent('bif-theme-change', {
      detail: { theme: nextTheme }
    }));

    return nextTheme;
  }

  function ensureTitleStyleTag() {
    if (!document.head || document.getElementById(TITLE_STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = TITLE_STYLE_ID;
    style.textContent =
      'html[data-bif-theme="light"] [data-bif-page-title]{' +
        'font-family:"Poppins",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;' +
        'font-size:clamp(1.35rem,1.16rem + .55vw,1.72rem)!important;' +
        'font-weight:800!important;line-height:1.08!important;letter-spacing:-.032em!important;' +
        'color:#223650!important;background:none!important;background-image:none!important;' +
        '-webkit-text-fill-color:#223650!important;text-shadow:none!important;' +
      '}' +
      'html[data-bif-theme="light"] [data-bif-page-title] span{' +
        'color:#223650!important;-webkit-text-fill-color:#223650!important;' +
      '}' +
      'html[data-bif-theme="light"] [data-bif-page-subtitle]{' +
        'color:#66758a!important;text-shadow:none!important;' +
      '}' +
      'html[data-bif-theme="light"] [data-bif-auto-contrast]{' +
        'color:#34465a!important;-webkit-text-fill-color:#34465a!important;text-shadow:none!important;' +
      '}';
    document.head.appendChild(style);
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.closest('template,script,style,noscript,svg,defs,[hidden]')) return false;
    var cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  function markSubtitle(titleEl) {
    if (!titleEl || !titleEl.parentElement) return;
    var next = titleEl.nextElementSibling;
    while (next) {
      if (/^(P|DIV|SMALL)$/i.test(next.tagName)) {
        next.setAttribute('data-bif-page-subtitle', '');
        return;
      }
      next = next.nextElementSibling;
    }
  }

  function standardizePageTitles() {
    ensureTitleStyleTag();

    var selectors = [
      'body > header h1', '.app-header h1', '.app-title h1', '.header h1',
      '.hero h1', '.bif-hero h1', '.kanban-topbar h1', '.title-block h1',
      '.head-title h1', '.brand h1', '.page-header h1', '.page-header h2',
      '.topbar h1', '.header-title', '.page-title'
    ];

    var candidates = [];
    document.querySelectorAll(selectors.join(',')).forEach(function (title) {
      if (!isVisible(title)) return;
      if (title.closest('.modal,dialog,.login-card,[role="dialog"]')) return;
      if ((title.matches('.header-title,.page-title')) && title.querySelector('h1,h2')) return;
      if (!(title.textContent || '').replace(/\s+/g, ' ').trim()) return;
      if (candidates.indexOf(title) < 0) candidates.push(title);
    });

    if (!candidates.length) {
      document.querySelectorAll('h1').forEach(function (title) {
        if (!isVisible(title)) return;
        if (title.closest('.modal,dialog,.login-card,[role="dialog"]')) return;
        if (!(title.textContent || '').replace(/\s+/g, ' ').trim()) return;
        if (candidates.indexOf(title) < 0) candidates.push(title);
      });
    }

    candidates.sort(function (a, b) {
      var ar = a.getBoundingClientRect();
      var br = b.getBoundingClientRect();
      if (Math.abs(ar.top - br.top) > 4) return ar.top - br.top;
      return ar.left - br.left;
    });

    document.querySelectorAll('[data-bif-page-title]').forEach(function (el) {
      if (candidates.indexOf(el) < 0) el.removeAttribute('data-bif-page-title');
    });
    document.querySelectorAll('[data-bif-page-subtitle]').forEach(function (el) {
      el.removeAttribute('data-bif-page-subtitle');
    });

    var primary = candidates[0] || null;
    if (!primary) return;

    primary.setAttribute('data-bif-page-title', '');
    markSubtitle(primary);
  }

  function parseColor(value) {
    if (!value || value === 'transparent') return null;
    var m = value.match(/rgba?\(([^)]+)\)/i);
    if (!m) return null;
    var p = m[1].split(',').map(function (v) { return parseFloat(v.trim()); });
    return { r: p[0] || 0, g: p[1] || 0, b: p[2] || 0, a: p.length > 3 ? p[3] : 1 };
  }

  function luminance(rgb) {
    function channel(v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
  }

  function isProtectedText(el) {
    return !!el.closest(
      '.btn-primary,.primary,.btn-gold,.btn.gold,.gold,.btn-login,.btn-save,' +
      '.btn-green,.btn-blue,.danger,.btn-danger,.success,[data-keep-light-text]'
    );
  }

  function effectiveBackground(el) {
    var node = el;
    while (node && node.nodeType === 1) {
      var cs = getComputedStyle(node);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      var bg = parseColor(cs.backgroundColor);
      if (bg && bg.a > 0.08) return bg;
      node = node.parentElement;
    }
    return { r: 244, g: 241, b: 232, a: 1 };
  }

  function needsContrastFix(el) {
    if (!isVisible(el) || isProtectedText(el)) return false;
    var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return false;
    var cs = getComputedStyle(el);
    var fg = parseColor(cs.color);
    if (!fg || fg.a < 0.45 || luminance(fg) < 0.66) return false;
    var bg = effectiveBackground(el);
    if (!bg) return false;
    return luminance(bg) > 0.70;
  }

  function scanContrast(root) {
    if (document.documentElement.getAttribute('data-bif-theme') !== 'light') return;
    var base = root && root.querySelectorAll ? root : document;
    var list = [];
    if (base.nodeType === 1) list.push(base);
    Array.prototype.push.apply(list, base.querySelectorAll(
      'h1,h2,h3,h4,h5,h6,p,span,strong,b,small,label,li,td,th,a,div'
    ));
    list.slice(0, 9000).forEach(function (el) {
      if (needsContrastFix(el)) el.setAttribute('data-bif-auto-contrast', '');
      else el.removeAttribute('data-bif-auto-contrast');
    });
  }

  function scheduleContrastScan(root) {
    clearTimeout(contrastTimer);
    contrastTimer = setTimeout(function () { scanContrast(root || document); }, 80);
  }

  window.BIFTheme = {
    get: read,
    set: function (theme) { return apply(theme, true); },
    toggle: function () { return apply(read() === 'dark' ? 'light' : 'dark', true); },
    apply: function () { return apply(read(), false); }
  };

  apply(read(), false);

  window.addEventListener('storage', function (event) {
    if (event.key === STORAGE_KEY) apply(event.newValue, false);
  });

  window.addEventListener('bif-theme-change', function () {
    standardizePageTitles();
    scheduleContrastScan(document);
  });

  document.addEventListener('DOMContentLoaded', function () {
    apply(read(), false);
    standardizePageTitles();
    scheduleContrastScan(document);
    setTimeout(function () { standardizePageTitles(); scanContrast(document); }, 350);
    setTimeout(function () { standardizePageTitles(); scanContrast(document); }, 1200);

    var observer = new MutationObserver(function (mutations) {
      var target = document;
      for (var i = 0; i < mutations.length; i += 1) {
        if (mutations[i].addedNodes && mutations[i].addedNodes.length) {
          target = mutations[i].target || document;
          break;
        }
      }
      standardizePageTitles();
      scheduleContrastScan(target);
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style','class','hidden'] });
  });

  window.addEventListener('load', function () {
    standardizePageTitles();
    scanContrast(document);
  });
}());
