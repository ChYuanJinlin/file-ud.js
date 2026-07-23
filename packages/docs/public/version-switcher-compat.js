(function () {
  var rootBase = "/file-ud.js/";
  var latestVersion = "v0.1.4";
  var versions = [
    { label: "latest (" + latestVersion + ")", path: rootBase },
    { label: "v0.1.3", path: rootBase + "v0.1.3/" },
    { label: "v0.1.2", path: rootBase + "v0.1.2/" },
    { label: "v0.1.1", path: rootBase + "v0.1.1/" },
    { label: "v0.1.0", path: rootBase + "v0.1.0/" },
  ];

  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback);
    } else {
      callback();
    }
  }

  function normalizePath(path) {
    return path.charAt(path.length - 1) === "/" ? path : path + "/";
  }

  function getCurrentBase() {
    var pathname = window.location.pathname;
    var match = pathname.match(
      /^\/file-ud\.js\/(v\d+(?:\.\d+)*(?:[-\w.]+)?)(?:\/|$)/,
    );

    if (!match || match[1] === latestVersion) return rootBase;
    return rootBase + match[1] + "/";
  }

  function getCurrentPage() {
    var pathname = window.location.pathname;
    if (pathname.indexOf(rootBase) !== 0) return "";

    return pathname
      .slice(rootBase.length)
      .replace(/^v\d+(?:\.\d+)*(?:[-\w.]+)?\/?/, "");
  }

  function getCurrentLabel() {
    var currentBase = getCurrentBase();
    for (var i = 0; i < versions.length; i++) {
      if (normalizePath(versions[i].path) === currentBase) {
        return versions[i].label;
      }
    }
    return versions[0].label;
  }

  function isActive(version) {
    return normalizePath(version.path) === getCurrentBase();
  }

  function buildUrl(version) {
    var page = getCurrentPage();
    return version.path + page + window.location.search + window.location.hash;
  }

  function fallbackUrl(version) {
    return version.path + window.location.search + window.location.hash;
  }

  function navigate(version) {
    var target = buildUrl(version);

    if (!getCurrentPage()) {
      window.location.href = fallbackUrl(version);
      return;
    }

    fetch(target, { method: "HEAD", cache: "no-store" })
      .then(function (res) {
        window.location.href = res.ok ? target : fallbackUrl(version);
      })
      .catch(function () {
        window.location.href = target;
      });
  }

  function ensureStyle() {
    if (document.getElementById("fud-version-switcher-style")) return;

    var style = document.createElement("style");
    style.id = "fud-version-switcher-style";
    style.textContent =
      ".fud-version-switcher-compat{position:relative;display:flex;align-items:center;margin-left:4px}" +
      ".fud-version-switcher-compat .fud-version-trigger{display:flex;align-items:center;gap:4px;height:36px;padding:0 12px;border:0;background:transparent;cursor:pointer;color:var(--vp-c-text-1);font:inherit}" +
      ".fud-version-switcher-compat .fud-version-badge{font-size:13px;font-weight:600;border:1px solid var(--vp-c-brand-1);color:var(--vp-c-brand-1);padding:2px 10px;border-radius:12px;line-height:1}" +
      ".fud-version-switcher-compat .fud-version-arrow{color:var(--vp-c-text-2);transition:transform .2s;flex-shrink:0}" +
      ".fud-version-switcher-compat .fud-version-arrow svg{display:block}" +
      ".fud-version-switcher-compat.open .fud-version-arrow{transform:rotate(180deg)}" +
      ".fud-version-switcher-compat .fud-version-dropdown{position:absolute;top:calc(100% + 8px);right:0;min-width:140px;background:var(--vp-c-bg);border:1px solid var(--vp-c-divider);border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.15);padding:4px;z-index:999}" +
      ".fud-version-switcher-compat .fud-version-option{display:flex;align-items:center;justify-content:space-between;padding:6px 12px;cursor:pointer;font-size:13px;white-space:nowrap;color:var(--vp-c-text-1);border-radius:6px;line-height:1.5}" +
      ".fud-version-switcher-compat .fud-version-option:hover{background:var(--vp-c-bg-soft);color:var(--vp-c-brand-1)}" +
      ".fud-version-switcher-compat .fud-version-option.active{color:var(--vp-c-brand-1)}" +
      ".fud-version-switcher-compat .fud-version-check{margin-left:8px;font-weight:700}";
    document.head.appendChild(style);
  }

  function mount() {
    var host = document.querySelector(".version-switcher");
    if (!host) return;
    if (
      host.getAttribute("data-fud-compat-mounted") === "1" &&
      host.querySelector(".fud-version-trigger")
    ) {
      return;
    }

    ensureStyle();
    host.setAttribute("data-fud-compat-mounted", "1");
    host.className = "version-switcher fud-version-switcher-compat";
    host.innerHTML = "";

    var trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "fud-version-trigger";
    trigger.setAttribute("aria-haspopup", "true");
    trigger.setAttribute("aria-expanded", "false");

    var badge = document.createElement("span");
    badge.className = "fud-version-badge";
    badge.textContent = getCurrentLabel();
    trigger.appendChild(badge);

    var arrow = document.createElement("span");
    arrow.className = "fud-version-arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M7 10l5 5 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    trigger.appendChild(arrow);

    var dropdown = document.createElement("div");
    dropdown.className = "fud-version-dropdown";
    dropdown.hidden = true;

    versions.forEach(function (version) {
      var option = document.createElement("div");
      option.className =
        "fud-version-option" + (isActive(version) ? " active" : "");
      option.setAttribute("role", "button");

      var label = document.createElement("span");
      label.textContent = version.label;
      option.appendChild(label);

      if (isActive(version)) {
        var check = document.createElement("span");
        check.className = "fud-version-check";
        check.textContent = "\u2713";
        option.appendChild(check);
      }

      option.addEventListener("click", function (event) {
        event.stopPropagation();
        navigate(version);
      });
      dropdown.appendChild(option);
    });

    trigger.addEventListener("click", function (event) {
      event.stopPropagation();
      var isOpen = dropdown.hidden;
      dropdown.hidden = !isOpen;
      host.classList.toggle("open", isOpen);
      trigger.setAttribute("aria-expanded", String(isOpen));
    });

    document.addEventListener("click", function () {
      dropdown.hidden = true;
      host.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
    });

    host.appendChild(trigger);
    host.appendChild(dropdown);
  }

  onReady(function () {
    mount();

    var observer = new MutationObserver(function () {
      mount();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  });
})();
