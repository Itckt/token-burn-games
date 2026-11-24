(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./postcard.js'));
  else root.Atlas.FieldCamera = factory(root.Atlas.postcard);
})(globalThis, function (postcard) {
  'use strict';
  return class FieldCamera {
    constructor(doc, actions) {
      this.doc = doc;
      this.actions = actions;
      this.el = id => doc.getElementById(id);
      this.scene = this.el('campus');
      this.review = this.el('print-dialog');
      this.sheet = this.el('print-preview');
      this.link = this.el('print-download');
      this.zoom = 1;
      this.active = false;
      this.shot = 0;
      this.url = null;
      this.el('lens-in').addEventListener('click', () => this.adjust(1));
      this.el('lens-out').addEventListener('click', () => this.adjust(-1));
      this.el('camera-close').addEventListener('click', () => this.leave());
      this.el('shutter').addEventListener('click', () => this.capture());
      this.el('retake').addEventListener('click', () => this.review.close());
      this.review.addEventListener('close', () => {
        if (this.review.open) return;
        this.releasePrint();
        if (this.active) this.scene.focus({preventScroll:true});
        actions.invalidate();
      });
    }
    setActive(active) {
      this.actions.stop();
      this.active = active;
      this.doc.body.classList.toggle('is-framing',active);
      this.el('viewfinder').hidden = !active;
      this.showStudy(null);
      this.el('camera').setAttribute('aria-pressed',String(active));
      this.zoom = 1;
      this.adjust(0);
    }
    enter() { this.setActive(true); }
    leave() {
      if (!this.active) return;
      if (this.review.open) this.review.close();
      this.releasePrint();
      this.setActive(false);
    }
    adjust(by) {
      this.zoom = Math.max(1,Math.min(3,this.zoom+by));
      this.el('lens-value').textContent = this.zoom+'×';
      this.el('lens-out').disabled = this.zoom===1;
      this.el('lens-in').disabled = this.zoom===3;
      this.scene.focus({preventScroll:true});
      this.actions.invalidate();
    }
    showStudy(match) {
      const panel=this.el('study-hint');
      panel.hidden=!match;
      if (!match) return;
      const name=this.el('study-name'), cue=this.el('study-cue');
      if (name.textContent!==match.place.study.name) name.textContent=match.place.study.name;
      if (cue.textContent!==match.cue) cue.textContent=match.cue;
      panel.dataset.ready=String(match.ready);
    }
    shortcut(event, sceneFocus) {
      if (event.key === 'Escape') this.leave();
      else if (event.code === 'Space' && sceneFocus) this.capture();
      else if (['Equal','NumpadAdd'].includes(event.code) || event.key === '+') this.adjust(1);
      else if (['Minus','NumpadSubtract'].includes(event.code) || event.key === '-') this.adjust(-1);
      else return false;
      return true;
    }
    releasePrint() {
      this.shot++;
      this.link.hidden = true;
      this.link.removeAttribute('href');
      this.el('print-study').hidden = true;
      if (this.url) this.doc.defaultView.URL.revokeObjectURL(this.url);
      this.url = null;
    }
    capture() {
      if (!this.active || this.review.open) return;
      this.actions.stop();
      // WebGL can discard its drawing buffer after compositing. Draw and copy
      // within this same event, including when the animation loop is asleep.
      const info = this.actions.expose(this.zoom);
      if (!info) return;
      this.releasePrint();
      const shot = this.shot, status = this.el('print-status');
      try {
        const frame=postcard.print(this.sheet,this.scene,info);
        this.sheet.setAttribute('aria-label',info.name+' · '+info.detail+(info.lookout ? ' · '+info.lookout.study.name : ''));
        this.review.showModal();
        if (info.lookout) {
          const note=this.el('print-study');
          note.textContent=this.actions.record(info.lookout,this.sheet,frame);
          note.hidden=false;
        }
        status.textContent = 'Preparing PNG…';
        this.sheet.toBlob(blob => {
          if (shot !== this.shot || !this.review.open) return;
          try {
            if (!blob) throw Error('Empty PNG');
            this.url = this.doc.defaultView.URL.createObjectURL(blob);
            this.link.href = this.url;
            this.link.download = info.filename;
            this.link.hidden = false;
            status.textContent = '';
          } catch {
            status.textContent = 'PNG unavailable. Retake to try again.';
          }
        },'image/png');
      } catch {
        const message = 'The postcard could not be prepared. Retake to try again.';
        if (this.review.open) status.textContent = message;
        else this.actions.notify(message);
      }
      this.actions.invalidate();
    }
  };
});
