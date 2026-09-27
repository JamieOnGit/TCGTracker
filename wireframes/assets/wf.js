// Wireframe-only helper: close open dropdown <details data-menu> when clicking elsewhere / pressing Esc.
document.addEventListener('click', (e) => {
  document.querySelectorAll('details[data-menu][open]').forEach((d) => { if (!d.contains(e.target)) d.removeAttribute('open'); });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('details[data-menu][open]').forEach((d) => d.removeAttribute('open'));
});
