document.addEventListener('DOMContentLoaded', () => {
  // ==========================================
  // THEME SWITCHING (DARK/LIGHT)
  // ==========================================
  const themeToggle = document.querySelector('.theme-toggle');
  const htmlElement = document.documentElement;

  // Retrieve theme preference from localStorage or default to system preference
  const savedTheme = localStorage.getItem('theme');
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initialTheme = savedTheme || (systemPrefersDark ? 'dark' : 'light');

  // Apply theme
  htmlElement.setAttribute('data-theme', initialTheme);

  // Toggle theme handler
  themeToggle.addEventListener('click', () => {
    const currentTheme = htmlElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    htmlElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  });

  // ==========================================
  // MOBILE NAVIGATION MENU
  // ==========================================
  const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
  const navMenu = document.querySelector('.nav-menu');
  const navLinks = document.querySelectorAll('.nav-link');

  // Toggle mobile menu visibility
  mobileMenuBtn.addEventListener('click', () => {
    navMenu.classList.toggle('active');
    
    // Toggle menu icon between burger and close
    const icon = mobileMenuBtn.querySelector('svg');
    if (navMenu.classList.contains('active')) {
      icon.innerHTML = '<path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>';
    } else {
      icon.innerHTML = '<path fill="currentColor" d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>';
    }
  });

  // Close mobile menu when clicking any nav link
  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      if (navMenu.classList.contains('active')) {
        navMenu.classList.remove('active');
        const icon = mobileMenuBtn.querySelector('svg');
        icon.innerHTML = '<path fill="currentColor" d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>';
      }
    });
  });

  // ==========================================
  // SCROLL EFFECTS (NAVBAR & ACTIVE LINK SPY)
  // ==========================================
  const navbar = document.querySelector('.navbar');
  const sections = document.querySelectorAll('section[id], header[id]');

  window.addEventListener('scroll', () => {
    const scrollPos = window.scrollY;

    // Navbar scrolled shadow effect
    if (scrollPos > 50) {
      navbar.style.boxShadow = '0 10px 30px -10px var(--shadow-color)';
      navbar.style.borderBottomColor = 'var(--color-border-hover)';
    } else {
      navbar.style.boxShadow = 'none';
      navbar.style.borderBottomColor = 'var(--color-border)';
    }

    // Scroll Spy: Highlight active section in nav menu
    let currentSectionId = '';
    
    sections.forEach(section => {
      const sectionTop = section.offsetTop - 120; // Offset for fixed nav height
      const sectionHeight = section.offsetHeight;
      
      if (scrollPos >= sectionTop && scrollPos < sectionTop + sectionHeight) {
        currentSectionId = section.getAttribute('id');
      }
    });

    if (currentSectionId) {
      navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === `#${currentSectionId}`) {
          link.classList.add('active');
        }
      });
    }
  });

  // ==========================================
  // CONTACT FORM HANDLER (FORMSPREE AJAX)
  // ==========================================
  const contactForm = document.getElementById('contact-form');
  const formStatus = document.getElementById('form-status');

  if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const data = new FormData(contactForm);
      const submitBtn = contactForm.querySelector('button[type="submit"]');
      const originalBtnText = submitBtn.innerHTML;
      
      // Update button state during sending
      submitBtn.disabled = true;
      submitBtn.innerHTML = 'Sending...';
      formStatus.className = 'form-status';
      formStatus.style.display = 'none';

      try {
        const response = await fetch(contactForm.action, {
          method: contactForm.method,
          body: data,
          headers: {
            'Accept': 'application/json'
          }
        });

        if (response.ok) {
          formStatus.textContent = 'Thank you! Your message has been sent successfully. ✨';
          formStatus.className = 'form-status success';
          contactForm.reset();
        } else {
          const result = await response.json();
          if (Object.hasOwn(result, 'errors')) {
            formStatus.textContent = result.errors.map(error => error.message).join(', ');
          } else {
            formStatus.textContent = 'Oops! There was a problem submitting your form.';
          }
          formStatus.className = 'form-status error';
        }
      } catch (error) {
        formStatus.textContent = 'Connection issue. Please check your internet connection and try again.';
        formStatus.className = 'form-status error';
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnText;
      }
    });
  }
});
