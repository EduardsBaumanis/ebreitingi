// Keyboard shortcuts for the CMS moderation page. Elements opt in with data-shortcut="<key>":
//   buttons and links are clicked, <summary> is toggled and its first field focused,
//   form fields are focused. Ignored while typing in a field or with modifier keys.
(function () {
  document.addEventListener('keydown', function (event) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    var target = event.target;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;

    var el = document.querySelector('[data-shortcut="' + event.key.toLowerCase() + '"]');
    if (!el || el.disabled) return;
    event.preventDefault();

    if (el.tagName === 'SUMMARY') {
      var details = el.parentElement;
      details.open = true;
      var field = details.querySelector('textarea') || details.querySelector('input:not([type=hidden]), select');
      if (field) field.focus();
    } else if (el.tagName === 'SELECT' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.focus();
    } else {
      el.click();
    }
  });
})();
