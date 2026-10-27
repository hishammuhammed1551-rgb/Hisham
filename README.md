# Lowcaps — Company Website

Website for **Lowcaps**, a logistics company in Khor Fakkan, UAE, providing shipping, clearing and customs services. Built with plain HTML, CSS and JavaScript (no build step).

## Still to fill in

- **Phone number:** search for `+971 XX XXX XXXX` and `+971000000000` (the `tel:` link) in the HTML files.
- **Email address:** search for `info@example.com` in the HTML files.
- **Contact form delivery:** see below.

## Pages

| File            | Contents                                                     |
| --------------- | ------------------------------------------------------------ |
| `index.html`    | Hero, services overview, Khor Fakkan location, process, CTA  |
| `about.html`    | Who we are and our values                                    |
| `services.html` | Shipping, clearing and customs in detail, FAQ                |
| `contact.html`  | Quote request form, contact details, map of Khor Fakkan      |

## Structure

```
index.html
about.html
services.html
contact.html
css/styles.css   # all styles; brand colours (sage green and white) are tokens in :root
js/main.js       # mobile menu, scroll reveal, contact form
```

## Preview locally

Open `index.html` in a browser, or run a small local server:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Customising

- **Colours & fonts:** edit the variables at the top of `css/styles.css` (`--color-primary`, `--color-accent`, `--font-sans`, `--font-serif`). Dark-mode colours are in the `prefers-color-scheme: dark` block below them.
- **Logo:** the "L" badge (`.logo-mark`) is in the header and footer of each page. Swap it for an `<img>` if you have a logo file.

## Making the contact form send email

The form validates input but has no backend. To receive submissions, create a free form endpoint (for example with [Formspree](https://formspree.io)) and paste its URL into the `data-endpoint` attribute in `contact.html`:

```html
<form class="form" id="contact-form" data-endpoint="https://formspree.io/f/yourid" novalidate>
```

## Deploying

Because it is a static site, it can be hosted anywhere. On GitHub Pages: **Settings → Pages → Deploy from a branch**, then pick the branch and the `/ (root)` folder.
