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

export const SITE_TITLE = 'Atlas | AI Customer Operations & Lead Follow-Up for Service Businesses';
export const SITE_DESCRIPTION = 'AI customer operations, customer service workflows and governed lead follow-up automation for service businesses.';
export const SITE_KEYWORDS = Object.freeze([
  'AI customer operations',
  'AI customer service',
  'lead follow-up automation',
  'service desk automation',
  'governed AI agents',
]);
export const PUBLIC_LAST_MODIFIED = '2026-10-04';
export const SOCIAL_IMAGE_PATH = '/social-card.svg';

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

function replaceMeta(html, name, content) {
  const pattern = new RegExp('<meta\\s+name="' + name + '"[^>]*>', 'i');
  const tag = '<meta name="' + name + '" content="' + escapeAttribute(content) + '">';
  return pattern.test(html) ? html.replace(pattern, tag) : html.replace('</head>', '    ' + tag + '\n  </head>');
}

function replaceTitle(html, title) {
  return /<title>[^<]*<\/title>/i.test(html)
    ? html.replace(/<title>[^<]*<\/title>/i, '<title>' + escapeAttribute(title) + '</title>')
    : html.replace('</head>', '    <title>' + escapeAttribute(title) + '</title>\n  </head>');
}

export function renderPublicIndex(html, origin, {
  googleSiteVerification='',
  bingSiteVerification='',
  lastModified=PUBLIC_LAST_MODIFIED,
} = {}) {
  const canonical = validatePublicOrigin(origin);
  if (!html.includes('data-atlas-seo-mode="template"') || !html.includes('<!-- Public canonical, social metadata and JSON-LD are injected by scripts/build-site.mjs. -->')) {
    throw new Error('Marketing page is missing the expected SEO template marker.');
  }
  for (const { question, answer } of PUBLIC_FAQS) {
    if (!html.includes(question) || !html.includes(answer)) throw new Error('Visible FAQ drifted from structured data: ' + question);
  }
  const pageUrl = canonical + '/';
  const socialImage = canonical + SOCIAL_IMAGE_PATH;
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': canonical + '/#organization',
        name: 'Atlas',
        url: pageUrl,
        logo: canonical + '/favicon.svg',
      },
      {
        '@type': 'WebSite',
        '@id': canonical + '/#website',
        name: 'Atlas',
        url: pageUrl,
        inLanguage: 'en',
        publisher: { '@id': canonical + '/#organization' },
      },
      {
        '@type': 'WebPage',
        '@id': canonical + '/#webpage',
        url: pageUrl,
        name: SITE_TITLE,
        description: SITE_DESCRIPTION,
        isPartOf: { '@id': canonical + '/#website' },
        about: { '@id': canonical + '/#organization' },
        primaryImageOfPage: { '@type': 'ImageObject', url: socialImage, width: 1200, height: 630 },
        inLanguage: 'en',
        dateModified: lastModified,
      },
      {
        '@type': 'SoftwareApplication',
        '@id': canonical + '/#software',
        name: 'Atlas',
        applicationCategory: 'BusinessApplication',
        applicationSubCategory: 'Customer operations',
        operatingSystem: 'Web',
        description: SITE_DESCRIPTION,
        url: pageUrl,
        featureList: [
          'AI customer operations',
          'Governed AI agents',
          'Customer service workflows',
          'Lead follow-up automation',
        ],
      },
      {
        '@type': 'FAQPage',
        '@id': canonical + '/#faq',
        mainEntity: PUBLIC_FAQS.map(({ question, answer }) => ({
          '@type': 'Question',
          name: question,
          acceptedAnswer: { '@type': 'Answer', text: answer },
        })),
      },
    ],
  };
  const additions = [
    '<link rel="canonical" href="' + escapeAttribute(pageUrl) + '">',
    '<link rel="sitemap" type="application/xml" href="/sitemap.xml">',
    '<meta name="application-name" content="Atlas">',
    '<meta name="referrer" content="strict-origin-when-cross-origin">',
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Atlas">',
    '<meta property="og:locale" content="en_US">',
    '<meta property="og:title" content="' + escapeAttribute(SITE_TITLE) + '">',
    '<meta property="og:description" content="' + escapeAttribute(SITE_DESCRIPTION) + '">',
    '<meta property="og:url" content="' + escapeAttribute(pageUrl) + '">',
    '<meta property="og:image" content="' + escapeAttribute(socialImage) + '">',
    '<meta property="og:image:secure_url" content="' + escapeAttribute(socialImage) + '">',
    '<meta property="og:image:type" content="image/svg+xml">',
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta property="og:image:alt" content="Atlas AI customer operations for service businesses">',
    '<meta name="twitter:card" content="summary_large_image">',
    '<meta name="twitter:title" content="' + escapeAttribute(SITE_TITLE) + '">',
    '<meta name="twitter:description" content="' + escapeAttribute(SITE_DESCRIPTION) + '">',
    '<meta name="twitter:url" content="' + escapeAttribute(pageUrl) + '">',
    '<meta name="twitter:image" content="' + escapeAttribute(socialImage) + '">',
    '<meta name="twitter:image:alt" content="Atlas AI customer operations for service businesses">',
    googleSiteVerification ? '<meta name="google-site-verification" content="' + escapeAttribute(googleSiteVerification) + '">' : '',
    bingSiteVerification ? '<meta name="msvalidate.01" content="' + escapeAttribute(bingSiteVerification) + '">' : '',
    '<script type="application/ld+json">' + jsonForHtml(graph) + '</script>',
  ].filter(Boolean).join('\n    ');
  let output = replaceTitle(html, SITE_TITLE);
  output = replaceMeta(output, 'description', SITE_DESCRIPTION);
  output = output.replace(/<meta\s+name=["']robots["'][^>]*>/i, '<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">');
  return output.replace('    <!-- Public canonical, social metadata and JSON-LD are injected by scripts/build-site.mjs. -->', '    ' + additions);
}

export function renderPreviewRobots() {
  return 'User-agent: *\nDisallow: /\n';
}

export function renderPublicRobots(origin) {
  const canonical = validatePublicOrigin(origin);
  return 'User-agent: *\nAllow: /\n\nSitemap: ' + canonical + '/sitemap.xml\n';
}

export function renderPublicSitemap(origin, entries=[{path:'/',lastmod:PUBLIC_LAST_MODIFIED}]) {
  const canonical = validatePublicOrigin(origin);
  if (!Array.isArray(entries) || entries.length < 1) throw new TypeError('Sitemap entries are required.');
  const urls = entries.map(entry => {
    const path = typeof entry.path === 'string' ? entry.path : '';
    if (!path.startsWith('/') || /[?#<>&"'\s]/.test(path)) throw new TypeError('Sitemap path invalid.');
    const lastmod = typeof entry.lastmod === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.lastmod) ? entry.lastmod : null;
    return '  <url><loc>' + canonical + path + '</loc>' + (lastmod ? '<lastmod>' + lastmod + '</lastmod>' : '') + '</url>';
  }).join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + '\n</urlset>\n';
}

export function makeNoindex(html) {
  const noindex = /<meta\s+name=["']robots["']/i.test(html)
    ? html.replace(/<meta\s+name=["']robots["'][^>]*>/i, '<meta name="robots" content="noindex,nofollow">')
    : html.replace('</head>', '    <meta name="robots" content="noindex,nofollow">\n  </head>');
  return noindex.replace('    <!-- Public canonical, social metadata and JSON-LD are injected by scripts/build-site.mjs. -->', '');
}
