// Lowcaps — site behaviour

(function () {
  "use strict";

  // Mobile navigation toggle
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav-links");

  if (toggle && links) {
    toggle.addEventListener("click", function () {
      const open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });

    links.addEventListener("click", function (event) {
      if (event.target.closest("a")) {
        links.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  // Current year in footer
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });

  // Show the back-to-top button once the visitor has scrolled down
  const backToTop = document.querySelector(".back-to-top");
  if (backToTop) {
    const updateBackToTop = function () {
      backToTop.classList.toggle("show", window.scrollY > 400);
    };
    window.addEventListener("scroll", updateBackToTop, { passive: true });
    updateBackToTop();
  }

  // Fade sections in as they scroll into view
  const revealEls = document.querySelectorAll(".reveal");

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    revealEls.forEach(function (el) {
      observer.observe(el);
    });
  } else {
    revealEls.forEach(function (el) {
      el.classList.add("visible");
    });
  }

  // Contact form validation and submission
  const form = document.querySelector("#contact-form");
  if (!form) return;

  const status = form.querySelector(".form-status");
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function validateField(input) {
    const field = input.closest(".field");
    const value = input.value.trim();
    let valid = true;

    if (input.required && !value) valid = false;
    if (valid && input.type === "email" && value && !emailPattern.test(value)) valid = false;

    field.classList.toggle("invalid", !valid);
    input.setAttribute("aria-invalid", String(!valid));
    return valid;
  }

  form.querySelectorAll("input, select, textarea").forEach(function (input) {
    input.addEventListener("blur", function () {
      validateField(input);
    });
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    status.className = "form-status";

    const inputs = Array.from(form.querySelectorAll("input, select, textarea"));
    const allValid = inputs.map(validateField).every(Boolean);

    if (!allValid) {
      status.textContent = "Please fix the highlighted fields and try again.";
      status.classList.add("error");
      form.querySelector(".field.invalid input, .field.invalid select, .field.invalid textarea").focus();
      return;
    }

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = "Sending…";

    try {
      // Set data-endpoint on the form (e.g. a Formspree URL) to deliver real messages.
      const endpoint = form.dataset.endpoint;
      if (!endpoint) {
        status.textContent = "Online enquiries aren't connected yet. Please call or email us using the details on this page.";
        status.classList.add("error");
        return;
      }

      const response = await fetch(endpoint, {
        method: "POST",
        body: new FormData(form),
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("Request failed");

      form.reset();
      status.textContent = "Thank you — your message has been sent. Our team will get back to you shortly.";
      status.classList.add("success");
    } catch (err) {
      status.textContent = "Sorry, something went wrong. Please call or email us directly using the details on this page.";
      status.classList.add("error");
    } finally {
      button.disabled = false;
      button.textContent = "Send message";
    }
  });
})();
