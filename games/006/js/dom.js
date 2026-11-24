(function () {
  'use strict';
  const byId = id => document.getElementById(id);
  function write(id, value) {
    const el = byId(id);
    if (el.textContent !== value) el.textContent = value;
  }
  function element(tag, className, text) {
    const el = document.createElement(tag);
    el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  Nightline.dom = { byId, write, element };
})();
