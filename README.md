# Meridian Advisory — Company Website

A responsive, four-page website for a professional services firm, built with plain HTML, CSS and JavaScript (no build step).

> "Meridian Advisory" and all names, figures, addresses and testimonials are **placeholder content**. Replace them with your company's real details before publishing.

## Pages

| File            | Contents                                                                 |
| --------------- | ------------------------------------------------------------------------ |
| `index.html`    | Hero, key stats, services overview, approach, process, testimonials, CTA |
| `about.html`    | Company story, mission & values, leadership team                         |
| `services.html` | Detailed services, engagement models, FAQ                                |
| `contact.html`  | Validated contact form, address, phone, email, office hours              |

## Structure

```
index.html
about.html
services.html
contact.html
css/styles.css   # all styles; brand colours and fonts are tokens in :root
js/main.js       # mobile menu, scroll reveal, contact form
```

## Preview locally

Open `index.html` in a browser, or run a small local server:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Customising

- **Company name / text:** search and replace `Meridian Advisory` across the HTML files, then edit the copy on each page.
- **Colours & fonts:** edit the variables at the top of `css/styles.css` (`--color-primary`, `--color-accent`, `--font-sans`, `--font-serif`). Dark-mode colours are in the `prefers-color-scheme: dark` block below them.
- **Logo:** the "M" badge (`.logo-mark`) is in the header and footer of each page. Swap it for an `<img>` if you have a logo file.
- **Contact details:** update the address, phone and email in the footer of each page and in `contact.html`.

## Making the contact form send email

The form validates input but has no backend. To receive submissions, create a free form endpoint (for example with [Formspree](https://formspree.io)) and paste its URL into the `data-endpoint` attribute in `contact.html`:

```html
<form class="form" id="contact-form" data-endpoint="https://formspree.io/f/yourid" novalidate>
```

## Deploying

Because it is a static site, it can be hosted anywhere. On GitHub Pages: **Settings → Pages → Deploy from a branch**, then pick the branch and the `/ (root)` folder.
