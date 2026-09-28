(function () {
  'use strict';

  // Horizontal rails (the Edit, testimonials) advance by one visible page.
  document.querySelectorAll('.rail-next').forEach(function (btn) {
    var rail = document.getElementById(btn.dataset.rail);
    if (!rail) return;
    btn.addEventListener('click', function () {
      var atEnd = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 8;
      rail.scrollTo({ left: atEnd ? 0 : rail.scrollLeft + rail.clientWidth * 0.85, behavior: 'smooth' });
    });
  });

  var toggle = document.getElementById('navToggle');
  var nav = document.getElementById('siteNav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', String(open));
      document.body.style.overflow = open ? 'hidden' : '';
    });
    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        nav.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = '';
      }
    });
  }

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -60px' });

  document.querySelectorAll('.reveal').forEach(function (el) {
    observer.observe(el);
  });

  // The real render-the-saree-onto-your-photo backend isn't built yet, so
  // this just opens a "coming soon" message rather than pretending to work.
  var modal = document.getElementById('tryOnModal');
  var openBtn = document.getElementById('tryOnBtn');
  var closeBtn = document.getElementById('modalClose');

  var setModal = function (show) {
    if (!modal) return;
    modal.hidden = !show;
    document.body.style.overflow = show ? 'hidden' : '';
  };

  if (openBtn) openBtn.addEventListener('click', function () { setModal(true); });
  if (closeBtn) closeBtn.addEventListener('click', function () { setModal(false); });
  if (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target === modal) setModal(false);
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setModal(false);
  });

  var form = document.getElementById('signupForm');
  var msg = document.getElementById('signupMsg');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      form.hidden = true;
      if (msg) msg.hidden = false;
    });
  }

  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
})();
