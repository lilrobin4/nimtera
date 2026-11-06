// Apply the saved explicit choice before first paint. No network or account access.
try { const day = localStorage.getItem('nimtera.ui.theme') === 'day'; document.documentElement.dataset.theme = day ? 'day' : 'night'; document.documentElement.classList.toggle('dark', !day); } catch { document.documentElement.dataset.theme = 'night'; }
