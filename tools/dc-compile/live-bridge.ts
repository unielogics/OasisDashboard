import { CompileError } from './errors'

/**
 * The live variant keeps running each screen's ORIGINAL logic class, which knows nothing about the session. This
 * bridge is appended to the class source (so it sees `Component` in the same scope) and does three things:
 *   1. renderVals() gains `live`: the values the live template patches read (`{{ live.user.name }}`, ...), taken
 *      from window.__oasisLive (src/auth/chrome.ts);
 *   2. the screen re-renders when that store changes (subscribe on mount, unsubscribe on unmount);
 *   3. toggleTheme reports the new theme so it can be saved to the server (PUT /me/preferences) and mirrors the theme
 *      to <html data-theme>.
 * It touches no behaviour of the class itself. A converted view model calls the same store directly instead.
 */
export const LIVE_BRIDGE = `
;(function () {
  var P = Component.prototype;
  var chrome = function () { return (typeof window !== 'undefined' && window.__oasisLive) || null; };
  var renderVals = P.renderVals;
  P.renderVals = function () {
    var v = renderVals.apply(this, arguments);
    var c = chrome();
    var self = this;
    v.live = c ? c.vals() : {};
    if (typeof v.toggleTheme === 'function') {
      var toggle = v.toggleTheme;
      v.toggleTheme = function () {
        var prev = self.state.theme;
        var r = toggle.apply(this, arguments);
        var next = self.state.theme;
        if (c && next !== prev) c.themeChanged(next, prev);
        return r;
      };
    }
    if (typeof document !== 'undefined' && (v.theme === 'light' || v.theme === 'dark') && document.documentElement.getAttribute('data-theme') !== v.theme) {
      document.documentElement.setAttribute('data-theme', v.theme);
    }
    return v;
  };
  var didMount = P.componentDidMount;
  var willUnmount = P.componentWillUnmount;
  P.componentDidMount = function () {
    var c = chrome();
    var self = this;
    if (c) this.__liveOff = c.subscribe(function () { self.forceUpdate(); });
    if (didMount) return didMount.apply(this, arguments);
  };
  P.componentWillUnmount = function () {
    if (this.__liveOff) { this.__liveOff(); this.__liveOff = null; }
    if (willUnmount) return willUnmount.apply(this, arguments);
  };
})();
`

/** Appends the bridge, failing the build (exit 3) when the class no longer has the members the bridge relies on. */
export function withLiveBridge(logicSrc: string, screen: string): string {
  const need: [RegExp, string][] = [
    [/class\s+Component\s+extends\s+DCLogic/, 'class Component extends DCLogic'],
    [/\brenderVals\s*\(\s*\)\s*\{/, 'a renderVals() method'],
    [/\btoggleTheme\s*:/, 'a toggleTheme handler in renderVals()'],
    [/\btheme\s*:\s*s\.theme/, 'theme in renderVals()'],
  ]
  for (const [re, what] of need) {
    if (!re.test(logicSrc)) {
      throw new CompileError(`patch guard failed: ${screen}: live bridge anchor missing, expected ${what}`, 3)
    }
  }
  return logicSrc.replace(/\s*$/, '\n') + LIVE_BRIDGE
}
