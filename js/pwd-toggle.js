// Кнопка «показать пароль» во всех input[type=password] на странице.
// Чтобы выключить точечно — добавить data-no-toggle на input.
(function () {
  function apply(input) {
    if (input.dataset.pwdToggleApplied) return;
    input.dataset.pwdToggleApplied = '1';
    const wrap = document.createElement('div');
    wrap.className = 'pwd-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pwd-toggle';
    btn.tabIndex = -1;
    btn.setAttribute('aria-label', 'Показать пароль');
    btn.textContent = '👁';
    btn.addEventListener('click', () => {
      const wasHidden = input.type === 'password';
      input.type = wasHidden ? 'text' : 'password';
      btn.textContent = wasHidden ? '🙈' : '👁';
      btn.setAttribute('aria-label', wasHidden ? 'Скрыть пароль' : 'Показать пароль');
    });
    wrap.appendChild(btn);
  }
  function init() {
    document.querySelectorAll('input[type="password"]:not([data-no-toggle])').forEach(apply);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
