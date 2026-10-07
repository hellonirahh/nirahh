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

  window.NirahhNavigation();

  var observer = 'IntersectionObserver' in window ? new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -60px' }) : null;

  document.querySelectorAll('.reveal').forEach(function (el) {
    if (observer) observer.observe(el);
    else el.classList.add('in');
  });

  // The real render-the-saree-onto-your-photo backend isn't built yet, so
  // this just opens a "coming soon" message rather than pretending to work.
  var modal = document.getElementById('tryOnModal');
  var openBtn = document.getElementById('tryOnBtn');

  if (modal) {
    var setModal = window.NirahhDialog(modal);
    if (openBtn) openBtn.addEventListener('click', function () { setModal(true); });
    if (location.hash === '#try-on') setModal(true);
  }

  var form = document.getElementById('signupForm');
  var msg = document.getElementById('signupMsg');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      // This prototype has no newsletter service; never claim a subscription.
      if (msg) msg.hidden = false;
    });
  }

  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
})();
