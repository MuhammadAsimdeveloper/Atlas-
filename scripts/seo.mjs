import { escapeAttribute } from './site-utils.mjs';

export const PUBLIC_FAQS = Object.freeze([
  {
    question: 'Can Atlas send email, SMS or WhatsApp messages today?',
    answer: "This source release contains governed message and workflow contracts, not connected delivery providers. Delivery requires a tenant's provider connection, verified consent/suppression data and a production worker.",
  },
  {
    question: 'Can an AI agent change company records by itself?',
    answer: "Atlas limits agent tools to the tenant's approved capabilities. Sensitive writes must use tenant-bound approval evidence; the platform owner identity does not flow from a tenant request.",
  },
  {
    question: 'Is the Atlas dashboard a live SaaS account?',
    answer: 'No. The included command center is a sample-data preview. Signup, authentication, checkout and connected inboxes require production services that are outside this source release.',
  },
]);

export const SITE_TITLE = 'Atlas | AI Customer Operations for Service Businesses';
export const SITE_DESCRIPTION = 'Bring customer conversations, governed AI agents, service-desk operations and follow-up automation into one workspace for service businesses.';

export function validatePublicOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('Public mode requires an HTTPS origin, for example https://atlas.example.com.');
  let url;
  try { url = new URL(value.trim()); } catch { throw new TypeError('Public origin must be a valid HTTPS origin.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new TypeError('Public origin must be HTTPS and contain only an origin (no path, credentials, query or fragment).');
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.test') || hostname.endsWith('.example') || hostname.endsWith('.invalid')) {
    throw new TypeError('Public origin must use the real public hostname; reserved development domains are not indexable.');
  }
  if (!hostname.includes('.') || /^\d+(?:\.\d+){3}$/.test(hostname) || hostname.includes(':')) {
    throw new TypeError('Public origin must use a public DNS hostname, not an IP address.');
  }
  return url.origin;
}

function jsonForHtml(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
}

export function renderPublicIndex(html, origin) {
  const canonical = validatePublicOrigin(origin);
  if (!html.includes('data-atlas-seo-mode="template"') || !html.includes('<!-- Public canonical, social metadata and JSON-LD are injected by scripts/build-site.mjs. -->')) {
    throw new Error('Marketing page is missing the expected SEO template marker.');
  }
  for (const { question, answer } of PUBLIC_FAQS) {
    if (!html.includes(question) || !html.includes(answer)) throw new Error(`Visible FAQ drifted from structured data: ${question}`);
  }
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', name: 'Atlas', url: `${canonical}/` },
      { '@type': 'WebSite', name: 'Atlas', url: `${canonical}/`, inLanguage: 'en' },
      {
        '@type': 'SoftwareApplication',
        name: 'Atlas',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        description: SITE_DESCRIPTION,
        url: `${canonical}/`,
      },
      {
        '@type': 'FAQPage',
        mainEntity: PUBLIC_FAQS.map(({ question, answer }) => ({
          '@type': 'Question', name: question,
          acceptedAnswer: { '@type': 'Answer', text: answer },
        })),
      },
    ],
  };
  const additions = [
    `<link rel="canonical" href="${escapeAttribute(`${canonical}/`)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Atlas">`,
    `<meta property="og:title" content="${escapeAttribute(SITE_TITLE)}">`,
    `<meta property="og:description" content="${escapeAttribute(SITE_DESCRIPTION)}">`,
    `<meta property="og:url" content="${escapeAttribute(`${canonical}/`)}">`,
    '<meta name="twitter:card" content="summary">',
    `<meta name="twitter:title" content="${escapeAttribute(SITE_TITLE)}">`,
    `<meta name="twitter:description" content="${escapeAttribute(SITE_DESCRIPTION)}">`,
    `<script type="application/ld+json">${jsonForHtml(graph)}</script>`,
  ].join('\n    ');
  return html
    .replace('<meta name="robots" content="noindex,nofollow" data-atlas-seo-mode="template">', '<meta name="robots" content="index,follow,max-image-preview:large">')
    .replace('    <!-- Public canonical, social metadata and JSON-LD are injected by scripts/build-site.mjs. -->', `    ${additions}`);
}

export function renderPreviewRobots() {
  return 'User-agent: *\nDisallow: /\n';
}

export function renderPublicRobots(origin) {
  const canonical = validatePublicOrigin(origin);
  return `User-agent: *\nAllow: /\n\nSitemap: ${canonical}/sitemap.xml\n`;
}

export function renderPublicSitemap(origin) {
  const canonical = validatePublicOrigin(origin);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${canonical}/</loc></url>\n</urlset>\n`;
}

export function makeNoindex(html) {
  const noindex = /<meta\s+name=["']robots["']/i.test(html)
    ? html.replace(/<meta\s+name=["']robots["'][^>]*>/i, '<meta name="robots" content="noindex,nofollow">')
    : html.replace('</head>', '    <meta name="robots" content="noindex,nofollow">\n  </head>');
  return noindex.replace('    <!-- Public canonical, social metadata and JSON-LD are injected by scripts/build-site.mjs. -->', '');
}
