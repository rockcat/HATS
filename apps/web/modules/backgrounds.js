// ── Background images: generating one, and choosing one ─────────────────────

import { getBackgrounds } from './avatars.js';

export function initGenBgModal() {
  const modal       = document.getElementById('gen-bg-modal');
  const closeBtn    = document.getElementById('gen-bg-close');
  const cancelBtn   = document.getElementById('gen-bg-cancel');
  const submitBtn   = document.getElementById('gen-bg-submit');
  const spinner     = document.getElementById('gen-bg-spinner');
  const preview     = document.getElementById('gen-bg-preview');
  const errorEl     = document.getElementById('gen-bg-error');
  const nameInput   = document.getElementById('gen-bg-name');
  const promptInput = document.getElementById('gen-bg-prompt');

  const close = () => {
    modal.hidden = true;
    nameInput.value   = '';
    promptInput.value = '';
    preview.hidden    = true;
    errorEl.textContent = '';
  };
  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  for (const el of [nameInput, promptInput]) {
    el.addEventListener('keydown', e => { if (e.key === 'Enter') submitBtn.click(); });
  }

  submitBtn.addEventListener('click', async () => {
    const name   = nameInput.value.trim();
    const prompt = promptInput.value.trim();
    if (!name)   { errorEl.textContent = 'Please enter a name for the background.'; return; }
    if (!prompt) { errorEl.textContent = 'Please enter a scene description.'; return; }
    errorEl.textContent  = '';
    submitBtn.disabled   = true;
    preview.hidden       = true;
    spinner.hidden       = false;

    try {
      const res  = await fetch('/api/images/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, prompt }),
      });
      const data = await res.json();
      if (!res.ok || data.error) { errorEl.textContent = data.error ?? 'Generation failed'; return; }
      const img = document.getElementById('gen-bg-img');
      img.src   = `/backgrounds/${encodeURIComponent(data.filename)}`;
      preview.hidden = false;
      await getBackgrounds(true);
      populateBackgroundSelect(data.filename, 'add-agent-background');
      close();
    } catch (err) {
      errorEl.textContent = err.message || 'Generation failed';
    } finally {
      spinner.hidden     = true;
      submitBtn.disabled = false;
    }
  });
}

export async function populateBackgroundSelect(selectedFile, selId = 'add-agent-background') {
  const sel = document.getElementById(selId);
  if (!sel) return;
  const backgrounds = await getBackgrounds();
  sel.innerHTML = '<option value="">(no background)</option>';
  for (const f of backgrounds) {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f.replace(/\.[^.]+$/, '');
    sel.appendChild(opt);
  }
  if (selectedFile) sel.value = selectedFile;
}
