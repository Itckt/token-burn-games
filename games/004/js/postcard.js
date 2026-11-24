(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HarbourPostcard = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function layout(width, height) {
    if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) {
      throw new RangeError('Empty harbour frame');
    }
    const scale = Math.min(1, 2048 / Math.max(width, height));
    const photoWidth = Math.max(1, Math.round(width * scale));
    const photoHeight = Math.max(1, Math.round(height * scale));
    const margin = Math.max(10, Math.round(Math.min(photoWidth, photoHeight) * 0.027));
    const cardWidth = Math.max(320, photoWidth + 2 * margin);
    const titleSize = Math.max(23, Math.round(cardWidth * 0.035));
    const smallSize = Math.max(11, Math.round(titleSize * 0.37));
    const footer = 2 * margin + titleSize + smallSize * 1.6;
    return {width: cardWidth, height: Math.ceil(margin + photoHeight + footer),
      photoWidth, photoHeight, margin, titleSize, smallSize};
  }

  function paint(preview, frame, caption) {
    const {width, height, photoWidth, photoHeight, margin, titleSize, smallSize} = layout(frame.width, frame.height);
    preview.width = width;
    preview.height = height;
    const ctx = preview.getContext('2d');
    ctx.fillStyle = '#f2eddf';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(frame, Math.floor((width - photoWidth) / 2), margin, photoWidth, photoHeight);
    const titleY = margin * 2 + photoHeight + titleSize;
    const seal = titleSize * 1.32, sealX = width - margin - seal;
    const textWidth = sealX - 2 * margin;
    ctx.fillStyle = '#18282b';
    ctx.font = 'italic ' + titleSize + 'px Georgia, serif';
    ctx.fillText('Victoria Harbour', margin, titleY, textWidth);
    ctx.fillStyle = '#4f6260';
    ctx.font = smallSize + 'px Consolas, monospace';
    ctx.fillText(caption, margin + 1, height - margin, textWidth);
    ctx.fillStyle = '#a44836';
    ctx.fillRect(sealX, height - margin - seal, seal, seal);
    ctx.fillStyle = '#fff6e5';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = Math.floor(seal * 0.42) + 'px "PMingLiU", serif';
    ctx.fillText('夜渡', sealX + seal / 2, height - margin - seal / 2, seal * 0.90);
  }

  function create(onClose) {
    const byId = id => document.getElementById(id);
    const dialog = byId('postcard-dialog'), preview = byId('postcard-preview');
    const status = byId('postcard-status'), save = byId('save-postcard');
    let imageUrl = null, edition = 0;
    function release() {
      edition++;
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = null;
      save.removeAttribute('href');
      save.hidden = true;
    }
    function offerDownload(blob, current, filename) {
      // An encoder can finish after the sheet closes or another shot opens.
      if (!dialog.open || current !== edition) return;
      if (!blob) {
        status.textContent = 'PNG encoding failed. Close the postcard and try again.';
        return;
      }
      try {
        imageUrl = URL.createObjectURL(blob);
      } catch (_) {
        status.textContent = 'The PNG download could not be prepared. Close the postcard and try again.';
        return;
      }
      save.href = imageUrl;
      save.download = filename;
      save.hidden = false;
      status.textContent = preview.width + ' × ' + preview.height + ' · PNG';
    }
    function show(frame, route, clock, seed) {
      release();
      const current = edition;
      status.textContent = 'Preparing PNG…';
      preview.hidden = true;
      try {
        paint(preview, frame, route + '  /  ' + clock + '  ·  Seed ' + seed);
        preview.hidden = false;
      } catch (_) {
        status.textContent = 'The harbour frame could not be copied. Close the postcard and try again.';
      }
      dialog.showModal();
      if (preview.hidden) return;
      const filename = ['nightferry', seed, route.toLowerCase().replace(/ /g, '-'), clock.replace(':', '-')].join('-') + '.png';
      try {
        preview.toBlob(blob => offerDownload(blob, current, filename), 'image/png');
      } catch (_) {
        status.textContent = 'PNG encoding failed. Close the postcard and try again.';
      }
    }
    byId('close-postcard').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      if (dialog.open) return;
      release();
      preview.width = preview.height = 1;
      onClose();
    });
    return {show, get open() { return dialog.open; },
      available: typeof dialog.showModal === 'function' && typeof preview.toBlob === 'function' &&
        typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && typeof URL.revokeObjectURL === 'function'};
  }
  return {layout, create};
});
