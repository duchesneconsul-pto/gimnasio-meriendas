(function() {
  if (localStorage.getItem('token')) {
    var user = JSON.parse(localStorage.getItem('user') || '{}');
    window.location.href = user.rol === 'admin' ? '/admin' : '/pos';
    return;
  }

  document.getElementById('loginForm').addEventListener('submit', function(e) {
    e.preventDefault();
    var btn = document.getElementById('btnLogin');
    var errorEl = document.getElementById('loginError');
    errorEl.style.display = 'none';
    btn.disabled = true;
    btn.textContent = 'Ingresando...';

    fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usuario: document.getElementById('usuario').value,
        password: document.getElementById('password').value
      })
    })
    .then(function(res) {
      return res.json().then(function(data) {
        if (!res.ok) throw new Error(data.error);
        return data;
      });
    })
    .then(function(data) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.usuario));
      window.location.href = data.usuario.rol === 'admin' ? '/admin' : '/pos';
    })
    .catch(function(err) {
      errorEl.textContent = err.message;
      errorEl.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Ingresar';
    });
  });
})();
