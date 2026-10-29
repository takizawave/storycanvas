// Reveal the existing Storybook underneath the library without moving its DOM
// or reloading either set of previews. Only the mode switch floats over it.
export function createStoryView({ host, app, layout, header, onChange = () => {} }) {
  let mode = 'canvas';
  function setMode(next) {
    if (!['story', 'canvas'].includes(next) || next === mode) return;
    mode = next;
    const showStory = mode === 'story';
    host.classList.toggle('sl-story-mode', showStory);
    layout.inert = showStory;
    layout.setAttribute('aria-hidden', String(showStory));
    if (showStory) { app.removeAttribute('role'); app.removeAttribute('aria-modal'); }
    else { app.setAttribute('role', 'dialog'); app.setAttribute('aria-modal', 'true'); }
    for (const button of header.querySelectorAll('[data-display-mode]')) button.setAttribute('aria-pressed', String(button.dataset.displayMode === mode));
    onChange(mode);
  }
  return { setMode, getMode: () => mode };
}
