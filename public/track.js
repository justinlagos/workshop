// Ad measurement for The Build Session.
// 1. Campaign tags (utm_*, fbclid) are read from the address a visitor lands on and sent with
//    their booking, so each booking records which ad or link brought it. Nothing is stored.
// 2. The Meta Pixel loads only when PIXEL_ID below is set AND the visitor allows ad measurement.
//    Their choice is remembered on this device. With PIXEL_ID empty there is no banner and no pixel.
(function () {
  var PIXEL_ID = ''; // Meta Pixel ID, digits only. Also set META_PIXEL_ID on the server for purchase events.
  var CHOICE = 'tbs_ads_choice';
  var TAGS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'];
  var loaded = false;

  function getChoice() { try { return localStorage.getItem(CHOICE); } catch (e) { return null; } }
  function setChoice(v) { try { localStorage.setItem(CHOICE, v); } catch (e) {} }

  function campaign() {
    var p = new URLSearchParams(location.search), out = {};
    TAGS.forEach(function (k) { var v = p.get(k); if (v) out[k] = v.slice(0, 120); });
    if (Object.keys(out).length) out.landed_at = new Date().toISOString();
    return Object.keys(out).length ? out : null;
  }

  function loadPixel() {
    if (loaded || !PIXEL_ID) return;
    loaded = true;
    !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', PIXEL_ID);
    window.fbq('track', 'PageView');
  }

  function banner() {
    if (!PIXEL_ID || document.getElementById('adsChoice')) return;
    var el = document.createElement('div');
    el.id = 'adsChoice';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Ad measurement');
    el.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:100;max-width:560px;margin:0 auto;background:#fff;border:2px solid #08080a;border-radius:16px;box-shadow:4px 4px 0 #08080a;padding:14px 16px;font:500 14px/1.5 "Plus Jakarta Sans",Arial,sans-serif;color:#08080a';
    el.innerHTML = '<p style="margin:0 0 10px">Can we measure which ads bring people here? We use Meta\'s pixel for this. <a href="/privacy.html#ads" style="color:inherit">How it works</a></p>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" data-v="yes" style="font:800 14px Plus Jakarta Sans,Arial,sans-serif;background:#ccff00;border:2px solid #08080a;border-radius:10px;padding:9px 16px;cursor:pointer">Allow</button>'
      + '<button type="button" data-v="no" style="font:700 14px Plus Jakarta Sans,Arial,sans-serif;background:#fff;border:2px solid #dcd2f4;border-radius:10px;padding:9px 16px;cursor:pointer">No thanks</button></div>';
    el.addEventListener('click', function (e) {
      var v = e.target && e.target.getAttribute('data-v');
      if (!v) return;
      setChoice(v);
      el.remove();
      if (v === 'yes') loadPixel();
    });
    document.body.appendChild(el);
  }

  window.TBS = {
    campaign: campaign,
    consented: function () { return !!PIXEL_ID && getChoice() === 'yes'; },
    track: function (event, data, opts) { if (loaded && window.fbq) window.fbq('track', event, data || {}, opts || {}); },
    pixelOn: function () { return loaded; },
    choose: function () { try { localStorage.removeItem(CHOICE); } catch (e) {} banner(); },
  };

  function start() {
    if (!PIXEL_ID) return;
    var c = getChoice();
    if (c === 'yes') loadPixel();
    else if (c !== 'no') banner();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
