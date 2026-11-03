(function () {
  var t = 'system';
  try { t = localStorage.getItem('mt.theme') || 'system'; } catch (e) {}
  var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.classList.add('dark');
})();
